// packages/core/src/evaluator/evaluate-node.ts
//
// "Time-gate → sample → resolve parent → call NodeKind.render → recurse
// children" (Deliverable 07, verbatim).
//
// IMPLEMENTATION NOTE — flat RenderNode array, P1 known simplification:
// `out` (and the recursion's contribution to it) is a FLAT array — a
// "group" RenderNode's `children` stays whatever NodeKind.render() set
// (typically `[]`); descendants are pushed as siblings into the same flat
// array with absolute world matrices already applied. Transform AND
// opacity composition through the hierarchy ARE correct: `world = parentMat
// * localMat` and `opacity = parentOpacity * sampled.opacity`, both threaded
// through the recursion via `parentMat`/`parentOpacity`. (Opacity
// composition is only exact for non-overlapping descendants — true
// group opacity, where overlapping children don't "double-fade" at their
// intersection, needs render-to-texture layer compositing.)
//
// `blend` does NOT compose: `applyWorld` always uses the node's OWN
// `node.blend`, never an ancestor's. A blend mode fundamentally needs a
// "layer" to apply to (the group's composited output) — flattening a
// group's blend mode onto each child independently would be incorrect, not
// just imprecise. Revisit alongside P2 compositing depth (effects/masks),
// per the ADR.
//
// PHASE 2 EXCEPTION — "effectGroup" (§5): the one RenderNode shape whose
// `render()` is expected to have ALREADY consumed `node.children` itself
// (typically via its own internal `evaluateNode` calls, rooted at IDENTITY
// rather than `world`, so children land in the group's own local space).
// When `render()` returns one, this function's own children-flattening is
// SKIPPED for that node — see the check below — to avoid double-evaluating
// (and thus duplicating) every descendant. Every other RenderNode shape,
// "group" included, keeps the flattening behavior described above
// unchanged: this is an additive, single-case exception, not a rewrite of
// the existing recursion contract.
//
// PHASE 2 §6/§7 — `node.effects[]` -> an effectGroup: when a node has at
// least one ENABLED entry in `effects`, its ENTIRE rendered subtree (its
// own RenderNode(s) from `render()`, plus every flattened/recursed
// descendant) is wrapped in one "effectGroup" with `isolate: true` and one
// PassSpec per enabled effect, in array order (stacking order = pass
// order, EffectRef's doc: "ordered"). This happens AFTER the existing
// children-flattening above, not instead of it — an effect on a node
// applies to that node's whole composited layer (itself + descendants),
// matching every compositing tool's actual behavior, not just the node's
// own immediate visual. A node with NO enabled effects is completely
// unaffected — `out` returns exactly as it would have in Phase 1.

import type { BlendMode, Mat3 } from "../types/primitives";
import type { Frame, Id } from "../types/ids";
import type { Node, Scalar } from "../types/node";
import type { EvalCtx } from "../registry/node-kind";
import type { NodeKindRegistry } from "../registry/registry";
import type { Json, PassSpec, RenderNode } from "contract";
import { inSpan } from "../types/time";
import { sampleChannels } from "./sample-channels";
import { sampleEffectProps } from "./sample-effects";
import { composeTransform, IDENTITY, mul } from "./compose-transform";
import { applyTransitions } from "./transitions";
import { applyAdjustments } from "./adjustments";
import { evalCompNode } from "./precomp";

export function evaluateNode(
  node: Node,
  frame: Frame,
  parentMat: Mat3,
  reg: NodeKindRegistry,
  ctx: EvalCtx,
  parentOpacity = 1,
  parentMatrices: Map<Id, Mat3> = new Map()
): RenderNode[] {
  if (node.hidden || !inSpan(node.time, frame)) return []; // time gate

  const sampled = sampleChannels(node, frame); // static ⊕ channels
  const localMat = composeTransform(sampled.transform);

  // parentId overrides the call-stack parentMat — a parented node's world
  // matrix is built from its NAMED parent's pre-computed world matrix, not
  // from its tree position's parentMat. Only affects nodes with parentId set;
  // all others continue using the call-stack parentMat unchanged (zero cost
  // for Phase 1 documents).
  const effectiveParentMat = node.parentId ? (parentMatrices.get(node.parentId) ?? IDENTITY) : parentMat;

  const world = mul(effectiveParentMat, localMat);
  const opacity = parentOpacity * sampled.opacity;

  // Phase 2 §8 — comp nodes are intercepted here rather than going through
  // NodeKind.render(), because evalCompNode needs `reg`, `world`, `frame`,
  // and the full EvalCtx — none of which NodeKind.render() receives.
  if (node.kind === "comp") {
    return evalCompNode(node, world, opacity, ctx.fps, frame, reg, ctx);
  }

  const out = reg.get(node.kind).render({ ...node, ...sampled }, frame, ctx);
  applyWorld(out, world, opacity, node.blend); // stamp matrix/opacity/blend

  // "effectGroup" (Phase 2 §5) is the ONE RenderNode shape whose
  // `NodeKind.render()` is expected to have ALREADY consumed `node.children`
  // itself — typically by calling `evaluateNode` internally, rooted at
  // IDENTITY rather than `world`, so the children end up positioned in the
  // group's own local space (the convention Deliverable 08's `evalCompNode`
  // pseudocode uses for precomp instances). Flattening `node.children` again
  // here, on top of that, would duplicate every descendant. Every other
  // RenderNode shape (including "group", which always sets `children: []`
  // and relies entirely on THIS flattening — see the module doc above)
  // keeps the exact pre-Phase-2 behavior.
  const alreadyConsumedChildren = out.some((n) => n.t === "effectGroup");
  if (node.children && !alreadyConsumedChildren) {
    const perChild = node.children.map((c) => evaluateNode(c, frame, world, reg, ctx, opacity, parentMatrices));
    const hasChildAdjustments = node.children.some((c) => c.isAdjustment);
    if (hasChildAdjustments) {
      out.push(...applyAdjustments(node.children, perChild, frame));
    } else {
      out.push(...applyTransitions(node.children, perChild, frame));
    }
  }

  const passes = effectPasses(node, frame);
  if (passes.length === 0) return out; // no enabled effects — Phase 1-identical output.

  // Wrap the WHOLE subtree (own RenderNode(s) + descendants, already
  // world-positioned above) in one effectGroup. The wrapper's own
  // matrix/opacity/blend are the node's world values too — same as if it
  // were the node's directly-rendered output — so a PARENT further up the
  // tree composes with this group exactly as it would with an unwrapped
  // node. The wrapped children, however, must NOT also carry the world
  // matrix (Pixi composes the group Container's transform with its
  // nested children automatically once nested — same reasoning as the
  // Week 1-2 doc above) — they're re-rooted to local space (their
  // position relative to `world`) via the SAME multiply-by-inverse the
  // renderer would otherwise have to do, computed once here instead.
  const localChildren = reparentToLocal(out, world);
  const effectGroup: RenderNode = {
    id: node.id,
    matrix: world,
    opacity,
    blend: node.blend,
    t: "effectGroup",
    children: localChildren,
    passes,
    isolate: true,
  };
  return [effectGroup];
}

/** Overwrites each RenderNode's matrix/opacity/blend with this node's world values. */
function applyWorld(out: RenderNode[], world: Mat3, opacity: number, blend: BlendMode): void {
  for (const renderNode of out) {
    renderNode.matrix = world;
    renderNode.opacity = opacity;
    renderNode.blend = blend;
  }
}

/**
 * One `PassSpec` per ENABLED entry in `node.effects`, in array order
 * (stacking order = pass order). `uniforms` comes from
 * `sampleEffectProps` (sample-effects.ts) — each ref's static `props`
 * overlaid with its own sampled `channels` ("fx.<ref.id>.<prop>" paths),
 * i.e. exactly §7's "uniforms:sampled". A disabled effect (`enabled:
 * false`) contributes NOTHING — not even a no-op pass — distinct from an
 * effect whose own `props` happen to be a no-op value (e.g. blur amount
 * 0), which still gets a real pass (cheap for "identity"-like values, and
 * keeps "enabled" the one authoritative on/off switch a user toggles).
 */
/** Exported for use by applyAdjustments (adjustments.ts) — same sampling logic applies when an adjustment node's effects wrap siblings below it. */
export function effectPasses(node: Node, frame: Frame): PassSpec[] {
  const passes: PassSpec[] = [];

  // ORDER per blueprint Deliverable 07: masks → matte → effects.

  // MASKS — node.masks[]: bezier paths, add/sub/intersect, feather.
  if (node.masks) {
    for (const mask of node.masks) {
      passes.push({
        kind: "mask",
        ref: "mask",
        uniforms: {
          path: mask.path as unknown as PassSpec["uniforms"],
          feather: mask.feather,
          mode: mask.mode,
          opacity: mask.opacity,
          inverted: mask.inverted,
        } as PassSpec["uniforms"],
      });
    }
  }

  // MATTE — node.matte: a sibling's alpha/luma stencils this node.
  if (node.matte) {
    passes.push({
      kind: "matte",
      ref: "matte",
      uniforms: { type: node.matte.type } as PassSpec["uniforms"],
      srcNodeId: node.matte.sourceNodeId,
    });
  }

  // EFFECTS — ordered stack of compositor effects.
  if (node.effects) {
    for (const ref of node.effects) {
      if (!ref.enabled) continue;
      passes.push({
        kind: "effect",
        ref: ref.effect,
        uniforms: toJsonUniforms(sampleEffectProps(ref, frame)),
      });
    }
  }

  return passes;
}

/**
 * `Record<string, Scalar>` (EffectRef.props's type — every value is
 * string | number | boolean | ColorOKLCH) is, at runtime, ALWAYS a valid
 * `Json` value: every `Scalar` variant is JSON-safe, and `ColorOKLCH`'s
 * only optional field (`alpha?`) is simply omitted when absent in real
 * data, never literally set to `undefined`. TypeScript's structural
 * checker can't see that distinction though — an interface with an
 * optional property is not structurally assignable to an index signature
 * type (`{[key:string]: Json}`), since the property's TYPE technically
 * includes `undefined`, which isn't itself a `Json` value, even though no
 * actual value at that position ever IS `undefined`. This function is
 * that explicit, narrow bridge — a type-level cast justified by the
 * runtime guarantee above, not a deep conversion (nothing is actually
 * transformed; the object is returned as-is).
 */
function toJsonUniforms(props: Record<string, Scalar>): Json {
  return props as unknown as Json;
}

/**
 * Re-roots every RenderNode in `out` from WORLD space to LOCAL space
 * relative to `world` — i.e. `local = inverse(world) * node.matrix` for
 * each. Used when wrapping `out` in a new effectGroup (above): the
 * group's OWN matrix already carries `world`, so its children must hold
 * only the residual transform relative to that — otherwise the renderer
 * would double-apply `world` (once via the group Container's own
 * transform, once again via each child's already-world matrix).
 *
 * Every RenderNode `evaluateNode` ever produces for `node` itself was
 * stamped with EXACTLY `world` by `applyWorld` above (uniformly, the same
 * matrix for the node's own output AND every flattened descendant — see
 * the module's "Transform AND opacity composition... ARE correct" note),
 * so `inverse(world) * world = IDENTITY` for every one of them: this
 * always reduces to "reset matrix to IDENTITY," computed generally
 * (rather than hardcoding IDENTITY directly) so the logic stays correct
 * if a future change ever stamps something other than `world` onto a
 * descendant.
 */
function reparentToLocal(out: RenderNode[], world: Mat3): RenderNode[] {
  const inverseWorld = invert(world);
  return out.map((renderNode) => ({ ...renderNode, matrix: mul(inverseWorld, renderNode.matrix) }));
}

/** 2D affine 3x3 matrix inverse — `Mat3` is always `[a,b,tx,c,d,ty,0,0,1]` (compose-transform.ts's convention); only the affine 2x2 + translation part needs inverting. */
function invert(m: Mat3): Mat3 {
  const [a, b, tx, c, d, ty] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) return IDENTITY; // singular (e.g. 0 scale) — degrade to IDENTITY rather than dividing by ~0.
  const invDet = 1 / det;
  const ia = d * invDet;
  const ib = -b * invDet;
  const ic = -c * invDet;
  const id = a * invDet;
  const itx = -(ia * tx + ic * ty);
  const ity = -(ib * tx + id * ty);
  return [ia, ib, itx, ic, id, ity, 0, 0, 1];
}
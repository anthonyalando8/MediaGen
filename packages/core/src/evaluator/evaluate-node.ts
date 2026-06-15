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

import type { BlendMode, Mat3 } from "../types/primitives";
import type { Frame } from "../types/ids";
import type { Node } from "../types/node";
import type { EvalCtx } from "../registry/node-kind";
import type { NodeKindRegistry } from "../registry/registry";
import type { RenderNode } from "contract";
import { inSpan } from "../types/time";
import { sampleChannels } from "./sample-channels";
import { composeTransform, mul } from "./compose-transform";

export function evaluateNode(
  node: Node,
  frame: Frame,
  parentMat: Mat3,
  reg: NodeKindRegistry,
  ctx: EvalCtx,
  parentOpacity = 1
): RenderNode[] {
  if (node.hidden || !inSpan(node.time, frame)) return []; // time gate

  const sampled = sampleChannels(node, frame); // static ⊕ channels
  const world = mul(parentMat, composeTransform(sampled.transform));
  const opacity = parentOpacity * sampled.opacity;
  const out = reg.get(node.kind).render({ ...node, ...sampled }, frame, ctx);
  applyWorld(out, world, opacity, node.blend); // stamp matrix/opacity/blend

  if (node.children) {
    out.push(...node.children.flatMap((c) => evaluateNode(c, frame, world, reg, ctx, opacity))); // recurse
  }

  return out;
}

/** Overwrites each RenderNode's matrix/opacity/blend with this node's world values. */
function applyWorld(out: RenderNode[], world: Mat3, opacity: number, blend: BlendMode): void {
  for (const renderNode of out) {
    renderNode.matrix = world;
    renderNode.opacity = opacity;
    renderNode.blend = blend;
  }
}
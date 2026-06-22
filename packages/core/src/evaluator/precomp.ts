// packages/core/src/evaluator/precomp.ts
//
// Phase 2 §8 — "Precompose & Reusable Compositions."
//
// evalCompNode: the evaluator entry point for a node with kind="comp". It
// resolves the source Composition, applies exposed-prop overrides, remaps
// time, evaluates all inner nodes, and wraps the result in an effectGroup
// with isolate:true so the inner comp renders to its own texture (RTT)
// before compositing into the parent — exactly the precompose semantics
// described in §8's pseudocode.
//
// Three sub-functions mirroring the blueprint's pseudocode exactly:
//   applyExposed  — overlays instance props onto the bound Composition's
//                   inner nodes at the target paths
//   remapTime     — converts the outer frame to the inner comp's time
//   evalCompNode  — orchestrates the above, builds the effectGroup RTT node

import type { Composition } from "../types/composition";
import type { Id } from "../types/ids";
import type { Node } from "../types/node";
import type { Frame } from "../types/ids";
import type { Mat3 } from "../types/primitives";
import type { RenderNode } from "contract";
import type { EvalCtx } from "../registry/node-kind";
import type { NodeKindRegistry } from "../registry/registry";
import { evaluateNode } from "./evaluate-node";
import { effectPasses } from "./evaluate-node";
import { IDENTITY } from "./compose-transform";
import { buildParentMatrices } from "./parenting";
import { toFrame } from "../types/ids";
import { setByPointer } from "../oplog/reducer";

// ── applyExposed ──────────────────────────────────────────────────────────

/**
 * Applies the comp node instance's `props` overrides onto the resolved
 * Composition's inner nodes, following each `PropBinding.target` path.
 * Returns a SHALLOW CLONE of the composition with affected nodes replaced —
 * pure, never mutates the source.
 *
 * E.g. if `binding.key = "title"` and `instanceProps["title"] = "Q3"`,
 * `binding.target = { nodeId: "abc", path: "props.text" }`, then
 * `inner.root[nodeIndex].props.text` is set to "Q3" in the cloned result.
 */
export function applyExposed(comp: Composition, instanceProps: Record<string, unknown>): Composition {
  if (!comp.exposed || comp.exposed.length === 0) return comp;

  let root = comp.root;
  for (const binding of comp.exposed) {
    if (!(binding.key in instanceProps)) continue;
    const value = instanceProps[binding.key];
    const nodeIndex = root.findIndex((n) => n.id === binding.target.nodeId);
    if (nodeIndex === -1) continue;
    // target.path uses dot notation (e.g. "props.width") — convert to
    // RFC6901 JSON Pointer slash notation ("/props/width") for setByPointer.
    const pointer = "/" + binding.target.path.replace(/\./g, "/");
    const updatedNode = setByPointer(root[nodeIndex], pointer, value as import("../types/primitives").Json) as Node;
    root = [...root.slice(0, nodeIndex), updatedNode, ...root.slice(nodeIndex + 1)];
  }

  return root === comp.root ? comp : { ...comp, root };
}

// ── remapTime ─────────────────────────────────────────────────────────────

/**
 * Converts an OUTER frame (the parent composition's playhead) to the INNER
 * composition's frame, handling:
 *   - Rate remapping: inner may have a different fps than outer
 *   - Time offset: the comp node's `time.start` is the outer frame at which
 *     the inner comp's frame 0 begins playing
 *   - Clamping: the inner frame is clamped to [0, inner.duration - 1] so
 *     it never reads outside the inner comp's valid range
 *
 * Blueprint pseudocode: `localF = remapTime(node.time, frame, target.fps)`
 */
export function remapTime(
  nodeTimeStart: number,
  outerFps: number,
  innerFps: number,
  outerFrame: number,
  innerDuration: number
): Frame {
  // How many seconds into the outer comp's timeline is this outer frame?
  const outerSeconds = (outerFrame - nodeTimeStart) / outerFps;
  // Convert to inner comp frames (inner may have a different fps)
  const innerFrame = Math.trunc(outerSeconds * innerFps);
  // Clamp to valid range — prevents out-of-range evaluation
  return toFrame(Math.min(Math.max(0, innerFrame), Math.max(0, innerDuration - 1)));
}

// ── cycle guard ───────────────────────────────────────────────────────────

/**
 * Detects comp-reference cycles (A → B → A, or A → A) by walking the
 * comp chain before evaluating. Throws if a cycle is found — a cycle would
 * cause infinite recursion in the evaluator since each evalCompNode call
 * descends into its resolved Composition.
 */
function assertNoCycle(compId: Id, ctx: EvalCtx, visited: Set<Id>): void {
  if (visited.has(compId)) {
    throw new Error(`[precomp] cycle detected: comp "${compId}" references itself (chain: ${[...visited].join(" → ")} → ${compId})`);
  }
}

// ── evalCompNode ──────────────────────────────────────────────────────────

/**
 * Evaluates a comp-kind node: resolves its source Composition, applies
 * per-instance exposed-prop overrides, remaps the outer frame to the inner
 * comp's timeline, evaluates all inner nodes, and returns a single
 * effectGroup RenderNode wrapping the result with `isolate:true` (RTT).
 *
 * The effectGroup's matrix/opacity/blend come from the comp node's own
 * world values (already stamped onto `baseRenderNode` by the caller,
 * evaluateNode's standard `applyWorld` pass). The inner nodes are evaluated
 * at IDENTITY parent matrix since they're positioned in the INNER comp's
 * own coordinate space — the effectGroup container's own world transform
 * handles the outer positioning.
 *
 * @param node        The comp NodeKind's node (node.source.compId must be set)
 * @param world       The node's computed world matrix (from evaluateNode)
 * @param opacity     The node's computed opacity
 * @param outerFps    The outer composition's fps (for time remapping)
 * @param outerFrame  The current outer frame
 * @param reg         NodeKindRegistry (for evaluating inner nodes)
 * @param ctx         EvalCtx with a REAL resolveComp — must not throw
 * @param visitedComps Cycle-guard set, threaded through recursive calls
 */
export function evalCompNode(
  node: Node,
  world: Mat3,
  opacity: number,
  outerFps: number,
  outerFrame: Frame,
  reg: NodeKindRegistry,
  ctx: EvalCtx,
  visitedComps: Set<Id> = new Set()
): RenderNode[] {
  const compId = node.source?.compId;
  if (!compId) return []; // no source — nothing to render

  // Cycle guard
  assertNoCycle(compId, ctx, visitedComps);
  const nextVisited = new Set(visitedComps);
  nextVisited.add(compId);

  const resolved = ctx.resolveComp(compId);
  const bound = applyExposed(resolved, node.props as Record<string, unknown>);

  const localFrame = remapTime(
    node.time.start as number,
    outerFps,
    bound.fps,
    outerFrame as number,
    bound.duration as number
  );

  // Build a sub-EvalCtx that passes the cycle-guard set down so nested
  // comp nodes can't re-enter a Composition already on the stack.
  const subCtx: EvalCtx = {
    ...ctx,
    fps: bound.fps,
    size: bound.size,
    resolveComp(id: Id): Composition {
      assertNoCycle(id, ctx, nextVisited);
      return ctx.resolveComp(id);
    },
  };

  const parentMatrices = buildParentMatrices(bound.root, localFrame);
  const innerNodes: RenderNode[] = bound.root.flatMap((n) =>
    evaluateNode(n, localFrame, IDENTITY, reg, subCtx, 1, parentMatrices)
  );

  // The inner nodes are in the inner comp's own space (evaluated at
  // IDENTITY parentMat) — no reparentToLocal needed since they're already
  // in local space. The effectGroup itself carries `world` so the renderer
  // places the whole precomp correctly in the outer comp.
  const passes = effectPasses(node, outerFrame);

  const effectGroup: RenderNode = {
    id: node.id,
    matrix: world,
    opacity,
    blend: node.blend,
    t: "effectGroup",
    children: innerNodes,
    passes,
    isolate: true,
  };

  return [effectGroup];
}
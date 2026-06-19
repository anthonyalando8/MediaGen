// packages/core/src/evaluator/adjustments.ts
//
// Phase 2 §4.4 / Deliverable 07: "adjustment: collected at the COMPOSITION
// level — its effects wrap an effectGroup over everything beneath it in
// z-order, inside the same parent scope."
//
// An adjustment node (node.isAdjustment === true) has no visual content of
// its own — its EFFECTS apply to all SIBLINGS rendered below it (lower
// z-order = earlier in the array). This is the After Effects adjustment
// layer model: place an adjustment layer above a stack; its blur/grade/glow
// affects everything beneath it without changing any individual layer.
//
// DESIGN: this runs as a POST-PASS over the already-evaluated + already-
// transition-resolved RenderNode[] for a sibling scope (same "post-pass"
// pattern as applyTransitions). It does NOT run inside evaluateNode per-node
// because it fundamentally needs to see the ENTIRE sibling array at once —
// an adjustment node's effect wraps an effectGroup containing all siblings
// below it, which requires knowing what those siblings evaluated to before
// deciding what to wrap.
//
// ANTI-PATTERN (blueprint Deliverable 07): "Don't special-case masks/mattes
// as renderer-only hacks that bypass the Evaluator. If they don't flow
// through PassSpec, they won't render headlessly in render-worker."
// Same rule applies here — adjustment effects MUST flow through PassSpec
// so the render-worker's headless pipeline produces identical output.

import type { Node } from "../types/node";
import type { Frame } from "../types/ids";
import type { RenderNode } from "contract";
import { IDENTITY } from "./compose-transform";
import { effectPasses } from "./evaluate-node";
import { createId } from "../types/ids";

/**
 * Post-pass over a sibling scope's evaluated RenderNode[] — wraps every
 * contiguous run of nodes BELOW each adjustment node in an effectGroup
 * whose passes come from that adjustment node's own effects[]. Called from
 * evaluateComposition (for comp.root) and from evaluateNode's children
 * recursion (for group/container children), exactly mirroring how
 * applyTransitions is called in both places.
 *
 * Multiple adjustment nodes in the same scope stack correctly:
 *   [A, B, adj1, C, D, adj2]
 *   → adj1 wraps [A, B] → effectGroup1
 *   → adj2 wraps [effectGroup1, C, D] → effectGroup2
 * Each adjustment "sees" everything below it, including the already-wrapped
 * output of any earlier adjustment — exactly matching AE's compositing model.
 *
 * An adjustment node with NO enabled effects is a no-op (its siblings pass
 * through unchanged) — consistent with the effectPasses convention where a
 * disabled effect contributes nothing.
 *
 * `siblings` is the original Node[] (for finding adjustment nodes and their
 * isAdjustment flag); `evaluated` is the corresponding already-evaluated
 * RenderNode[][] at the same indices. Adjustment nodes themselves contribute
 * no RenderNodes (their evaluated[] entry is typically [] since they render
 * nothing visible), but their position in `siblings` determines the split
 * point for what goes "below" them.
 */
export function applyAdjustments(siblings: Node[], evaluated: RenderNode[][], frame: Frame): RenderNode[] {
  // Fast path — no adjustment nodes anywhere in this scope (the common case
  // for Phase 1 documents and non-adjustment compositions).
  if (!siblings.some((n) => n.isAdjustment)) {
    return evaluated.flat();
  }

  // Accumulate RenderNodes left-to-right. When an adjustment node is
  // encountered, wrap the current accumulator in an effectGroup and replace
  // it. The adjustment node itself is NOT pushed to the accumulator.
  let acc: RenderNode[] = [];

  for (let i = 0; i < siblings.length; i++) {
    const node = siblings[i];

    if (!node.isAdjustment) {
      acc.push(...evaluated[i]);
      continue;
    }

    // Adjustment node — its own evaluated[] is intentionally DISCARDED
    // (the node has no visual content of its own; only its effects matter).
    const passes = effectPasses(node, frame);
    if (passes.length === 0 || acc.length === 0) {
      // No enabled effects or nothing below to apply to — skip silently.
      // The adjustment node's own evaluated[] is still discarded.
      continue;
    }

    // Wrap all accumulated below-nodes in a single effectGroup. The group's
    // own matrix/opacity/blend are IDENTITY/1/normal — it's a pure
    // compositing wrapper, not a spatial transform. Its id is derived from
    // the adjustment node's own id so keyed-diff in the renderer can track
    // it across frames without churn (same stable-id convention as
    // effectGroup wrapping in evaluate-node.ts).
    const wrapped: RenderNode = {
      id: `${node.id}-adj` as ReturnType<typeof createId>,
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "effectGroup",
      children: acc,
      passes,
      isolate: true,
    };
    acc = [wrapped];
  }

  return acc;
}
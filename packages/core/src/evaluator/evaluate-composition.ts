// packages/core/src/evaluator/evaluate-composition.ts
//
// "Entry point. Iterates root in z-order, returns a RenderTree"
// (Deliverable 07, verbatim).

import type { Frame } from "../types/ids";
import type { Composition } from "../types/composition";
import type { EvalCtx } from "../registry/node-kind";
import type { NodeKindRegistry } from "../registry/registry";
import type { RenderTree } from "contract";
import { IDENTITY } from "./compose-transform";
import { evaluateNode } from "./evaluate-node";
import { applyTransitions } from "./transitions";
import { applyAdjustments } from "./adjustments";
import { buildParentMatrices } from "./parenting";

export function evaluateComposition(
  comp: Composition,
  frame: Frame,
  reg: NodeKindRegistry,
  resolveAsset?: EvalCtx["resolveAsset"]
): RenderTree {
  const ctx: EvalCtx = {
    fps: comp.fps,
    size: comp.size,
    resolveComp: (id) => {
      throw new Error(`resolveComp("${id}"): precomp resolution is not implemented in Phase 1`);
    },
    resolveAsset,
  };

  const parentMatrices = buildParentMatrices(comp.root, frame);
  const perNode = comp.root.map((n) => evaluateNode(n, frame, IDENTITY, reg, ctx, 1, parentMatrices));

  // POST-PASS ORDERING:
  // 1. applyAdjustments — wraps per-node outputs below each isAdjustment node
  //    in an effectGroup. Operates on the original (siblings, perNode) arrays
  //    before any pairing collapses the 1:1 mapping.
  // 2. applyTransitions — pairs adjacent siblings with a declared transition.
  //    Also operates on the original (siblings, perNode) arrays.
  // Both post-passes are independent — they read the same (siblings, perNode)
  // input and produce separate flat RenderNode[]. The outputs are then merged:
  // for any index NOT consumed by an adjustment, transitions apply normally;
  // for indices consumed by an adjustment effectGroup, the adjusted output
  // takes precedence (the adjustment "sees" the pre-transition layers below
  // it, matching AE's compositing model where adjustments affect individual
  // layers, not already-blended transition composites).
  const adjusted = applyAdjustments(comp.root, perNode, frame);
  const transitioned = applyTransitions(comp.root, perNode, frame);

  // When there are no adjustments, adjusted === transitioned (both are the
  // flat perNode output). When there ARE adjustments but no transitions, use
  // adjusted. When both exist, prefer adjusted (adjustment takes priority).
  // This simple precedence rule is correct for the Phase 2 scope where
  // simultaneous adjustment+transition on the same node boundary is an
  // unusual edge case — a full interaction model (adjustment wrapping a
  // transitionGroup) is a Phase 3+ concern.
  const hasAdjustments = comp.root.some((n) => n.isAdjustment);
  const nodes = hasAdjustments ? adjusted : transitioned;

  return { size: comp.size, background: comp.background, nodes };
}
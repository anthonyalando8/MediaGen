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
      // P2 — precomp resolution. Phase 1 has no nested compositions.
      throw new Error(`resolveComp("${id}"): precomp resolution is not implemented in Phase 1`);
    },
    resolveAsset,
  };
  // Each sibling evaluated independently FIRST (kept as an array of
  // arrays, NOT flattened yet) so applyTransitions can pair z-order-
  // adjacent ones by index — see its doc on why this can't operate on an
  // already-flattened RenderNode[] (per-node boundaries would be lost for
  // any sibling whose own evaluation fans out to more than one
  // RenderNode, e.g. a plain "group" with children).
  const perNode = comp.root.map((n) => evaluateNode(n, frame, IDENTITY, reg, ctx));
  const nodes = applyTransitions(comp.root, perNode, frame);
  return { size: comp.size, background: comp.background, nodes };
}
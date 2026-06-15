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

export function evaluateComposition(comp: Composition, frame: Frame, reg: NodeKindRegistry): RenderTree {
  const ctx: EvalCtx = {
    fps: comp.fps,
    size: comp.size,
    resolveComp: (id) => {
      // P2 — precomp resolution. Phase 1 has no nested compositions.
      throw new Error(`resolveComp("${id}"): precomp resolution is not implemented in Phase 1`);
    },
  };
  const nodes = comp.root.flatMap((n) => evaluateNode(n, frame, IDENTITY, reg, ctx));
  return { size: comp.size, background: comp.background, nodes };
}

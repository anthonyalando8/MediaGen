// packages/core/src/types/matte.ts
//
// Phase 2 §4.2 — a sibling's alpha or luma channel stencils this node.
// Applied as a "matte" pass (renderer-webgl/passes/matte-pass.ts); `core`
// only defines the data shape — the matte source must currently be a
// SIBLING (same parent scope) for the renderer to resolve it within the
// same pass-graph pass, per §5/§7's pass-ordering model.

import type { Id } from "./ids";

export interface TrackMatteRef {
  sourceNodeId: Id;
  type: "alpha" | "luma" | "alpha-inv" | "luma-inv";
}
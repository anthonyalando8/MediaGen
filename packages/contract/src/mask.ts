// packages/contract/src/mask.ts
//
// Mask path types re-declared in contract so renderer-webgl can import
// them without creating a forbidden contract→core dependency. Identical
// to core/src/types/mask.ts's BezierPoint/MaskPath — kept in sync by
// convention (core's types mirror contract's, not the other way around,
// since core declares the authoring model and contract declares the
// rendering model; they happen to share the same shape for paths).

import type { Vec2 } from "./primitives";

export interface BezierPoint {
  point: Vec2;
  inHandle?: Vec2;
  outHandle?: Vec2;
}

export interface MaskPath {
  points: BezierPoint[];
  closed: boolean;
}
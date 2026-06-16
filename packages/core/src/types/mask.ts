// packages/core/src/types/mask.ts
//
// Phase 2 §4.2 — vector-path masks, clipping a node's rendered content.
// Authored by the mask pen tool (ui/mask-pen, P2); applied as a "mask" pass
// (PassSpec, see contract's render-node.ts P2 additions) by
// renderer-webgl/passes/mask-pass.ts. `core` only defines the data shape —
// path rasterization lives entirely behind the renderer.

import type { Channel } from "./channel";
import type { Id } from "./ids";
import type { Vec2 } from "./primitives";

/**
 * One vertex of a `MaskPath` — a Bezier anchor with optional in/out tangent
 * handles, same `[number, number]` convention as `Keyframe.inHandle`/
 * `outHandle` (keyframe.ts), but here the pair is a (dx, dy) OFFSET from
 * `point` (comp-space units), not a normalized [0,1] time/value fraction —
 * the two live in different spaces (time-vs-value vs. comp-space XY) so
 * reusing the keyframe convention's exact semantics would be misleading.
 */
export interface BezierPoint {
  point: Vec2;
  inHandle?: Vec2;
  outHandle?: Vec2;
}

/** A closed or open Bezier path — animatable in full via `Mask.channels`' `"mask.<id>.path"` entry (vertices move together as one keyframed value). */
export interface MaskPath {
  points: BezierPoint[];
  closed: boolean;
}

/** One mask on `Node.masks[]` — multiple masks combine via `mode` in array order (e.g. add, then subtract). */
export interface Mask {
  id: Id;
  mode: "add" | "subtract" | "intersect";
  path: MaskPath;
  /** Edge softness, in comp-space pixels. */
  feather: number;
  /** This mask's own opacity (independent of the node's `opacity`). */
  opacity: number;
  inverted: boolean;
  /** Animated path/feather — paths: `"mask.<id>.path"`; feather: `"mask.<id>.feather"`. */
  channels?: Channel[];
}
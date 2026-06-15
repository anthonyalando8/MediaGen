// packages/core/src/types/keyframe.ts
import type { ColorOKLCH, PathData, Vec2, Vec3 } from "./primitives";
import type { Frame } from "./ids";

export type ChannelValue = number | Vec2 | Vec3 | ColorOKLCH | PathData;

export type Interp = "hold" | "linear" | "bezier";

export interface Keyframe<V = ChannelValue> {
  frame: Frame;
  value: V;
  interp: Interp;
  /** Bezier tangent handles; default to [1/3, 1/3] / [2/3, 2/3] if absent. */
  inHandle?: [number, number];
  outHandle?: [number, number];
}

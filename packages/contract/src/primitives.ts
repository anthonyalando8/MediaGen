// packages/contract/src/primitives.ts
// Pure types, zero runtime — the neutral seam (Deliverable 02, §2.1: "contract → anything ❌").

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ColorOKLCH {
  l: number;
  c: number;
  h: number;
  alpha?: number;
}

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "add"
  | "darken"
  | "lighten";

/**
 * Row-major 2D affine matrix as [a, b, tx, c, d, ty, 0, 0, 1], representing
 *   | a  b  tx |
 *   | c  d  ty |
 *   | 0  0  1  |
 * applied to a column vector [x, y, 1].
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * P2 — path-typed channels animate mask/shape vertices (§4 of the v1.0 doc).
 * Inert in Phase 1: the type exists so Channel<PathData> compiles, nothing
 * samples or renders it yet.
 */
export interface PathData {
  points: Vec2[];
  closed: boolean;
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// packages/core/src/evaluator/compose-transform.ts
//
// Mat3 = [a, b, tx, c, d, ty, 0, 0, 1] — row-major 2D affine:
//   | a  b  tx |
//   | c  d  ty |
//   | 0  0  1  |
// applied to a column vector [x, y, 1].

import type { Mat3 } from "../types/primitives";
import type { Transform } from "../types/transform";

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Matrix product A * B (B's transform is applied first, then A's). Used as
 * `mul(parentMat, localMat)` to compose a child's world matrix.
 */
export function mul(a: Mat3, b: Mat3): Mat3 {
  const [a1, b1, tx1, c1, d1, ty1] = a;
  const [a2, b2, tx2, c2, d2, ty2] = b;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    a1 * tx2 + b1 * ty2 + tx1,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    c1 * tx2 + d1 * ty2 + ty1,
    0,
    0,
    1,
  ];
}

/**
 * Builds a local Mat3 from a Transform: T(position) · R(rotation) · S(scale) · T(-anchor).
 * `rotation` is in degrees. Only `position.x`/`position.y` participate (2D);
 * `position.z` is reserved for future depth-ordering (P2+).
 */
export function composeTransform(transform: Transform): Mat3 {
  const { position, scale, rotation, anchor } = transform;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const a = cos * scale.x;
  const b = -sin * scale.y;
  const c = sin * scale.x;
  const d = cos * scale.y;
  const tx = position.x - (a * anchor.x + b * anchor.y);
  const ty = position.y - (c * anchor.x + d * anchor.y);

  return [a, b, tx, c, d, ty, 0, 0, 1];
}

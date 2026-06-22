// packages/renderer-webgl/src/matrix.ts
import { Matrix } from "pixi.js";
import type { Mat3 } from "contract";

/**
 * Converts our row-major Mat3 (Deliverable 05.1: [a,b,tx,c,d,ty,0,0,1],
 * representing x'=m[0]x+m[1]y+m[2], y'=m[3]x+m[4]y+m[5]) to a Pixi
 * Matrix(a,b,c,d,tx,ty), which represents x'=a·x+c·y+tx, y'=b·x+d·y+ty.
 * Matching the two: pixi.a=m[0], pixi.c=m[1], pixi.tx=m[2], pixi.b=m[3],
 * pixi.d=m[4], pixi.ty=m[5].
 */
export function toPixiMatrix(m: Mat3): Matrix {
  return new Matrix(m[0], m[3], m[1], m[4], m[2], m[5]);
}

/** Apply our row-major Mat3 to a point: x'=m[0]x+m[1]y+m[2], y'=m[3]x+m[4]y+m[5]. */
export function applyMat3(m: Mat3, p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2],
    y: m[3] * p.x + m[4] * p.y + m[5],
  };
}

/** Inverts an affine Mat3 ([a,b,tx,c,d,ty,0,0,1]). Throws if singular. */
export function invertMat3(m: Mat3): Mat3 {
  const [a, b, tx, c, d, ty] = m;
  const det = a * d - b * c;
  if (det === 0) throw new Error("invertMat3: matrix is singular (determinant 0)");
  const invDet = 1 / det;
  const ia = d * invDet;
  const ib = -b * invDet;
  const ic = -c * invDet;
  const id = a * invDet;
  const itx = -(ia * tx + ib * ty);
  const ity = -(ic * tx + id * ty);
  return [ia, ib, itx, ic, id, ity, 0, 0, 1];
}

/**
 * Maps an axis-aligned comp-space rect through `invertMat3(worldMatrix)`
 * into the matrix's local space, returning the AXIS-ALIGNED BOUNDING BOX of
 * the (possibly rotated, into a parallelogram) result. Used by
 * reconcileEffectGroup's matte/mask filterArea: a Pixi Filter's
 * `filterArea` is specified in the FILTERED CONTAINER'S OWN LOCAL SPACE —
 * Pixi internally applies `container.worldTransform` to it
 * (FilterSystem.mjs's `_calculateFilterArea`) to get the actual sampled GPU
 * region. Since effectGroup Containers carry the node's real world matrix
 * (not identity — see scene-graph.ts's `setFromMatrix(toPixiMatrix(node.matrix))`,
 * called for EVERY RenderNode including effectGroup), a naive
 * `filterArea = (0,0,compW,compH)` would get DOUBLE-transformed by that
 * world matrix, sampling the wrong region entirely. This computes the
 * correct LOCAL-space filterArea so that after Pixi's own worldTransform
 * multiply, the EFFECTIVE sampled region is exactly comp space — matching
 * where the matte/mask stencil textures are rasterised.
 */
export function inverseTransformRect(
  worldMatrix: Mat3,
  rect: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const inv = invertMat3(worldMatrix);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((p) => applyMat3(inv, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
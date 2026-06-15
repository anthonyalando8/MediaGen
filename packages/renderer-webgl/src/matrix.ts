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
// packages/renderer-webgl/src/matrix.test.ts
import { describe, expect, it } from "vitest";
import { Matrix } from "pixi.js";
import type { Mat3 } from "contract";
import { toPixiMatrix } from "./matrix";

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe("toPixiMatrix", () => {
  it("maps the identity Mat3 to the identity Pixi Matrix", () => {
    const m = toPixiMatrix(IDENTITY);
    expect(m).toEqual(new Matrix(1, 0, 0, 1, 0, 0));
  });

  it("maps a translate+scale Mat3 to the equivalent Pixi Matrix", () => {
    const mat3: Mat3 = [2, 0, 10, 0, 2, 20, 0, 0, 1];
    const m = toPixiMatrix(mat3);
    expect(m).toEqual(new Matrix(2, 0, 0, 2, 10, 20));

    // Point (1,1) under our convention: x'=2*1+0*1+10=12, y'=0*1+2*1+20=22.
    const point = m.apply({ x: 1, y: 1 });
    expect(point.x).toBe(12);
    expect(point.y).toBe(22);
  });

  it("maps a rotation+shear Mat3 with the row/column transpose applied correctly", () => {
    // a=0, b=1, tx=0, c=-1, d=0, ty=0 -- our x'=0*x+1*y+0, y'=-1*x+0*y+0 (90° rotation).
    const mat3: Mat3 = [0, 1, 0, -1, 0, 0, 0, 0, 1];
    const m = toPixiMatrix(mat3);

    const point = m.apply({ x: 1, y: 0 });
    // our formula: x' = 0*1 + 1*0 + 0 = 0; y' = -1*1 + 0*0 + 0 = -1.
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(-1);
  });
});
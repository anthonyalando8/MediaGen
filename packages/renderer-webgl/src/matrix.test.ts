// packages/renderer-webgl/src/matrix.test.ts (extends existing matrix.test.ts if present)
//
// REGRESSION (found via manual browser testing — see scene-graph.ts's
// reconcileEffectGroup doc): a mask/matte effectGroup's Container carries
// the node's REAL world matrix (not identity, unlike transitionGroup).
// Pixi's FilterSystem multiplies `filterArea` by `container.worldTransform`
// internally — so a naive `filterArea=(0,0,compW,compH)` gets
// double-transformed for any node with a non-identity matrix (translated,
// scaled, or rotated), silently sampling the WRONG region (reads as
// "uniformly dim/wrong colors", not a crash — easy to miss without a real
// GPU). `inverseTransformRect` computes the correct LOCAL-space rect that,
// after Pixi's own worldTransform multiply, lands back on exactly the
// intended comp-space rect.

import { describe, expect, it } from "vitest";
import { inverseTransformRect, applyMat3, invertMat3 } from "./matrix";
import type { Mat3 } from "contract";

describe("invertMat3", () => {
  it("inverts identity to identity", () => {
    const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const result = invertMat3(identity);
    for (let i = 0; i < 9; i++) expect(result[i]).toBeCloseTo(identity[i], 10);
  });

  it("inverts a pure translation correctly", () => {
    const translate: Mat3 = [1, 0, 100, 0, 1, 50, 0, 0, 1];
    const inv = invertMat3(translate);
    expect(applyMat3(inv, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
  });

  it("inverts a pure scale correctly", () => {
    const scale: Mat3 = [2, 0, 0, 0, 2, 0, 0, 0, 1];
    const inv = invertMat3(scale);
    expect(applyMat3(inv, { x: 200, y: 200 })).toEqual({ x: 100, y: 100 });
  });

  it("throws on a singular (zero-scale) matrix", () => {
    const singular: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 1];
    expect(() => invertMat3(singular)).toThrow();
  });

  it("applying M then invertM(M) round-trips to the original point", () => {
    const m: Mat3 = [2.638, 0, 344.05, 0, 2.749, 423.61, 0, 0, 1]; // matches the user's reported screenshot transform
    const inv = invertMat3(m);
    const original = { x: 123, y: 456 };
    const transformed = applyMat3(m, original);
    const back = applyMat3(inv, transformed);
    expect(back.x).toBeCloseTo(original.x, 6);
    expect(back.y).toBeCloseTo(original.y, 6);
  });
});

describe("inverseTransformRect", () => {
  it("for IDENTITY matrix, returns the rect unchanged", () => {
    const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const rect = { x: 0, y: 0, width: 1080, height: 1920 };
    expect(inverseTransformRect(identity, rect)).toEqual(rect);
  });

  it("for a translated node, the local rect is offset by -translation (so re-applying the world matrix lands back on the original comp rect)", () => {
    const m: Mat3 = [1, 0, 344, 0, 1, 423, 0, 0, 1]; // matches user's reported X/Y
    const rect = { x: 0, y: 0, width: 1080, height: 1920 };
    const local = inverseTransformRect(m, rect);

    // Re-applying the world matrix to the local rect's corners must
    // reconstruct exactly the original comp rect — this is the actual
    // invariant that was broken before this fix.
    const corners = [
      { x: local.x, y: local.y },
      { x: local.x + local.width, y: local.y + local.height },
    ].map((p) => applyMat3(m, p));
    expect(corners[0].x).toBeCloseTo(rect.x, 6);
    expect(corners[0].y).toBeCloseTo(rect.y, 6);
    expect(corners[1].x).toBeCloseTo(rect.x + rect.width, 6);
    expect(corners[1].y).toBeCloseTo(rect.y + rect.height, 6);
  });

  it("for a scaled node (matches user's reported Scale X=2.638 Y=2.749), the local rect shrinks proportionally and round-trips exactly", () => {
    const m: Mat3 = [2.638, 0, 344.05, 0, 2.749, 423.61, 0, 0, 1];
    const rect = { x: 0, y: 0, width: 1080, height: 1920 };
    const local = inverseTransformRect(m, rect);

    // The local rect must be smaller than the comp rect (since the node is
    // scaled UP — its local space covers less of the comp per local unit).
    expect(local.width).toBeLessThan(rect.width);
    expect(local.height).toBeLessThan(rect.height);

    // Round-trip: re-applying m to local's corners reconstructs comp rect.
    const topLeft = applyMat3(m, { x: local.x, y: local.y });
    const bottomRight = applyMat3(m, { x: local.x + local.width, y: local.y + local.height });
    expect(topLeft.x).toBeCloseTo(rect.x, 4);
    expect(topLeft.y).toBeCloseTo(rect.y, 4);
    expect(bottomRight.x).toBeCloseTo(rect.x + rect.width, 4);
    expect(bottomRight.y).toBeCloseTo(rect.y + rect.height, 4);
  });

  it("for a rotated node, returns the AXIS-ALIGNED bounding box of the rotated rect (not a parallelogram)", () => {
    const angle = Math.PI / 4; // 45 degrees
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const m: Mat3 = [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    const local = inverseTransformRect(m, rect);

    // A 45-degree rotation of a square's bounding box, when inverse-mapped,
    // produces a larger local rect (the AABB of the de-rotated comp rect).
    expect(local.width).toBeGreaterThan(rect.width);
    expect(local.height).toBeGreaterThan(rect.height);
  });
});
// packages/nodekinds/src/image.test.ts
import { describe, expect, it } from "vitest";
import type { EvalCtx, Node } from "core";
import { imageBox } from "./image";

function makeNode(props: Record<string, unknown>, assetId = "a1"): Node {
  return {
    id: "n1",
    kind: "image",
    name: "Image",
    transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
    opacity: 1,
    blend: "normal",
    time: { start: 0, duration: 10 },
    origin: "user",
    props,
    channels: [],
    source: { assetId },
  } as unknown as Node;
}

function ctxWithDims(width: number, height: number, dims?: { width: number; height: number }): EvalCtx {
  return {
    size: { width, height },
    resolveAsset: dims ? () => dims : () => undefined,
  } as unknown as EvalCtx;
}

describe("imageBox", () => {
  it("falls back to the full frame when the asset's dims are unknown (back-compat default)", () => {
    const box = imageBox(makeNode({ fit: "cover" }), ctxWithDims(1080, 1920));
    expect(box).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it("contain-fits to the asset's native aspect when dims ARE known (unchanged pre-existing behavior)", () => {
    const box = imageBox(makeNode({ fit: "cover" }), ctxWithDims(1000, 1000, { width: 2000, height: 1000 }));
    // 2:1 asset into a 1000x1000 frame → scale = min(1000/2000, 1000/1000) = 0.5 → 1000x500, centered
    expect(box).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
  });

  it("uses an explicit boxX/Y/W/H override (fractions of frame) when present, ignoring asset dims", () => {
    const box = imageBox(
      makeNode({ fit: "cover", boxX: 0, boxY: 0.5, boxW: 1, boxH: 0.5 }),
      ctxWithDims(1080, 1920, { width: 4000, height: 3000 })
    );
    expect(box).toEqual({ x: 0, y: 960, width: 1080, height: 960 });
  });

  it("box override works even with no resolveAsset/dims at all", () => {
    const box = imageBox(makeNode({ fit: "cover", boxX: 0.5, boxY: 0, boxW: 0.5, boxH: 1 }), ctxWithDims(1080, 1920));
    expect(box).toEqual({ x: 540, y: 0, width: 540, height: 1920 });
  });
});

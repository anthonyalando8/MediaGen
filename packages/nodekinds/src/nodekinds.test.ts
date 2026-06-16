// packages/nodekinds/src/nodekinds.test.ts
import { describe, expect, it } from "vitest";
import { NodeKindRegistry, toFrame } from "core";
import type { EvalCtx, Id } from "core";
import { registerBuiltins, builtinKinds } from "./register-builtins";
import { groupKind } from "./group";
import { imageKind } from "./image";
import { videoKind } from "./video";
import { textKind } from "./text";
import { shapeKind } from "./shape";
import { WHITE } from "./common";

const ctx: EvalCtx = {
  fps: 30,
  size: { width: 1080, height: 1920 },
  resolveComp: (id) => {
    throw new Error(`resolveComp("${id}") not implemented in tests`);
  },
};

const PLACEHOLDER_MATRIX = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe("registerBuiltins", () => {
  it("registers all five Phase 1 kinds without collision", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    expect(reg.list()).toHaveLength(5);
    expect(builtinKinds.map((k) => k.kind).sort()).toEqual(["group", "image", "shape", "text", "video"]);
    for (const kind of builtinKinds) {
      expect(reg.get(kind.kind)).toBe(kind);
    }
  });

  it("create() produces nodes whose props validate against their own schema", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    for (const kind of builtinKinds) {
      const node = reg.create(kind.kind);
      expect(reg.validate(node).success).toBe(true);
    }
  });
});

describe("groupKind", () => {
  it("renders a group RenderNode with empty children (filled by the Evaluator)", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("group");
    expect(node.children).toEqual([]);

    const out = groupKind.render(node, toFrame(0), ctx);
    expect(out).toEqual([
      { id: node.id, matrix: PLACEHOLDER_MATRIX, opacity: 1, blend: "normal", t: "group", children: [] },
    ]);
  });
});

describe("imageKind", () => {
  it("renders an image RenderNode referencing source.assetId", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("image", { source: { assetId: "asset_123" as Id } });

    const out = imageKind.render(node, toFrame(0), ctx);
    expect(out).toEqual([
      {
        id: node.id,
        matrix: PLACEHOLDER_MATRIX,
        opacity: 1,
        blend: "normal",
        t: "image",
        tex: { assetId: "asset_123" },
        fit: "contain",
        box: { x: 0, y: 0, width: 1080, height: 1920 },
      },
    ]);
  });

  it("falls back to the composition size for box/bounds (P1) — render() and bounds() agree", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("image");
    const expectedBox = { x: 0, y: 0, width: 1080, height: 1920 };

    expect(imageKind.bounds?.(node, toFrame(0), ctx)).toEqual(expectedBox);
    expect(imageKind.render(node, toFrame(0), ctx)[0]).toMatchObject({ box: expectedBox });
  });

  it("sizes box to the asset's real aspect ratio (centered, letterboxed) when ctx.resolveAsset knows its dimensions", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("image", { source: { assetId: "wide_asset" as Id } });

    // a 1600x900 (16:9) image inside a 1080x1920 (9:16) comp frame:
    // scale = min(1080/1600, 1920/900) = min(0.675, 2.133) = 0.675
    // -> width = 1080, height = 607.5 -> centered vertically.
    const ctxWithAsset: EvalCtx = {
      ...ctx,
      resolveAsset: (assetId) => (assetId === "wide_asset" ? { width: 1600, height: 900 } : undefined),
    };

    const box = imageKind.bounds?.(node, toFrame(0), ctxWithAsset);
    expect(box?.width).toBeCloseTo(1080);
    expect(box?.height).toBeCloseTo(607.5);
    expect(box?.x).toBeCloseTo(0);
    expect(box?.y).toBeCloseTo((1920 - 607.5) / 2);

    // render() must emit the SAME box (the bug this whole feature fixed).
    expect(imageKind.render(node, toFrame(0), ctxWithAsset)[0]).toMatchObject({ box });
  });

  it("falls back to the composition frame when resolveAsset doesn't know this asset", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("image", { source: { assetId: "unknown_asset" as Id } });
    const ctxWithAsset: EvalCtx = { ...ctx, resolveAsset: () => undefined };

    expect(imageKind.bounds?.(node, toFrame(0), ctxWithAsset)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });
});

describe("videoKind", () => {
  it("maps the timeline frame to a source frame via time.in", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("video", {
      source: { assetId: "video_123" as Id },
      time: { start: toFrame(10), duration: toFrame(30), in: toFrame(5) },
    });

    const out = videoKind.render(node, toFrame(15), ctx);
    expect(out).toEqual([
      {
        id: node.id,
        matrix: PLACEHOLDER_MATRIX,
        opacity: 1,
        blend: "normal",
        t: "video",
        tex: { assetId: "video_123", frame: 10 }, // in(5) + (15 - start(10))
        fit: "contain",
        box: { x: 0, y: 0, width: 1080, height: 1920 },
      },
    ]);
  });

  it("defaults time.in to 0 when absent", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("video", { source: { assetId: "video_123" as Id } });
    // baseNode() default: time = { start: 0, duration: 150 }
    const out = videoKind.render(node, toFrame(20), ctx);
    expect(out[0]).toMatchObject({ t: "video", tex: { assetId: "video_123", frame: 20 } });
  });

  it("falls back to the composition size for box/bounds (P1) — render() and bounds() agree", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("video");
    const expectedBox = { x: 0, y: 0, width: 1080, height: 1920 };

    expect(videoKind.bounds?.(node, toFrame(0), ctx)).toEqual(expectedBox);
    expect(videoKind.render(node, toFrame(0), ctx)[0]).toMatchObject({ box: expectedBox });
  });
});

describe("textKind", () => {
  it("lays out one GlyphRun per line, stacked by fontSize * lineHeight", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("text", { props: { ...reg.get("text").defaults().props, text: "Hello\nWorld" } });

    const out = textKind.render(node, toFrame(0), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: node.id, t: "text" });
    if (out[0].t !== "text") throw new Error("expected text RenderNode");

    expect(out[0].runs).toEqual([
      { text: "Hello", x: 0, y: 0, fontFamily: "Inter", fontSize: 64, weight: 400, color: WHITE },
      { text: "World", x: 0, y: 64 * 1.2, fontFamily: "Inter", fontSize: 64, weight: 400, color: WHITE },
    ]);
  });
});

describe("shapeKind", () => {
  it("renders a rect by default", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("shape");

    const out = shapeKind.render(node, toFrame(0), ctx);
    expect(out[0]).toMatchObject({
      t: "shape",
      geom: { kind: "rect", width: 200, height: 200, radius: 0 },
      fill: { l: 0.6, c: 0.15, h: 250 },
      stroke: undefined,
    });
  });

  it("renders an ellipse (no radius) and a line (length = width)", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);

    const ellipse = reg.create("shape", { props: { ...reg.get("shape").defaults().props, shape: "ellipse" } });
    const ellipseOut = shapeKind.render(ellipse, toFrame(0), ctx);
    expect(ellipseOut[0]).toMatchObject({ geom: { kind: "ellipse", width: 200, height: 200 } });

    const line = reg.create("shape", { props: { ...reg.get("shape").defaults().props, shape: "line", width: 300 } });
    const lineOut = shapeKind.render(line, toFrame(0), ctx);
    expect(lineOut[0]).toMatchObject({ geom: { kind: "line", length: 300 } });
  });

  it("passes through an optional stroke", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const strokeColor = { l: 0, c: 0, h: 0 };
    const node = reg.create("shape", {
      props: { ...reg.get("shape").defaults().props, strokeColor, strokeWidth: 4 },
    });

    const out = shapeKind.render(node, toFrame(0), ctx);
    expect(out[0]).toMatchObject({ stroke: { color: strokeColor, width: 4 } });
    expect(reg.validate(node).success).toBe(true);
  });

  it("omits stroke when strokeWidth is absent or zero", () => {
    const reg = new NodeKindRegistry();
    registerBuiltins(reg);
    const node = reg.create("shape");
    expect(shapeKind.render(node, toFrame(0), ctx)[0]).toMatchObject({ stroke: undefined });
  });
});
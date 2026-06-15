// apps/editor/src/viewport/geometry.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlyphRun, Mat3, RenderNode } from "contract";
import {
  applyMat3,
  compToScreen,
  computeFitTransform,
  DEFAULT_BOUNDS,
  getGroupBounds,
  getOrientedCorners,
  getRectCenter,
  getRenderNodeBounds,
  getScaleHandles,
  invertMat3,
  measureTextRun,
  rotationMat3,
  scaleMat3,
  screenDeltaToComp,
  screenToComp,
  transformAroundPivot,
  translationMat3,
} from "./geometry";

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe("applyMat3", () => {
  it("identity leaves a point unchanged", () => {
    expect(applyMat3(IDENTITY, { x: 12, y: 34 })).toEqual({ x: 12, y: 34 });
  });

  it("translate+scale: x'=a·x+b·y+tx, y'=c·x+d·y+ty", () => {
    const m: Mat3 = [2, 0, 10, 0, 2, 20, 0, 0, 1];
    expect(applyMat3(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 22 });
  });
});

describe("invertMat3", () => {
  it("inverting the identity gives the identity", () => {
    expect(invertMat3(IDENTITY)).toEqual(IDENTITY);
  });

  it("invert(m) undoes m for an arbitrary affine matrix", () => {
    const m: Mat3 = [2, 0.5, 10, -0.3, 1.5, -5, 0, 0, 1];
    const inv = invertMat3(m);
    const p = { x: 7, y: -3 };
    const round = applyMat3(inv, applyMat3(m, p));
    expect(round.x).toBeCloseTo(p.x);
    expect(round.y).toBeCloseTo(p.y);
  });

  it("throws on a singular matrix", () => {
    const singular: Mat3 = [1, 1, 0, 1, 1, 0, 0, 0, 1]; // det = 1*1 - 1*1 = 0
    expect(() => invertMat3(singular)).toThrow();
  });
});

describe("getRenderNodeBounds", () => {
  function shapeNode(geom: RenderNode & { t: "shape" }): RenderNode {
    return geom;
  }

  it("rect/ellipse shapes use geom width/height", () => {
    const rect = shapeNode({
      id: "a",
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 100, height: 50, radius: 0 },
    });
    expect(getRenderNodeBounds(rect)).toEqual({ x: 0, y: 0, width: 100, height: 50 });

    const ellipse = shapeNode({
      id: "b",
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "ellipse", width: 40, height: 20 },
    });
    expect(getRenderNodeBounds(ellipse)).toEqual({ x: 0, y: 0, width: 40, height: 20 });
  });

  it("line shapes use geom.length and the stroke width (or 1px fallback) for height", () => {
    const lineNoStroke = shapeNode({
      id: "c",
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "line", length: 100 },
    });
    expect(getRenderNodeBounds(lineNoStroke)).toEqual({ x: 0, y: -0.5, width: 100, height: 1 });

    const lineStroked = shapeNode({
      id: "d",
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "line", length: 100 },
      stroke: { color: { l: 0, c: 0, h: 0 }, width: 4 },
    });
    expect(getRenderNodeBounds(lineStroked)).toEqual({ x: 0, y: -2, width: 100, height: 4 });
  });

  it("text bounds union all glyph runs", () => {
    const text: RenderNode = {
      id: "t",
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "text",
      runs: [
        { text: "Hello", x: 0, y: 0, fontFamily: "Inter", fontSize: 64, weight: 400, color: { l: 1, c: 0, h: 0 } },
        { text: "World", x: 0, y: 76.8, fontFamily: "Inter", fontSize: 64, weight: 400, color: { l: 1, c: 0, h: 0 } },
      ],
    };
    const bounds = getRenderNodeBounds(text);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0); // first run's y — runs are top-left anchored (scene-graph.ts), not baseline
    expect(bounds.width).toBeCloseTo(5 * 64 * 0.6); // "Hello"/"World" are both 5 chars
    expect(bounds.height).toBeCloseTo(76.8 + 64 * 1.2); // second run's y + its line height
  });

  it("empty text, image, video, and group fall back to DEFAULT_BOUNDS", () => {
    const emptyText: RenderNode = { id: "t", matrix: IDENTITY, opacity: 1, blend: "normal", t: "text", runs: [] };
    const image: RenderNode = {
      id: "i",
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "image",
      tex: { assetId: "a1" },
      fit: "contain",
    };
    const group: RenderNode = { id: "g", matrix: IDENTITY, opacity: 1, blend: "normal", t: "group", children: [] };

    expect(getRenderNodeBounds(emptyText)).toEqual(DEFAULT_BOUNDS);
    expect(getRenderNodeBounds(image)).toEqual(DEFAULT_BOUNDS);
    expect(getRenderNodeBounds(group)).toEqual(DEFAULT_BOUNDS);
  });
});

describe("getOrientedCorners", () => {
  it("identity matrix returns the bounds' own corners (TL, TR, BR, BL)", () => {
    const corners = getOrientedCorners({ x: 0, y: 0, width: 100, height: 50 }, IDENTITY);
    expect(corners).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it("translate+scale matrix maps every corner", () => {
    const m: Mat3 = [2, 0, 10, 0, 2, 20, 0, 0, 1];
    const corners = getOrientedCorners({ x: 0, y: 0, width: 100, height: 50 }, m);
    expect(corners).toEqual([
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ]);
  });
});

describe("getRectCenter", () => {
  it("returns the midpoint of bounds", () => {
    expect(getRectCenter({ x: 0, y: 0, width: 100, height: 50 })).toEqual({ x: 50, y: 25 });
    expect(getRectCenter({ x: 10, y: 20, width: 100, height: 50 })).toEqual({ x: 60, y: 45 });
  });
});

describe("getScaleHandles", () => {
  const bounds = { x: 0, y: 0, width: 100, height: 50 };
  const handles = getScaleHandles(bounds);

  it("returns 8 handles: 4 corners (both axes) + 4 edge midpoints (one axis each)", () => {
    expect(handles).toHaveLength(8);
    expect(handles.slice(0, 4).every((h) => h.axes.x && h.axes.y)).toBe(true);
    expect(handles.slice(4).filter((h) => h.axes.x && !h.axes.y)).toHaveLength(2); // left/right
    expect(handles.slice(4).filter((h) => !h.axes.x && h.axes.y)).toHaveLength(2); // top/bottom
  });

  it("each handle's pivotLocal is the opposite corner/edge — local and pivotLocal are never equal", () => {
    for (const handle of handles) {
      expect(handle.local).not.toEqual(handle.pivotLocal);
    }
  });

  it("a corner handle's pivot is the diagonally opposite corner", () => {
    const tl = handles.find((h) => h.local.x === 0 && h.local.y === 0)!;
    expect(tl.pivotLocal).toEqual({ x: 100, y: 50 });
  });

  it("an edge handle's pivot is the midpoint of the opposite edge, on the same fixed axis", () => {
    const right = handles.find((h) => h.local.x === 100 && h.local.y === 25)!;
    expect(right.axes).toEqual({ x: true, y: false });
    expect(right.pivotLocal).toEqual({ x: 0, y: 25 });
  });
});

function rectRenderNode(id: string, matrix: Mat3, width: number, height: number): RenderNode {
  return { id: id as RenderNode["id"], matrix, opacity: 1, blend: "normal", t: "shape", geom: { kind: "rect", width, height, radius: 0 } };
}

function groupRenderNode(id: string, matrix: Mat3): RenderNode {
  return { id: id as RenderNode["id"], matrix, opacity: 1, blend: "normal", t: "group", children: [] };
}

describe("getGroupBounds", () => {
  it("with an identity group matrix, returns the AABB union of descendants' bounds directly", () => {
    // a (0,0)-(100,100) shape and a (200,200)-(300,300) shape (matrix = translate by 200,200)
    const a = rectRenderNode("a", IDENTITY, 100, 100);
    const b = rectRenderNode("b", [1, 0, 200, 0, 1, 200, 0, 0, 1], 100, 100);

    const bounds = getGroupBounds(IDENTITY, [a, b]);

    expect(bounds).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it("maps descendant bounds into the GROUP's local space via invertMat3(groupMatrix)", () => {
    // group matrix: translate by (50, 50) — a child sitting at world (50,50)-(150,150)
    // should appear at LOCAL (0,0)-(100,100) once the group's own offset is factored out.
    const groupMatrix: Mat3 = [1, 0, 50, 0, 1, 50, 0, 0, 1];
    const child = rectRenderNode("child", [1, 0, 50, 0, 1, 50, 0, 0, 1], 100, 100);

    const bounds = getGroupBounds(groupMatrix, [child]);

    expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("ignores 'group'-typed descendants (no intrinsic bounds)", () => {
    const a = rectRenderNode("a", IDENTITY, 100, 100);
    const nestedGroup = groupRenderNode("nested", [1, 0, 1000, 0, 1, 1000, 0, 0, 1]);

    const bounds = getGroupBounds(IDENTITY, [a, nestedGroup]);

    expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("falls back to DEFAULT_BOUNDS when there are no eligible descendants", () => {
    expect(getGroupBounds(IDENTITY, [])).toEqual(DEFAULT_BOUNDS);
    expect(getGroupBounds(IDENTITY, [groupRenderNode("nested", IDENTITY)])).toEqual(DEFAULT_BOUNDS);
  });

  it("falls back to DEFAULT_BOUNDS for a singular group matrix (e.g. 0 scale mid-drag)", () => {
    const singular: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 1];
    const a = rectRenderNode("a", IDENTITY, 100, 100);
    expect(getGroupBounds(singular, [a])).toEqual(DEFAULT_BOUNDS);
  });
});

describe("computeFitTransform / compToScreen / screenToComp", () => {
  it("contains a portrait composition within a landscape viewport, centered horizontally", () => {
    const fit = computeFitTransform({ width: 1080, height: 1920 }, { width: 1600, height: 1000 });
    // height-constrained: scale = 1000/1920
    expect(fit.scale).toBeCloseTo(1000 / 1920);
    expect(fit.y).toBeCloseTo(0);
    expect(fit.x).toBeGreaterThan(0);
  });

  it("zoom multiplies the base fit scale", () => {
    const base = computeFitTransform({ width: 1080, height: 1920 }, { width: 1600, height: 1000 });
    const zoomed = computeFitTransform({ width: 1080, height: 1920 }, { width: 1600, height: 1000 }, 2);
    expect(zoomed.scale).toBeCloseTo(base.scale * 2);
  });

  it("degenerates to {scale:1, x:0, y:0} for a zero-sized viewport", () => {
    expect(computeFitTransform({ width: 1080, height: 1920 }, { width: 0, height: 0 })).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it("compToScreen/screenToComp round-trip", () => {
    const fit = computeFitTransform({ width: 1080, height: 1920 }, { width: 1600, height: 1000 });
    const p = { x: 540, y: 960 };
    const screen = compToScreen(p, fit);
    const back = screenToComp(screen, fit);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it("screenDeltaToComp scales a screen-space delta by 1/fit.scale", () => {
    const fit = computeFitTransform({ width: 1080, height: 1920 }, { width: 1600, height: 1000 });
    const delta = screenDeltaToComp({ x: fit.scale * 10, y: fit.scale * 20 }, fit);
    expect(delta.x).toBeCloseTo(10);
    expect(delta.y).toBeCloseTo(20);
  });
});

describe("gizmo preview math", () => {
  it("rotationMat3(0) and scaleMat3(1,1) are the identity", () => {
    expect(rotationMat3(0)).toEqual(IDENTITY);
    expect(scaleMat3(1, 1)).toEqual(IDENTITY);
  });

  it("transformAroundPivot with a translation delta is pivot-independent and just adds to tx/ty", () => {
    const m: Mat3 = [2, 0, 10, 0, 2, 20, 0, 0, 1];
    const delta = translationMat3(5, -3);
    const atOrigin = transformAroundPivot(m, { x: 0, y: 0 }, delta);
    const atOtherPivot = transformAroundPivot(m, { x: 100, y: -50 }, delta);
    expect(atOrigin).toEqual([2, 0, 15, 0, 2, 17, 0, 0, 1]);
    expect(atOtherPivot).toEqual(atOrigin);
  });

  it("transformAroundPivot with a 90° rotation rotates the world matrix's origin point around the pivot", () => {
    // matrix=IDENTITY -> the node's local origin (0,0) sits at comp (0,0).
    // Rotating 90° about pivot (10,10) should move it to (20,0).
    const preview = transformAroundPivot(IDENTITY, { x: 10, y: 10 }, rotationMat3(90));
    const moved = applyMat3(preview, { x: 0, y: 0 });
    expect(moved.x).toBeCloseTo(20);
    expect(moved.y).toBeCloseTo(0);
  });

  it("transformAroundPivot with a scale delta scales distance from the pivot", () => {
    // matrix=IDENTITY -> local point (20,10) sits at comp (20,10), 10 units
    // right of pivot (10,10). Scaling by 2x about that pivot moves it to 20
    // units right -> (30,10).
    const preview = transformAroundPivot(IDENTITY, { x: 10, y: 10 }, scaleMat3(2, 2));
    const moved = applyMat3(preview, { x: 20, y: 10 });
    expect(moved.x).toBeCloseTo(30);
    expect(moved.y).toBeCloseTo(10);
  });
});

describe("measureTextRun", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function run(text: string): GlyphRun {
    return { text, x: 0, y: 0, fontFamily: "Inter", fontSize: 64, weight: 400, color: { l: 1, c: 0, h: 0 } };
  }

  it("falls back to a per-character heuristic when document/Canvas is unavailable (vitest's Node environment)", () => {
    const { width, height } = measureTextRun(run("Hello"));
    expect(width).toBeCloseTo(5 * 64 * 0.6);
    expect(height).toBeCloseTo(64 * 1.2);
  });

  it("uses Canvas measureText when document is available — matches Pixi's own text layout (scene-graph.ts)", () => {
    const fakeCtx = { font: "", measureText: vi.fn() };
    const fakeCanvas = { getContext: () => fakeCtx };
    vi.stubGlobal("document", { createElement: () => fakeCanvas });

    fakeCtx.measureText.mockReturnValueOnce({ width: 123.4, fontBoundingBoxAscent: 50, fontBoundingBoxDescent: 10 });
    const a = measureTextRun(run("Hello"));
    expect(fakeCtx.font).toBe("400 64px Inter");
    expect(fakeCtx.measureText).toHaveBeenCalledWith("Hello");
    expect(a.width).toBe(123.4);
    expect(a.height).toBe(60); // fontBoundingBoxAscent + fontBoundingBoxDescent

    // Falls back to actualBoundingBox*/a fontSize-based estimate if fontBoundingBox* metrics are unavailable.
    fakeCtx.measureText.mockReturnValueOnce({ width: 50, actualBoundingBoxAscent: 40 });
    const b = measureTextRun(run("Hi"));
    expect(b.width).toBe(50);
    expect(b.height).toBeCloseTo(40 + 64 * 0.2); // actualBoundingBoxAscent + fontSize-based descent fallback
  });
});
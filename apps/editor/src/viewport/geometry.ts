// apps/editor/src/viewport/geometry.ts
//
// Pure coordinate-space math for <TransformGizmo> (Deliverable 09 §9.1:
// "<Viewport> — hosts the injected Renderer + transform gizmos"). Nothing
// here touches the DOM or the renderer — it's all plain Vec2/Mat3/Rect
// arithmetic, so it's fully unit-testable without a browser.
//
// Two coordinate spaces:
//  - "comp" space: composition pixels (0,0 .. comp.size.width/height) —
//    where `RenderNode.matrix` and `Node.transform` live.
//  - "screen" space: CSS pixels within the <canvas>'s container — where
//    pointer events land.
// `FitTransform` (computeFitTransform) maps between them: it's the same
// "contain, centered, zoom-scaled" transform applied to `host.stage` via
// `renderer.setViewport()`.

import type { GlyphRun, Mat3, Rect, RenderNode } from "contract";
import { mul } from "core";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** P1 placeholder bounds for kinds with no intrinsic size yet (image/video/group — see Week 5/6 "fit is a no-op" note). Matches shapeKind's default width/height. */
export const DEFAULT_BOUNDS: Rect = { x: 0, y: 0, width: 200, height: 200 };

/**
 * Per-line height estimate for text bounds, as a multiple of `fontSize` —
 * matches `packages/nodekinds/src/common.ts`'s `layout()` default
 * `lineHeight` (used there to space multi-line `GlyphRun.y` positions).
 * Used as the HEIGHT fallback (and the only WIDTH fallback) in
 * `measureTextRun` when `document`/Canvas isn't available (vitest runs in
 * Node — see geometry.test.ts).
 */
const TEXT_LINE_HEIGHT = 1.2;

/** Fallback average character-width, as a fraction of `fontSize`, when Canvas `measureText` isn't available. */
const TEXT_WIDTH_FALLBACK_FACTOR = 0.6;

let measureCanvas: HTMLCanvasElement | undefined;

/**
 * Measures a `GlyphRun`'s rendered width/height. In a browser, uses
 * `CanvasRenderingContext2D.measureText` — the same API Pixi's `Text`
 * (Deliverable 08, `scene-graph.ts`'s `updateText`) uses internally for
 * layout, so this closely matches what's actually drawn (unlike a flat
 * per-character average, which over/under-estimates depending on the
 * string's mix of narrow/wide glyphs and spaces — the cause of gizmo
 * bounding boxes that don't hug the text). Falls back to a per-character
 * heuristic when `document` is unavailable (vitest's default Node
 * environment — geometry.test.ts).
 */
export function measureTextRun(run: GlyphRun): { width: number; height: number } {
  if (typeof document !== "undefined") {
    measureCanvas ??= document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    if (ctx) {
      ctx.font = `${run.weight} ${run.fontSize}px ${run.fontFamily}`;
      const metrics = ctx.measureText(run.text);
      const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? run.fontSize * 0.8;
      const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? run.fontSize * 0.2;
      return { width: metrics.width, height: ascent + descent };
    }
  }
  return { width: run.text.length * run.fontSize * TEXT_WIDTH_FALLBACK_FACTOR, height: run.fontSize * TEXT_LINE_HEIGHT };
}

/**
 * Applies a core Mat3 ([a,b,tx,c,d,ty,0,0,1], Deliverable 05.1:
 * x'=a·x+b·y+tx, y'=c·x+d·y+ty) to a point. NOTE: this is core's row-major
 * convention, distinct from `renderer-webgl/src/matrix.ts`'s `toPixiMatrix`
 * (which remaps into Pixi's column convention) — geometry.ts works directly
 * with `RenderNode.matrix`/`Node.transform`, never with Pixi types.
 */
export function applyMat3(m: Mat3, p: Vec2): Vec2 {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2],
    y: m[3] * p.x + m[4] * p.y + m[5],
  };
}

/** Inverts an affine Mat3 ([a,b,tx,c,d,ty,0,0,1]). Throws if singular (det === 0). */
export function invertMat3(m: Mat3): Mat3 {
  const [a, b, tx, c, d, ty] = m;
  const det = a * d - b * c;
  if (det === 0) throw new Error("invertMat3: matrix is singular (determinant 0)");
  // `+ 0` normalizes any `-0` results (e.g. `-b/det` when b===0) to `0`,
  // so invertMat3(IDENTITY) is deep-equal to IDENTITY.
  return [
    d / det + 0,
    -b / det + 0,
    (b * ty - d * tx) / det + 0,
    -c / det + 0,
    a / det + 0,
    (c * tx - a * ty) / det + 0,
    0,
    0,
    1,
  ];
}

/**
 * The local-space bounding box a RenderNode occupies before `matrix` is
 * applied. "shape" derives exact bounds from `geom` (matching
 * `scene-graph.ts`'s drawing); "text" derives an approximate box from its
 * GlyphRuns; "image"/"video"/"group" have no intrinsic size in Phase 1
 * (Week 5's "fit is a no-op" note) and fall back to `DEFAULT_BOUNDS`.
 */
export function getRenderNodeBounds(node: RenderNode): Rect {
  if (node.t === "shape") {
    switch (node.geom.kind) {
      case "rect":
      case "ellipse":
        return { x: 0, y: 0, width: node.geom.width, height: node.geom.height };
      case "line": {
        const strokeWidth = node.stroke?.width ?? 1; // matches scene-graph.ts's fallback 1px stroke
        return { x: 0, y: -strokeWidth / 2, width: node.geom.length, height: strokeWidth };
      }
    }
  }

  if (node.t === "text") {
    if (node.runs.length === 0) return { ...DEFAULT_BOUNDS };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const run of node.runs) {
      // `scene-graph.ts`'s `updateText` does `text.position.set(run.x,
      // run.y)` on a Pixi `Text` with its default anchor (0,0) — i.e.
      // `(run.x, run.y)` is the glyph box's TOP-LEFT, not a baseline.
      const { width, height } = measureTextRun(run);
      minX = Math.min(minX, run.x);
      minY = Math.min(minY, run.y);
      maxX = Math.max(maxX, run.x + width);
      maxY = Math.max(maxY, run.y + height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  // "image" | "video" | "group" — no intrinsic size in Phase 1.
  return { ...DEFAULT_BOUNDS };
}

/** The 4 corners of `bounds` mapped through `matrix`, in comp space — order: top-left, top-right, bottom-right, bottom-left. */
export function getOrientedCorners(bounds: Rect, matrix: Mat3): [Vec2, Vec2, Vec2, Vec2] {
  const { x, y, width, height } = bounds;
  return [
    applyMat3(matrix, { x, y }),
    applyMat3(matrix, { x: x + width, y }),
    applyMat3(matrix, { x: x + width, y: y + height }),
    applyMat3(matrix, { x, y: y + height }),
  ];
}

/** The center of `bounds`, in local space — the rotate gizmo's pivot point. */
export function getRectCenter(bounds: Rect): Vec2 {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/**
 * The bounding box of a "group" RenderNode, in the GROUP's local space —
 * same convention as `getRenderNodeBounds` (a rect that, mapped through
 * `groupMatrix` via `getOrientedCorners`, gives the group's comp-space
 * outline; mapped via `getScaleHandles`, gives valid scale/rotate pivots).
 *
 * "group" RenderNodes carry no intrinsic content — `getRenderNodeBounds`
 * falls back to `DEFAULT_BOUNDS` (200x200) for them, unrelated to where the
 * group's children actually are (evaluate-node.ts's flat-array doc: a
 * group's children are pushed as separate sibling RenderNodes with
 * ABSOLUTE world matrices). The group's true extent is the union of those
 * descendants' bounds, mapped into the group's local space via
 * `invertMat3(groupMatrix)`.
 *
 * Falls back to `DEFAULT_BOUNDS` if there are no eligible descendants (all
 * "group" themselves, or `descendants` is empty) or if `groupMatrix` is
 * singular (e.g. a 0 scale produced mid-drag).
 */
export function getGroupBounds(groupMatrix: Mat3, descendants: RenderNode[]): Rect {
  let inv: Mat3;
  try {
    inv = invertMat3(groupMatrix);
  } catch {
    return { ...DEFAULT_BOUNDS };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of descendants) {
    if (child.t === "group") continue; // no intrinsic bounds — see getRenderNodeBounds
    for (const corner of getOrientedCorners(getRenderNodeBounds(child), child.matrix)) {
      const local = applyMat3(inv, corner);
      minX = Math.min(minX, local.x);
      minY = Math.min(minY, local.y);
      maxX = Math.max(maxX, local.x);
      maxY = Math.max(maxY, local.y);
    }
  }
  if (!Number.isFinite(minX)) return { ...DEFAULT_BOUNDS };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * One resize handle: `local` is the point this handle represents (a corner
 * or edge midpoint of `bounds`, before the node's transform is applied);
 * `pivotLocal` is the point on the OPPOSITE side that stays fixed while
 * dragging this handle; `axes` says which of `factorX`/`factorY`
 * (transform-node.ts's `scaleNode`) this handle drives — corners drive
 * both, edge midpoints drive only the axis perpendicular to their edge.
 */
export interface ScaleHandle {
  local: Vec2;
  pivotLocal: Vec2;
  axes: { x: boolean; y: boolean };
  cursor: string;
}

/**
 * The 8 standard resize handles for `bounds` — 4 corners (both axes) + 4
 * edge midpoints (one axis each), in local space. `<TransformGizmo>` maps
 * each `local`/`pivotLocal` through the node's current world matrix to get
 * screen positions and drag pivots.
 */
export function getScaleHandles(bounds: Rect): ScaleHandle[] {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const TL = { x, y };
  const TR = { x: x + width, y };
  const BR = { x: x + width, y: y + height };
  const BL = { x, y: y + height };
  const TOP = { x: cx, y };
  const RIGHT = { x: x + width, y: cy };
  const BOTTOM = { x: cx, y: y + height };
  const LEFT = { x, y: cy };
  const BOTH = { x: true, y: true };
  return [
    { local: TL, pivotLocal: BR, axes: BOTH, cursor: "nwse-resize" },
    { local: TR, pivotLocal: BL, axes: BOTH, cursor: "nesw-resize" },
    { local: BR, pivotLocal: TL, axes: BOTH, cursor: "nwse-resize" },
    { local: BL, pivotLocal: TR, axes: BOTH, cursor: "nesw-resize" },
    { local: TOP, pivotLocal: BOTTOM, axes: { x: false, y: true }, cursor: "ns-resize" },
    { local: RIGHT, pivotLocal: LEFT, axes: { x: true, y: false }, cursor: "ew-resize" },
    { local: BOTTOM, pivotLocal: TOP, axes: { x: false, y: true }, cursor: "ns-resize" },
    { local: LEFT, pivotLocal: RIGHT, axes: { x: true, y: false }, cursor: "ew-resize" },
  ];
}

/** scale + offset mapping comp space -> screen space (see module doc). Mirrors what `renderer.setViewport()` applies to `host.stage`. */
export interface FitTransform {
  scale: number;
  x: number;
  y: number;
}

/**
 * "Contain, centered" fit of `compSize` within `viewSize`, scaled by `zoom`
 * (Tier 3 `zoom`, default 1). Degenerates to `{scale:1, x:0, y:0}` if either
 * size has a non-positive dimension (e.g. the canvas hasn't been measured
 * yet) — avoids Infinity/NaN before the first resize.
 */
export function computeFitTransform(compSize: Size, viewSize: Size, zoom = 1): FitTransform {
  if (compSize.width <= 0 || compSize.height <= 0 || viewSize.width <= 0 || viewSize.height <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const scale = Math.min(viewSize.width / compSize.width, viewSize.height / compSize.height) * zoom;
  return {
    scale,
    x: (viewSize.width - compSize.width * scale) / 2,
    y: (viewSize.height - compSize.height * scale) / 2,
  };
}

export function compToScreen(p: Vec2, fit: FitTransform): Vec2 {
  return { x: p.x * fit.scale + fit.x, y: p.y * fit.scale + fit.y };
}

export function screenToComp(p: Vec2, fit: FitTransform): Vec2 {
  return { x: (p.x - fit.x) / fit.scale, y: (p.y - fit.y) / fit.scale };
}

/** Converts a screen-space delta (pointer movement) to a comp-space delta — translation only, no offset. */
export function screenDeltaToComp(delta: Vec2, fit: FitTransform): Vec2 {
  return { x: delta.x / fit.scale, y: delta.y / fit.scale };
}

// --- Gizmo preview math --------------------------------------------------
//
// <TransformGizmo> previews a drag by composing an *additional* comp-space
// transform onto the node's currently-rendered `RenderNode.matrix` — see
// `transformAroundPivot`. This works regardless of whether `transform.*` is
// animated by channels (Deliverable 10), since it operates on the already-
// evaluated world matrix rather than recomputing `composeTransform`. The
// commit on pointer-up (moveNode/scaleNode/rotateNode, transform-node.ts)
// still edits `Node.transform` directly — the live preview and the
// committed Op are independent, intentionally simple approximations.

export function translationMat3(dx: number, dy: number): Mat3 {
  return [1, 0, dx, 0, 1, dy, 0, 0, 1];
}

/** `degrees` follows core's rotation convention (compose-transform.ts): positive = clockwise on screen. */
export function rotationMat3(degrees: number): Mat3 {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cos, -sin + 0, 0, sin, cos, 0, 0, 0, 1];
}

export function scaleMat3(sx: number, sy: number): Mat3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
}

/**
 * Composes `matrix` with an additional comp-space `delta` (translation,
 * rotation, or scale) applied around `pivot` — i.e. `T(pivot) · delta ·
 * T(-pivot) · matrix`. For a pure translation `delta`, `pivot` has no effect
 * (translations commute); for rotation/scale, `pivot` is the fixed point.
 */
export function transformAroundPivot(matrix: Mat3, pivot: Vec2, delta: Mat3): Mat3 {
  const pivoted = mul(translationMat3(pivot.x, pivot.y), mul(delta, translationMat3(-pivot.x, -pivot.y)));
  return mul(pivoted, matrix);
}
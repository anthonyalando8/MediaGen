// packages/renderer-webgl/src/passes/mask-pass.ts
//
// Rasterises a node's mask paths (bezier paths in NODE LOCAL SPACE — same
// space the path points are authored in, see MaskPenOverlay.tsx) to a
// stencil texture, then applies it as a multiply filter.
//
// COORDINATE SPACE — this is the part that's easy to get wrong, so it's
// documented in detail:
//
// A Pixi Filter's `filterArea` is specified in the FILTERED CONTAINER'S OWN
// LOCAL SPACE. Pixi internally multiplies it by `container.worldTransform`
// to get the actual sampled GPU region (FilterSystem.mjs's
// `_calculateFilterArea`). scene-graph.ts's `reconcileEffectGroup` computes
// `filterArea` as the INVERSE-transformed comp rect (via
// `inverseTransformRect` in matrix.ts) so that, after Pixi's own
// worldTransform multiply, the EFFECTIVE sampled region is exactly comp
// space — but the filterArea RECTANGLE ITSELF, and therefore
// `vTextureCoord`'s 0..1 range, is in the node's LOCAL space.
//
// Since `uMask` is sampled with that SAME `vTextureCoord`, the mask
// rasterisation canvas must ALSO be in local space, matching that exact
// rect (origin + dimensions) — NOT comp space. Conveniently, mask path
// points are already authored in local space (MaskPenOverlay.tsx stores
// them via `invertMat3(nodeMatrix)`), so NO further matrix transform is
// needed here — draw the points directly, offset by `-localRect.x/y` so
// the canvas's own (0,0) aligns with `filterArea`'s origin.

import { Filter, GlProgram, Texture, ImageSource } from "pixi.js";
import type { MaskPath } from "contract";
import { DEFAULT_VERTEX } from "./pass-resolver";

// ── GLSL ──────────────────────────────────────────────────────────────────

const MASK_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform float uOpacity;
uniform float uInvert;

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);
    float maskAlpha = texture(uMask, vTextureCoord).a;
    maskAlpha = mix(maskAlpha, 1.0 - maskAlpha, uInvert);
    finalColor = src * maskAlpha * uOpacity;
}
`;

// ── Program cache ──────────────────────────────────────────────────────────

let maskProgram: GlProgram | null | undefined;

function getMaskProgram(): GlProgram | undefined {
  if (maskProgram !== undefined) return maskProgram ?? undefined;
  try {
    maskProgram = new GlProgram({ vertex: DEFAULT_VERTEX, fragment: MASK_FRAGMENT, name: "seabytes-mask" });
  } catch {
    maskProgram = null;
  }
  return maskProgram ?? undefined;
}

// ── Canvas2D rasteriser ────────────────────────────────────────────────────

/** Draws a bezier path on the canvas, offset by (-originX, -originY) — the canvas's local-space origin relative to the path's own local coordinates. No matrix transform: points are already in the same local space as the canvas, just possibly offset from (0,0). */
function drawLocalPath(ctx: CanvasRenderingContext2D, path: MaskPath, originX: number, originY: number): void {
  if (path.points.length === 0) return;
  const first = path.points[0].point;
  ctx.beginPath();
  ctx.moveTo(first.x - originX, first.y - originY);

  for (let i = 1; i < path.points.length; i++) {
    const prev = path.points[i - 1];
    const curr = path.points[i];
    const cp1 = prev.outHandle
      ? { x: prev.point.x + prev.outHandle.x - originX, y: prev.point.y + prev.outHandle.y - originY }
      : { x: prev.point.x - originX, y: prev.point.y - originY };
    const cp2 = curr.inHandle
      ? { x: curr.point.x + curr.inHandle.x - originX, y: curr.point.y + curr.inHandle.y - originY }
      : { x: curr.point.x - originX, y: curr.point.y - originY };
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, curr.point.x - originX, curr.point.y - originY);
  }

  if (path.closed && path.points.length > 1) {
    const last = path.points[path.points.length - 1];
    const f = path.points[0];
    const cp1 = last.outHandle
      ? { x: last.point.x + last.outHandle.x - originX, y: last.point.y + last.outHandle.y - originY }
      : { x: last.point.x - originX, y: last.point.y - originY };
    const cp2 = f.inHandle
      ? { x: f.point.x + f.inHandle.x - originX, y: f.point.y + f.inHandle.y - originY }
      : { x: f.point.x - originX, y: f.point.y - originY };
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, f.point.x - originX, f.point.y - originY);
  }
  ctx.closePath();
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface MaskSpec {
  path: MaskPath;
  mode: "add" | "subtract" | "intersect";
  feather: number;
  inverted: boolean;
  opacity: number;
}

/**
 * Rasterises `masks` onto a canvas sized to `localRect` (the node's local
 * filterArea — see module doc). `localRect.x/y` becomes the canvas's
 * coordinate-space origin offset; `localRect.width/height` rounds up to the
 * canvas's pixel dimensions (a fractional local rect, e.g. from a rotated
 * node, still needs whole pixels).
 */
export function rasteriseMasks(
  masks: MaskSpec[],
  localRect: { x: number; y: number; width: number; height: number },
  existing?: HTMLCanvasElement
): HTMLCanvasElement {
  const width = Math.max(1, Math.ceil(localRect.width));
  const height = Math.max(1, Math.ceil(localRect.height));
  const canvas = existing ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);

  for (const mask of masks) {
    ctx.save();
    if (mask.feather > 0) {
      ctx.shadowColor = "white";
      ctx.shadowBlur = mask.feather * 2;
    }
    ctx.fillStyle = "white";
    ctx.globalCompositeOperation =
      mask.mode === "subtract"
        ? "destination-out"
        : mask.mode === "intersect"
          ? "destination-in"
          : "source-over";
    ctx.globalAlpha = mask.opacity;
    drawLocalPath(ctx, mask.path, localRect.x, localRect.y);
    ctx.fill();
    ctx.restore();
  }

  return canvas;
}

export function buildMaskFilter(
  maskSpecs: MaskSpec[],
  localRect: { x: number; y: number; width: number; height: number },
  existingCanvas?: HTMLCanvasElement
): { filter: Filter; canvas: HTMLCanvasElement } | undefined {
  const program = getMaskProgram();
  if (!program) return undefined;

  const canvas = rasteriseMasks(maskSpecs, localRect, existingCanvas);
  const source = new ImageSource({ resource: canvas });
  const texture = new Texture({ source });

  const filter = new Filter({
    glProgram: program,
    resources: {
      maskUniforms: {
        uOpacity: { value: 1.0, type: "f32" },
        uInvert: { value: 0.0, type: "f32" },
      },
      uMask: texture,
    },
  });

  return { filter, canvas };
}
// packages/renderer-webgl/src/passes/mask-pass.ts
//
// Rasterises a node's mask paths (bezier paths in NODE LOCAL SPACE) to a
// comp-sized Canvas2D stencil texture, then applies it as a multiply filter.
//
// KEY DESIGN: mask paths are stored in the node's LOCAL coordinate space
// (before the node's own world transform) — exactly like AE masks. When
// rasterising, each point is transformed through the node's world matrix
// (nodeMatrix) to land in comp space, matching the comp-sized stencil canvas.
// This means a rotated/scaled node's mask correctly tracks its visual bounds.

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
    float maskAlpha = texture(uMask, vTextureCoord).r;
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

// ── Matrix ────────────────────────────────────────────────────────────────

/** Apply a row-major Mat3 [a,b,0, c,d,0, tx,ty,1] to a 2D point. */
/** Apply row-major Mat3 [a,b,tx, c,d,ty, 0,0,1] to a 2D point: x=a*px+b*py+tx, y=c*px+d*py+ty. */
function applyMat3(m: readonly number[], p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2],
    y: m[3] * p.x + m[4] * p.y + m[5],
  };
}

// ── Canvas2D rasteriser ────────────────────────────────────────────────────

function drawTransformedPath(ctx: CanvasRenderingContext2D, path: MaskPath, m: readonly number[]): void {
  if (path.points.length === 0) return;
  const first = applyMat3(m, path.points[0].point);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  for (let i = 1; i < path.points.length; i++) {
    const prev = path.points[i - 1];
    const curr = path.points[i];
    const prevPt = applyMat3(m, prev.point);
    const currPt = applyMat3(m, curr.point);
    const cp1 = prev.outHandle
      ? applyMat3(m, { x: prev.point.x + prev.outHandle.x, y: prev.point.y + prev.outHandle.y })
      : prevPt;
    const cp2 = curr.inHandle
      ? applyMat3(m, { x: curr.point.x + curr.inHandle.x, y: curr.point.y + curr.inHandle.y })
      : currPt;
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, currPt.x, currPt.y);
  }

  // Close the path back to start if flagged
  if (path.closed && path.points.length > 1) {
    const last = path.points[path.points.length - 1];
    const f = path.points[0];
    const lastPt = applyMat3(m, last.point);
    const fPt = applyMat3(m, f.point);
    const cp1 = last.outHandle
      ? applyMat3(m, { x: last.point.x + last.outHandle.x, y: last.point.y + last.outHandle.y })
      : lastPt;
    const cp2 = f.inHandle
      ? applyMat3(m, { x: f.point.x + f.inHandle.x, y: f.point.y + f.inHandle.y })
      : fPt;
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, fPt.x, fPt.y);
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
  /** Node world matrix — transforms local-space path points to comp space. */
  nodeMatrix: readonly number[];
}

export function rasteriseMasks(
  masks: MaskSpec[],
  width: number,
  height: number,
  existing?: HTMLCanvasElement
): HTMLCanvasElement {
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
    drawTransformedPath(ctx, mask.path, mask.nodeMatrix);
    // Always fill — masks clip regardless of open/closed (an open path's
    // implicit close line completes the clip region, same as AE/Figma).
    ctx.fill();
    ctx.restore();
  }

  return canvas;
}

export function buildMaskFilter(
  maskSpecs: MaskSpec[],
  compWidth: number,
  compHeight: number,
  existingCanvas?: HTMLCanvasElement
): { filter: Filter; canvas: HTMLCanvasElement } | undefined {
  const program = getMaskProgram();
  if (!program) return undefined;

  const canvas = rasteriseMasks(maskSpecs, compWidth, compHeight, existingCanvas);
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
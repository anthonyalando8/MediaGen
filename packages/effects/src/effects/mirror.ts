// packages/effects/src/effects/mirror.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// MIRROR EFFECT — Production rewrite
// ─────────────────────────────────────────────────────────────────────────────
//
// DESIGN PHILOSOPHY
// -----------------
// A mirror effect works by identifying a "source" half of the image and
// copying it (reflected) into the "destination" half. Every pixel in the
// output belongs to exactly one of two regions:
//
//   • Source region  — sampled directly at vTextureCoord (unchanged)
//   • Mirror region  — sampled at the reflection of vTextureCoord across
//                      the mirror axis
//
// The reflection formula for a point P across an axis at A:
//
//   P' = 2A - P
//
// This is mathematically exact. No clamping, no folding, no range tricks.
// The result is always a valid UV when the source half is within [0,1] —
// which it always is, because it IS the original texture.
//
// AXIS MODEL
// ----------
// Each axis (X for horizontal splits, Y for vertical splits) is controlled
// by two parameters:
//
//   axisPos:   where the mirror plane sits (0.0 = left/top, 1.0 = right/bottom)
//   direction: which side is the SOURCE
//              0 = "near" side (x < axisPos) is source → mirrors near into far
//              1 = "far"  side (x >= axisPos) is source → mirrors far into near
//
// Example — horizontal axis, direction=0, posX=0.5:
//   Pixels where uv.x < 0.5  → source, unchanged
//   Pixels where uv.x >= 0.5 → mirror: sample at 2*0.5 - uv.x = 1.0 - uv.x
//   Result: right half is a mirror of left half ✓
//
// "Both" applies X then Y independently, each with its own pos and direction.
//
// UNIFORM NAMING
// --------------
// Follows SeaBytes convention: u-prefix + PascalCase, matching the prop name
// (pass-resolver maps props.posX → uPosX automatically).

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAxisMode;  // 0=horizontal, 1=vertical, 2=both
uniform float uDirX;      // 0=left-is-source,  1=right-is-source
uniform float uDirY;      // 0=top-is-source,   1=bottom-is-source
uniform float uPosX;      // horizontal axis position in [0,1]
uniform float uPosY;      // vertical   axis position in [0,1]

// ─── applyMirror1D ────────────────────────────────────────────────────────────
//
// For a single UV axis coordinate c and mirror parameters (axisPos, direction):
//
//   Pixels on the SOURCE side  → return c unchanged.
//   Pixels on the MIRROR side  → return 2*axisPos - c  (reflection across axis).
//
// Implementation is fully branchless to avoid GPU warp divergence.
//
// step(edge, x):
//   Returns 0.0 when x < edge, 1.0 when x >= edge.
//   We use this to determine which side of the axis a pixel is on.
//
// Direction encoding:
//   direction=0 → near side (c < axisPos) is source.
//     inMirrorRegion = isOnFarSide    (= step(axisPos, c))
//   direction=1 → far side (c >= axisPos) is source.
//     inMirrorRegion = isOnNearSide   (= 1 - step(axisPos, c))
//
//   Both cases: inMirrorRegion = mix(isOnFarSide, isOnNearSide, direction)
//
// Correctness proof for the reflection:
//   A pixel in the mirror region has coordinate c on one side of axisPos.
//   Its reflection r = 2*axisPos - c lands on the OTHER side of axisPos,
//   exactly in the source region. Since the source region is always a valid
//   sub-range of [0,1], r is always a valid UV coordinate. QED.
//
float applyMirror1D(float c, float axisPos, float direction) {
    float isOnFarSide      = step(axisPos, c);          // 1 when c >= axisPos
    float isOnNearSide     = 1.0 - isOnFarSide;         // 1 when c <  axisPos
    float inMirrorRegion   = mix(isOnFarSide, isOnNearSide, direction);

    float reflected        = 2.0 * axisPos - c;         // P' = 2A - P
    return mix(c, reflected, inMirrorRegion);            // select by region
}

void main(void) {
    vec2 uv = vTextureCoord;

    // Apply horizontal axis (splits image left/right along a vertical plane).
    // Skipped when mode=1 (vertical only).
    if (uAxisMode < 0.5 || uAxisMode > 1.5) {
        uv.x = applyMirror1D(uv.x, uPosX, uDirX);
    }

    // Apply vertical axis (splits image top/bottom along a horizontal plane).
    // Skipped when mode=0 (horizontal only).
    if (uAxisMode > 0.5) {
        uv.y = applyMirror1D(uv.y, uPosY, uDirY);
    }

    // uv is guaranteed to be in [0,1] — no clamping required.
    // The node bounds/size are completely unchanged; this is a pure UV remap.
    finalColor = texture(uTexture, uv);
}
`;

export const mirrorEffect: EffectDef = {
  effect: "mirror",
  displayName: "Mirror",
  category: "distort",

  schema: {
    props: z.object({
      // Axis mode: 0=horizontal (L/R split), 1=vertical (T/B split), 2=both
      axisMode: z.number().int().min(0).max(2).default(0),

      // Horizontal direction:
      // 0 = left→right  (left is source, right side reflects it)
      // 1 = right→left  (right is source, left side reflects it)
      dirX: z.number().int().min(0).max(1).default(0),

      // Vertical direction:
      // 0 = top→bottom  (top is source, bottom reflects it)
      // 1 = bottom→top  (bottom is source, top reflects it)
      dirY: z.number().int().min(0).max(1).default(0),

      // Mirror axis positions — fully animatable [0, 1]
      // Default 0.5 = centre of the image on each axis
      posX: z.number().min(0).max(1).default(0.5),
      posY: z.number().min(0).max(1).default(0.5),
    }),

    channels: [
      { path: "props.axisMode", type: "scalar", label: "Axis Mode",  default: 0   },
      { path: "props.dirX",     type: "scalar", label: "Dir H",      default: 0   },
      { path: "props.dirY",     type: "scalar", label: "Dir V",      default: 0   },
      { path: "props.posX",     type: "scalar", label: "Position H", default: 0.5 },
      { path: "props.posY",     type: "scalar", label: "Position V", default: 0.5 },
    ],

    inspector: [
      // ── Axis ───────────────────────────────────────────────────────────────
      // Stored as integer 0/1/2. Uses number+step:1 rather than select because
      // the inspector's select control emits the option string (e.g. "Horizontal")
      // not its index — this would break the float uniform comparison in GLSL.
      // A future numericSelect control type would improve the labelling here.
      {
        path: "props.axisMode",
        label: "Axis  (0=H  1=V  2=Both)",
        control: "number",
        min: 0, max: 2, step: 1,
      },

      // ── Directions ────────────────────────────────────────────────────────
      {
        path: "props.dirX",
        label: "H Direction  (0=L→R  1=R→L)",
        control: "number",
        min: 0, max: 1, step: 1,
      },
      {
        path: "props.dirY",
        label: "V Direction  (0=T→B  1=B→T)",
        control: "number",
        min: 0, max: 1, step: 1,
      },

      // ── Axis positions — rendered as RangeSliders by inspector-fields.tsx ──
      {
        path: "props.posX",
        label: "H Position",
        control: "number",
        min: 0, max: 1, step: 0.01,
      },
      {
        path: "props.posY",
        label: "V Position",
        control: "number",
        min: 0, max: 1, step: 0.01,
      },
    ],
  },

  glsl: FRAGMENT,
};
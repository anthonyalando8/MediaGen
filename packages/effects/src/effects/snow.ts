// packages/effects/src/effects/snow.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// SNOW — Procedural overlay effect
// ─────────────────────────────────────────────────────────────────────────────
//
// TECHNIQUE
// ---------
// Unlike rain (which uses streaks), snowflakes are approximately circular and
// drift with a horizontal sway. Each is rendered as a soft Gaussian disc.
//
// The UV space is divided into a grid. Within each cell:
//   • A snowflake is placed at a pseudo-random offset from the cell centre
//   • It drifts downward at its layer's speed, with a sinusoidal horizontal
//     sway whose frequency and amplitude are also randomised per-cell
//   • Size is controlled per-layer to simulate depth (larger = foreground)
//
// LAYERS (3 depth planes)
// -----------------------
//   Layer 0: background — tiny, slow, densely packed
//   Layer 1: mid        — medium size and speed
//   Layer 2: foreground — large, slow-drifting flakes
//
// COMPOSITING
// -----------
// Snow is additive + alpha over the source. Snowflakes are white with slight
// blue tint. Pure white (1,1,1) addition is slightly too harsh — we use
// (0.9, 0.95, 1.0) for a natural snow colour.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uDensity;   // flake density / grid scale (0-1)
uniform float uSpeed;     // fall speed (0-3)
uniform float uSize;      // max flake size multiplier (0-1)
uniform float uWind;      // horizontal sway strength (-1 to 1)
uniform float uOpacity;   // overall opacity (0-1)
uniform float uTime;      // animation time

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}

// Single snow layer.
// gridScale: cells per image width.
// speed:     fall speed for this layer.
// radius:    max disc radius in cell-UV units.
// sway:      amplitude of horizontal oscillation in cell-UV units.
float snowLayer(vec2 uv, float gridScale, float speed, float radius,
                float sway, float time) {

    // Scroll downward at this layer's speed
    uv.y += time * speed;

    vec2  cell   = floor(uv * gridScale);
    vec2  cellUV = fract(uv * gridScale) - 0.5;   // centred in [-0.5, 0.5]

    // Per-flake random properties
    float r      = hash21(cell);                   // x position jitter
    float phase  = hash21(cell + vec2(3.1, 7.4));  // sway phase
    float sizeR  = hash21(cell + vec2(9.2, 1.6));  // individual size variation

    // Horizontal sway: sinusoidal oscillation based on time and per-cell phase
    float swayX  = sin(time * 1.8 + phase * 6.2832) * sway;

    // Flake position within cell (jittered from centre)
    vec2  pos    = vec2((r - 0.5) * 0.7 + swayX, 0.0);

    // Distance from this pixel to the flake centre
    float dist   = length(cellUV - pos);

    // Soft circular disc — smoothstep for antialiased edge
    float flakeR = radius * (0.4 + sizeR * 0.6);   // 40-100% of max radius
    return smoothstep(flakeR, flakeR * 0.3, dist);
}

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);

    // Map density [0,1] → grid scale [8, 35]
    float baseGrid = mix(8.0, 35.0, uDensity);
    // Map speed [0,3] → actual fall rate
    float baseSpeed = uSpeed * 0.15;
    // Map size [0,1] → radius in cell-UV units [0.05, 0.35]
    float baseRadius = mix(0.05, 0.35, uSize);
    // Wind sway in cell-UV units
    float sway = uWind * 0.12;

    float snow = 0.0;

    // Layer 0 — distant background (fine, fast due to parallax)
    snow += snowLayer(vTextureCoord, baseGrid * 2.2, baseSpeed * 1.4,
                      baseRadius * 0.4, sway * 0.5, uTime) * 0.5;

    // Layer 1 — midground
    snow += snowLayer(vTextureCoord, baseGrid * 1.0, baseSpeed * 1.0,
                      baseRadius * 0.75, sway * 0.8, uTime * 1.07) * 0.75;

    // Layer 2 — foreground (large, slow, bright)
    snow += snowLayer(vTextureCoord, baseGrid * 0.45, baseSpeed * 0.6,
                      baseRadius * 1.0, sway * 1.2, uTime * 0.93) * 1.0;

    vec3 snowColor = vec3(0.92, 0.96, 1.0);
    vec3 result    = src.rgb + snowColor * clamp(snow, 0.0, 1.0) * uOpacity;

    finalColor = vec4(result, src.a);
}
`;

export const snowEffect: EffectDef = {
  effect: "snow",
  displayName: "Snow",
  category: "overlay",
  schema: {
    props: z.object({
      density: z.number().min(0).max(1).default(0.5),
      speed:   z.number().min(0).max(3).default(1.0),
      size:    z.number().min(0).max(1).default(0.5),
      wind:    z.number().min(-1).max(1).default(0.2),
      opacity: z.number().min(0).max(1).default(0.6),
      time:    z.number().default(0),
    }),
    channels: [
      { path: "props.density", type: "scalar", label: "Density", default: 0.5 },
      { path: "props.speed",   type: "scalar", label: "Speed",   default: 1.0 },
      { path: "props.size",    type: "scalar", label: "Size",    default: 0.5 },
      { path: "props.wind",    type: "scalar", label: "Wind",    default: 0.2 },
      { path: "props.opacity", type: "scalar", label: "Opacity", default: 0.6 },
      { path: "props.time",    type: "scalar", label: "Time",    default: 0   },
    ],
    inspector: [
      { path: "props.density", label: "Density", control: "number", min: 0,  max: 1,    step: 0.01 },
      { path: "props.speed",   label: "Speed",   control: "number", min: 0,  max: 3,    step: 0.1  },
      { path: "props.size",    label: "Size",    control: "number", min: 0,  max: 1,    step: 0.01 },
      { path: "props.wind",    label: "Wind",    control: "number", min: -1, max: 1,    step: 0.01 },
      { path: "props.opacity", label: "Opacity", control: "number", min: 0,  max: 1,    step: 0.01 },
      { path: "props.time",    label: "Time",    control: "number", min: 0,  max: 1000, step: 0.1  },
    ],
  },
  glsl: FRAGMENT,
};
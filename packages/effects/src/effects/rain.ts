// packages/effects/src/effects/rain.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// RAIN — Procedural overlay effect
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates rain streaks procedurally and composites them over the source
// using an additive/alpha blend. No external assets required.
//
// TECHNIQUE
// ---------
// The UV space is divided into a grid of cells. Within each cell, a single
// raindrop streak is placed at a pseudo-random x position determined by a
// per-cell hash. The streak is:
//
//   • A thin vertical (or angled) line with a soft Gaussian cross-section
//   • A length determined by uSpeed (faster = longer streak = motion blur)
//   • Animated by scrolling the grid vertically with uTime
//
// Multiple "layers" of rain are composited at different scales, speeds and
// opacities to create depth — foreground drops are larger and faster,
// background drops are smaller and slower.
//
// LAYER DESIGN (3 layers)
// -----------------------
//   Layer 0: far background — small, slow, faint, fine grid
//   Layer 1: mid distance  — medium, moderate, semi-transparent
//   Layer 2: foreground    — large, fast, bright, coarse grid
//
// Angle: shifts uv.x proportionally to uv.y before grid quantisation,
// giving the impression of wind-driven rain.
//
// COMPOSITING
// -----------
// Rain is additive over the source — src.rgb + rain * uOpacity * rainColor.
// This matches how real rain looks: light-coloured translucent streaks that
// add brightness rather than obscure the scene.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uDensity;    // grid fineness — more cells = more drops (0-1)
uniform float uSpeed;      // fall speed and streak length (0-5)
uniform float uAngle;      // wind angle in degrees (-45 to +45)
uniform float uOpacity;    // overall rain opacity (0-1)
uniform float uTime;       // animation time (keyframe for playback)

// ── Hash ────────────────────────────────────────────────────────────────────
// Returns a pseudo-random float in [0,1] for a vec2 seed.
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}

// ── Single rain layer ────────────────────────────────────────────────────────
// gridScale:  number of cells across the image (higher = finer rain)
// speed:      how fast this layer falls
// thickness:  cross-section width of each streak in UV units
// streakLen:  length of each streak in UV units
// opacity:    brightness of this layer
float rainLayer(vec2 uv, float gridScale, float speed, float thickness,
                float streakLen, float opacity, float time, float angleTan) {

    // Apply wind angle: shift x proportional to y
    uv.x += uv.y * angleTan;

    // Scroll the UV vertically at this layer's speed
    uv.y -= time * speed;

    // Quantise into grid cells
    vec2  cell    = floor(uv * gridScale);
    vec2  cellUV  = fract(uv * gridScale);   // [0,1] within the cell

    // Each cell gets a random x-offset for the drop's position within the cell
    float dropX   = hash21(cell);
    // Each cell gets a random phase offset so drops aren't all in sync
    float phase   = hash21(cell + vec2(7.3, 2.1));
    // Random vertical start position within cell (so drops emerge at different times)
    float startY  = hash21(cell + vec2(1.7, 5.9));

    // Horizontal distance from the drop centre — Gaussian falloff for soft edges
    float dx      = abs(cellUV.x - dropX);
    float xWeight = exp(-dx * dx / (thickness * thickness));

    // The drop occupies a streak from startY upward by streakLen.
    // We add a small oscillation so adjacent drops shimmer slightly.
    float dropTop = fract(startY + phase * 0.3);
    float yInDrop = cellUV.y - dropTop;
    // Soft head and tail — smoothstep for the tip, linear falloff for the body
    float yWeight = smoothstep(0.0, 0.05, yInDrop)
                  * smoothstep(streakLen, 0.0, yInDrop);

    return xWeight * yWeight * opacity;
}

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);

    // Precompute angle tangent for wind effect
    float rad      = uAngle * 0.01745329;
    float angleTan = tan(rad);

    // Map uDensity [0,1] → grid scale [8, 40] — finer at higher density
    float baseGrid = mix(8.0, 40.0, uDensity);
    // Map uSpeed [0,5] → actual fall speed per second
    float baseSpeed = uSpeed * 0.4;

    // Accumulate 3 layers: background, mid, foreground
    float rain = 0.0;

    // Layer 0 — background (fine, slow, faint)
    rain += rainLayer(vTextureCoord, baseGrid * 1.8, baseSpeed * 0.5,
                      0.003, 0.12, 0.3, uTime, angleTan);

    // Layer 1 — midground
    rain += rainLayer(vTextureCoord, baseGrid * 1.0, baseSpeed * 0.8,
                      0.005, 0.18, 0.55, uTime * 1.1, angleTan);

    // Layer 2 — foreground (coarse, fast, bright)
    rain += rainLayer(vTextureCoord, baseGrid * 0.5, baseSpeed * 1.4,
                      0.008, 0.28, 0.8, uTime * 0.9, angleTan);

    // Additive composite — rain adds brightness, slight blue-white tint
    vec3 rainColor = vec3(0.75, 0.85, 1.0);
    vec3 result    = src.rgb + rainColor * clamp(rain, 0.0, 1.0) * uOpacity;

    finalColor = vec4(result, src.a);
}
`;

export const rainEffect: EffectDef = {
  effect: "rain",
  displayName: "Rain",
  category: "overlay",
  schema: {
    props: z.object({
      density: z.number().min(0).max(1).default(0.5),
      speed:   z.number().min(0).max(5).default(1.5),
      angle:   z.number().min(-45).max(45).default(-15),
      opacity: z.number().min(0).max(1).default(0.4),
      time:    z.number().default(0),
    }),
    channels: [
      { path: "props.density", type: "scalar", label: "Density", default: 0.5  },
      { path: "props.speed",   type: "scalar", label: "Speed",   default: 1.5  },
      { path: "props.angle",   type: "scalar", label: "Angle",   default: -15  },
      { path: "props.opacity", type: "scalar", label: "Opacity", default: 0.4  },
      { path: "props.time",    type: "scalar", label: "Time",    default: 0    },
    ],
    inspector: [
      { path: "props.density", label: "Density", control: "number", min: 0,   max: 1,   step: 0.01 },
      { path: "props.speed",   label: "Speed",   control: "number", min: 0,   max: 5,   step: 0.1  },
      { path: "props.angle",   label: "Angle",   control: "number", min: -45, max: 45,  step: 1    },
      { path: "props.opacity", label: "Opacity", control: "number", min: 0,   max: 1,   step: 0.01 },
      { path: "props.time",    label: "Time",    control: "number", min: 0,   max: 1000, step: 0.1 },
    ],
  },
  glsl: FRAGMENT,
};
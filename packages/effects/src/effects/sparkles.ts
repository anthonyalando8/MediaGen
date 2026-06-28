// packages/effects/src/effects/sparkles.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// SPARKLES — Procedural overlay effect
// ─────────────────────────────────────────────────────────────────────────────
//
// TECHNIQUE
// ---------
// Sparkles (glitter, twinkle stars) are implemented as:
//   1. A grid of potential sparkle positions (one per cell)
//   2. Each sparkle has a random birth time and lifetime — it fades in,
//      peaks, and fades out. This creates the characteristic "twinkling"
//      without any textures.
//   3. At peak brightness, a 4-point star shape is drawn using a distance
//      function that produces the classic diamond/cross sparkle silhouette.
//
// STAR SHAPE
// ----------
// A 4-point star is approximated by the L∞ distance in rotated coordinates:
//   shape = max(|x|, |y|) + (|x| + |y|) * sharpness
// This produces a clean cross/diamond at low sharpness and a tight point
// at high sharpness. Much cheaper than ray-march approaches.
//
// LIFECYCLE
// ---------
// Each sparkle has a random phase offset. The life cycle is:
//   fade_in → hold → fade_out → dark → repeat
// Driven by: sin(time * frequency + phase)^2 — smoothly oscillates,
// always in [0,1], no conditional branches needed.
//
// COLOUR
// ------
// Sparkles are near-white with a random hue offset per cell — some lean
// golden, some blue-white, some pure white. This matches real glitter.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uDensity;    // grid fineness (0-1)
uniform float uSize;       // sparkle size (0-1)
uniform float uSpeed;      // twinkle speed (0-5)
uniform float uSharpness;  // star point sharpness (0-1)
uniform float uOpacity;    // overall opacity (0-1)
uniform float uTime;

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}

// 4-point star signed distance — returns 0 at edge, negative inside.
// uv: position relative to star centre.
// r:  radius of the star.
// sharpness: [0,1] — 0 = diamond, 1 = very sharp cross.
float starSDF(vec2 uv, float r, float sharpness) {
    vec2 a = abs(uv);
    // Rotate 45 degrees: mix between L1 (diamond) and Linf (square) norm
    float d1 = max(a.x, a.y);         // Linf = axis-aligned cross
    float d2 = (a.x + a.y) * 0.7071;  // L1   = diamond
    float d  = mix(d2, d1, sharpness);
    return d - r;
}

float sparkleLayer(vec2 uv, float gridScale, float radius, float speed, float sharp, float time) {
    vec2  cell   = floor(uv * gridScale);
    vec2  cellUV = fract(uv * gridScale) - 0.5;

    // Random position within cell
    float rx     = hash21(cell) - 0.5;
    float ry     = hash21(cell + vec2(1.3, 4.7)) - 0.5;
    vec2  pos    = vec2(rx, ry) * 0.8;

    // Random phase and frequency for the twinkle oscillation
    float phase  = hash21(cell + vec2(2.1, 9.3)) * 6.2832;
    float freq   = speed * (0.6 + hash21(cell + vec2(5.5, 3.2)) * 0.8);

    // Life: smooth oscillation — sparkle is bright when near peak
    float life   = pow(max(0.0, sin(time * freq + phase)), 2.0);

    // Star shape distance
    float d      = starSDF(cellUV - pos, radius, sharp);
    float shape  = smoothstep(radius * 0.2, -radius * 0.1, d);

    // Rays: add a cross-shaped glow for the "rays" of a sparkle
    float rayX   = exp(-abs(cellUV.x - pos.x) * 18.0 / radius)
                 * smoothstep(radius * 2.0, 0.0, abs(cellUV.y - pos.y));
    float rayY   = exp(-abs(cellUV.y - pos.y) * 18.0 / radius)
                 * smoothstep(radius * 2.0, 0.0, abs(cellUV.x - pos.x));

    return (shape + (rayX + rayY) * 0.3) * life;
}

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);

    float baseGrid   = mix(6.0, 30.0, uDensity);
    float baseRadius = mix(0.04, 0.22, uSize);
    float sharp      = uSharpness;

    float sparkle = 0.0;

    // Two layers: background (fine) and foreground (coarse, larger)
    sparkle += sparkleLayer(vTextureCoord, baseGrid * 1.8, baseRadius * 0.6,
                             uSpeed, sharp, uTime) * 0.6;
    sparkle += sparkleLayer(vTextureCoord, baseGrid * 0.9, baseRadius * 1.0,
                             uSpeed, sharp, uTime * 1.13) * 1.0;

    // Colour: near-white with slight golden tint at highlights
    vec3 sparkleColor = vec3(1.0, 0.97, 0.85);

    // Bloom: add a soft glow around each sparkle
    vec3 result = src.rgb + sparkleColor * clamp(sparkle, 0.0, 1.0) * uOpacity;

    finalColor = vec4(result, src.a);
}
`;

export const sparklesEffect: EffectDef = {
  effect: "sparkles",
  displayName: "Sparkles",
  category: "overlay",
  schema: {
    props: z.object({
      density:   z.number().min(0).max(1).default(0.4),
      size:      z.number().min(0).max(1).default(0.4),
      speed:     z.number().min(0).max(5).default(1.5),
      sharpness: z.number().min(0).max(1).default(0.7),
      opacity:   z.number().min(0).max(1).default(0.8),
      time:      z.number().default(0),
    }),
    channels: [
      { path: "props.density",   type: "scalar", label: "Density",   default: 0.4 },
      { path: "props.size",      type: "scalar", label: "Size",      default: 0.4 },
      { path: "props.speed",     type: "scalar", label: "Speed",     default: 1.5 },
      { path: "props.sharpness", type: "scalar", label: "Sharpness", default: 0.7 },
      { path: "props.opacity",   type: "scalar", label: "Opacity",   default: 0.8 },
      { path: "props.time",      type: "scalar", label: "Time",      default: 0   },
    ],
    inspector: [
      { path: "props.density",   label: "Density",   control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.size",      label: "Size",      control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.speed",     label: "Speed",     control: "number", min: 0, max: 5,    step: 0.1  },
      { path: "props.sharpness", label: "Sharpness", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.opacity",   label: "Opacity",   control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.time",      label: "Time",      control: "number", min: 0, max: 1000, step: 0.1  },
    ],
  },
  glsl: FRAGMENT,
};
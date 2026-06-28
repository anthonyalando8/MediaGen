// packages/effects/src/effects/light-leaks.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// LIGHT LEAKS — Procedural overlay effect
// ─────────────────────────────────────────────────────────────────────────────
//
// TECHNIQUE
// ---------
// Film light leaks are caused by stray light entering the film canister —
// they appear as organic, gradient-filled blobs of colour, typically near
// the edges/corners, in warm (amber, orange, red) or cool (cyan, violet) tones.
//
// This implementation generates 3 overlapping elliptical gradient "blobs"
// using a lens-shaped falloff function. Each blob has:
//   • A random edge position (corner or side entry point)
//   • A colour sampled from a warm/cool palette
//   • A slow animated drift to simulate film movement
//   • Screen blend mode so it adds light without over-brightening
//
// COLOUR PALETTE
// --------------
// Light leaks are typically warm: amber (1.0, 0.6, 0.1), red-orange
// (1.0, 0.3, 0.1), magenta (1.0, 0.2, 0.6), or cool cyan (0.1, 0.8, 1.0).
// We encode 4 colours and select based on a per-blob hash.
//
// SCREEN BLEND
// ------------
// screen(a, b) = 1 - (1-a)(1-b)
// Ensures the leak always adds light — it can never darken the image.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uIntensity;  // overall brightness of the leaks (0-2)
uniform float uSpread;     // how far the leaks reach into the frame (0-1)
uniform float uWarmth;     // 0=cool palette, 1=warm palette (0-1)
uniform float uTime;       // slow drift animation

float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453);
}
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}

// Lens flare / leak shape — a radially falloff gradient anchored at a corner.
// origin: where the leak enters (corner/edge in UV space)
// uv:     current pixel position
// spread: how far the gradient extends
float leakShape(vec2 uv, vec2 origin, float spread) {
    float d = length(uv - origin);
    return pow(max(0.0, 1.0 - d / spread), 2.5);
}

// Pick a colour from the warm or cool palette based on index [0,1]
vec3 leakColor(float idx, float warmth) {
    // Warm palette: amber, orange-red, magenta-red, golden
    vec3 warm0 = vec3(1.00, 0.60, 0.10); // amber
    vec3 warm1 = vec3(1.00, 0.30, 0.08); // orange-red
    vec3 warm2 = vec3(0.95, 0.20, 0.55); // magenta
    vec3 warm3 = vec3(1.00, 0.80, 0.20); // golden

    // Cool palette: cyan, violet, blue, teal
    vec3 cool0 = vec3(0.10, 0.80, 1.00); // cyan
    vec3 cool1 = vec3(0.55, 0.10, 1.00); // violet
    vec3 cool2 = vec3(0.15, 0.30, 1.00); // blue
    vec3 cool3 = vec3(0.10, 0.95, 0.70); // teal

    vec3 warm = idx < 0.25 ? warm0 : (idx < 0.5 ? warm1 : (idx < 0.75 ? warm2 : warm3));
    vec3 cool = idx < 0.25 ? cool0 : (idx < 0.5 ? cool1 : (idx < 0.75 ? cool2 : cool3));
    return mix(cool, warm, warmth);
}

// Screen blend: adds light without over-brightening
vec3 screen(vec3 base, vec3 overlay) {
    return 1.0 - (1.0 - base) * (1.0 - overlay);
}

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);
    vec2 uv  = vTextureCoord;

    // 4 corners + slight time drift per blob
    vec2 corners[4];
    corners[0] = vec2(0.0, 0.0); // top-left
    corners[1] = vec2(1.0, 0.0); // top-right
    corners[2] = vec2(0.0, 1.0); // bottom-left
    corners[3] = vec2(1.0, 1.0); // bottom-right

    float spread = mix(0.3, 0.9, uSpread);
    vec3  leaks  = vec3(0.0);

    // Blob 0
    float d0  = hash11(0.0);
    vec2  o0  = corners[0] + vec2(hash11(0.1) - 0.5, hash11(0.2) - 0.5) * 0.15;
    o0       += vec2(sin(uTime * 0.07) * 0.04, cos(uTime * 0.05) * 0.03);
    float l0  = leakShape(uv, o0, spread * (0.6 + d0 * 0.4)) * (0.5 + d0 * 0.5);
    leaks    += leakColor(d0, uWarmth) * l0;

    // Blob 1
    float d1  = hash11(1.0);
    vec2  o1  = corners[1] + vec2(hash11(1.1) - 0.5, hash11(1.2) - 0.5) * 0.15;
    o1       += vec2(cos(uTime * 0.09) * 0.03, sin(uTime * 0.06) * 0.04);
    float l1  = leakShape(uv, o1, spread * (0.5 + d1 * 0.5)) * (0.4 + d1 * 0.6);
    leaks    += leakColor(d1, uWarmth) * l1;

    // Blob 2 — mid-frame, larger and softer
    float d2  = hash11(2.0);
    vec2  o2  = vec2(0.5 + (hash11(2.1) - 0.5) * 0.6, hash11(2.2) * 0.3);
    o2       += vec2(sin(uTime * 0.05 + 1.2) * 0.05, cos(uTime * 0.08) * 0.02);
    float l2  = leakShape(uv, o2, spread * 0.8) * 0.6;
    leaks    += leakColor(d2, uWarmth) * l2;

    // Screen composite
    vec3 result = screen(src.rgb, clamp(leaks * uIntensity, 0.0, 1.0));
    finalColor  = vec4(result, src.a);
}
`;

export const lightLeaksEffect: EffectDef = {
  effect: "light-leaks",
  displayName: "Light Leaks",
  category: "overlay",
  schema: {
    props: z.object({
      intensity: z.number().min(0).max(2).default(0.8),
      spread:    z.number().min(0).max(1).default(0.5),
      warmth:    z.number().min(0).max(1).default(0.8),
      time:      z.number().default(0),
    }),
    channels: [
      { path: "props.intensity", type: "scalar", label: "Intensity", default: 0.8 },
      { path: "props.spread",    type: "scalar", label: "Spread",    default: 0.5 },
      { path: "props.warmth",    type: "scalar", label: "Warmth",    default: 0.8 },
      { path: "props.time",      type: "scalar", label: "Time",      default: 0   },
    ],
    inspector: [
      { path: "props.intensity", label: "Intensity", control: "number", min: 0, max: 2,    step: 0.01 },
      { path: "props.spread",    label: "Spread",    control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.warmth",    label: "Warmth",    control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.time",      label: "Time",      control: "number", min: 0, max: 1000, step: 0.1  },
    ],
  },
  glsl: FRAGMENT,
};
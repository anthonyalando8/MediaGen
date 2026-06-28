// packages/effects/src/effects/dust.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// DUST — Procedural floating dust / film dust / bokeh particles overlay
// ─────────────────────────────────────────────────────────────────────────────
//
// TECHNIQUE
// ---------
// Dust particles are distinguishable from snow by:
//   • Much slower, nearly random motion (Brownian motion simulation)
//   • Irregular shapes (elongated, not perfectly circular)
//   • High variation in size and opacity
//   • Colour tinted warm (dust reflects golden ambient light)
//   • Larger particles have visible depth-of-field bokeh softness
//
// MOTION MODEL
// ------------
// Each particle drifts in a slowly evolving random direction:
//   pos = seed_pos + noise(time * driftSpeed + seed) * driftAmp
// This creates natural, non-repeating Brownian motion without needing
// actual physics.
//
// SHAPE
// -----
// Particles are soft ellipses slightly rotated per-particle. The rotation
// is computed from a per-seed random angle.
//
// BOKEH SOFTNESS
// --------------
// Larger (nearer) particles are softer — simulating depth of field.
// Smaller (distant) particles are sharper.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uDensity;   // particle density (0-1)
uniform float uSize;      // particle size (0-1)
uniform float uSpeed;     // drift speed (0-2)
uniform float uColor;     // 0=warm dust, 1=cool/white (0-1)
uniform float uOpacity;   // overall opacity (0-1)
uniform float uTime;

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}
float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

// Simple 2D value noise for smooth drift
float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float dustLayer(vec2 uv, float gridScale, float radius, float speed, float time) {
    vec2  cell   = floor(uv * gridScale);
    vec2  cellUV = fract(uv * gridScale) - 0.5;

    // Seed positions
    float sx     = hash21(cell) - 0.5;
    float sy     = hash21(cell + vec2(3.2, 7.8)) - 0.5;
    float phase  = hash21(cell + vec2(1.1, 5.4));
    float rot    = hash21(cell + vec2(8.3, 2.7)) * 6.2832; // random rotation
    float sizeV  = 0.4 + hash21(cell + vec2(4.6, 9.1)) * 0.6;
    float aspect = 1.0 + hash21(cell + vec2(2.3, 6.7)) * 1.5; // ellipse aspect

    // Brownian drift using noise
    float driftX = noise21(vec2(phase * 7.3, time * speed * 0.4)) * 2.0 - 1.0;
    float driftY = noise21(vec2(phase * 5.1, time * speed * 0.4 + 1.7)) * 2.0 - 1.0;

    vec2  pos    = vec2(sx + driftX * 0.35, sy + driftY * 0.35);

    // Rotate the ellipse
    vec2  d      = cellUV - pos;
    float cosR   = cos(rot);
    float sinR   = sin(rot);
    vec2  dRot   = vec2(d.x * cosR - d.y * sinR,
                        d.x * sinR + d.y * cosR);

    // Elliptical distance
    float dist   = length(vec2(dRot.x * aspect, dRot.y));

    float r      = radius * sizeV;
    // Softer for larger particles (bokeh)
    float softness = 0.3 + sizeV * 0.5;
    float particle = smoothstep(r, r * (1.0 - softness), dist);

    // Opacity variation — distant particles are more transparent
    float opacity = 0.3 + (1.0 - sizeV) * 0.7;
    return particle * opacity;
}

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);

    float baseGrid   = mix(8.0, 35.0, uDensity);
    float baseRadius = mix(0.025, 0.1, uSize);

    float dust = 0.0;

    // 3 layers for depth variation
    dust += dustLayer(vTextureCoord, baseGrid * 1.8, baseRadius * 0.5, uSpeed, uTime) * 0.5;
    dust += dustLayer(vTextureCoord, baseGrid * 1.0, baseRadius * 0.8, uSpeed, uTime * 0.87) * 0.8;
    dust += dustLayer(vTextureCoord, baseGrid * 0.5, baseRadius * 1.0, uSpeed, uTime * 1.13) * 1.0;

    // Colour: warm dust (golden) or cool (white/blue)
    vec3 warmDust = vec3(1.0, 0.90, 0.65);
    vec3 coolDust = vec3(0.90, 0.95, 1.0);
    vec3 dustColor = mix(warmDust, coolDust, uColor);

    vec3 result = src.rgb + dustColor * clamp(dust, 0.0, 1.0) * uOpacity;
    finalColor  = vec4(result, src.a);
}
`;

export const dustEffect: EffectDef = {
  effect: "dust",
  displayName: "Dust Particles",
  category: "overlay",
  schema: {
    props: z.object({
      density: z.number().min(0).max(1).default(0.5),
      size:    z.number().min(0).max(1).default(0.4),
      speed:   z.number().min(0).max(2).default(0.5),
      color:   z.number().min(0).max(1).default(0.2),
      opacity: z.number().min(0).max(1).default(0.5),
      time:    z.number().default(0),
    }),
    channels: [
      { path: "props.density", type: "scalar", label: "Density", default: 0.5 },
      { path: "props.size",    type: "scalar", label: "Size",    default: 0.4 },
      { path: "props.speed",   type: "scalar", label: "Speed",   default: 0.5 },
      { path: "props.color",   type: "scalar", label: "Color",   default: 0.2 },
      { path: "props.opacity", type: "scalar", label: "Opacity", default: 0.5 },
      { path: "props.time",    type: "scalar", label: "Time",    default: 0   },
    ],
    inspector: [
      { path: "props.density", label: "Density",         control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.size",    label: "Size",            control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.speed",   label: "Speed",           control: "number", min: 0, max: 2,    step: 0.1  },
      { path: "props.color",   label: "Color (0=warm)", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.opacity", label: "Opacity",         control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.time",    label: "Time",            control: "number", min: 0, max: 1000, step: 0.1  },
    ],
  },
  glsl: FRAGMENT,
};

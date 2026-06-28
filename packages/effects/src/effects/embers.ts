// packages/effects/src/effects/embers.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// EMBERS — Procedural fire embers / floating particles overlay
// ─────────────────────────────────────────────────────────────────────────────
//
// TECHNIQUE
// ---------
// Fire embers are small glowing particles that:
//   • Rise upward (buoyancy — hot air rises)
//   • Drift slightly left/right (turbulence)
//   • Fade from bright orange/yellow at birth to red then dark as they cool
//   • Have a random size, speed and lifetime per particle
//
// PARTICLE GRID
// -------------
// The screen is divided into a grid. Each cell has one ember, placed at a
// random x position within the cell. The ember's lifecycle is determined by
// how far it has risen — it starts at the bottom of the cell and rises,
// with its colour and opacity changing continuously.
//
// COLOUR RAMP
// -----------
// Embers follow a physically-based temperature ramp:
//   Bright white-yellow → orange → deep red → dark (fading out)
// Encoded as a 3-stop gradient mixed via the particle's life parameter.
//
// GLOW
// ----
// Each ember has a soft radial glow (additive) sized proportional to its
// brightness — bright young embers have a larger halo than cooling ones.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uDensity;   // ember density (0-1)
uniform float uSpeed;     // rise speed (0-3)
uniform float uSize;      // ember size (0-1)
uniform float uSpread;    // horizontal turbulence (0-1)
uniform float uOpacity;   // overall opacity (0-1)
uniform float uTime;

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}
float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453);
}

// Ember colour ramp: t=0 is birth (hot), t=1 is death (cool)
vec3 emberColor(float t) {
    // 0.0 = white-yellow (hottest)
    // 0.4 = orange
    // 0.7 = deep red
    // 1.0 = dark (gone)
    vec3 c0 = vec3(1.00, 0.95, 0.60); // white-yellow
    vec3 c1 = vec3(1.00, 0.40, 0.05); // orange
    vec3 c2 = vec3(0.70, 0.05, 0.01); // deep red
    vec3 c3 = vec3(0.10, 0.01, 0.00); // dark / out

    vec3 col;
    if (t < 0.4) {
        col = mix(c0, c1, t / 0.4);
    } else if (t < 0.7) {
        col = mix(c1, c2, (t - 0.4) / 0.3);
    } else {
        col = mix(c2, c3, (t - 0.7) / 0.3);
    }
    return col;
}

float emberLayer(vec2 uv, float gridScale, float speed, float radius,
                 float spread, float time, out vec3 color) {
    vec2  cell   = floor(uv * gridScale);
    vec2  cellUV = fract(uv * gridScale) - 0.5;

    // Random x position within cell
    float rx     = hash21(cell) - 0.5;
    // Random speed variation per ember
    float sv     = 0.7 + hash21(cell + vec2(1.3, 4.7)) * 0.6;
    // Random phase so embers spawn at different times
    float phase  = hash21(cell + vec2(7.2, 2.9));

    // Rise: y position increases with time, wraps at top
    float t      = fract(time * speed * sv * 0.08 + phase);
    // t=0: ember is at bottom of its cell; t=1: it has risen and faded out

    // Horizontal turbulence: sinusoidal drift proportional to height
    float drift  = sin(time * 2.1 * sv + phase * 6.28) * spread * 0.3 * t;

    // Ember position in cell coordinates
    vec2  pos    = vec2(rx * 0.7 + drift, 0.5 - t);  // rises from bottom to top

    // Distance from pixel to ember centre
    float dist   = length(cellUV - pos);

    // Size: embers shrink as they cool
    float r      = radius * (1.0 - t * 0.6);
    // Opacity: fade in at birth, fade out near death
    float life   = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.75, t);

    // Core + soft glow
    float core   = smoothstep(r, r * 0.3, dist);
    float glow   = exp(-dist * dist / (r * r * 4.0)) * 0.4;

    color        = emberColor(t);
    return (core + glow) * life;
}

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);

    float baseGrid   = mix(6.0, 28.0, uDensity);
    float baseRadius = mix(0.03, 0.12, uSize);

    float ember = 0.0;
    vec3  color = vec3(0.0);
    vec3  colA  = vec3(0.0);
    vec3  colB  = vec3(0.0);
    vec3  colC  = vec3(0.0);
    float eA, eB, eC;

    // 3 layers for depth
    eA = emberLayer(vTextureCoord, baseGrid * 1.6, uSpeed, baseRadius * 0.6,
                    uSpread, uTime, colA);
    eB = emberLayer(vTextureCoord, baseGrid * 1.0, uSpeed, baseRadius * 0.85,
                    uSpread, uTime * 1.09, colB);
    eC = emberLayer(vTextureCoord, baseGrid * 0.55, uSpeed, baseRadius * 1.0,
                    uSpread, uTime * 0.92, colC);

    // Weighted sum
    float total = eA + eB + eC;
    if (total > 0.0) {
        color = (colA * eA + colB * eB + colC * eC) / total;
    }

    // Additive composite — embers add warm light
    vec3 result = src.rgb + color * clamp(total, 0.0, 1.0) * uOpacity;
    finalColor  = vec4(result, src.a);
}
`;

export const embersEffect: EffectDef = {
  effect: "embers",
  displayName: "Embers",
  category: "overlay",
  schema: {
    props: z.object({
      density: z.number().min(0).max(1).default(0.5),
      speed:   z.number().min(0).max(3).default(1.0),
      size:    z.number().min(0).max(1).default(0.4),
      spread:  z.number().min(0).max(1).default(0.4),
      opacity: z.number().min(0).max(1).default(0.8),
      time:    z.number().default(0),
    }),
    channels: [
      { path: "props.density", type: "scalar", label: "Density", default: 0.5 },
      { path: "props.speed",   type: "scalar", label: "Speed",   default: 1.0 },
      { path: "props.size",    type: "scalar", label: "Size",    default: 0.4 },
      { path: "props.spread",  type: "scalar", label: "Spread",  default: 0.4 },
      { path: "props.opacity", type: "scalar", label: "Opacity", default: 0.8 },
      { path: "props.time",    type: "scalar", label: "Time",    default: 0   },
    ],
    inspector: [
      { path: "props.density", label: "Density", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.speed",   label: "Speed",   control: "number", min: 0, max: 3,    step: 0.1  },
      { path: "props.size",    label: "Size",    control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.spread",  label: "Spread",  control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.opacity", label: "Opacity", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.time",    label: "Time",    control: "number", min: 0, max: 1000, step: 0.1  },
    ],
  },
  glsl: FRAGMENT,
};

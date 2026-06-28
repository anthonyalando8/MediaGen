// packages/effects/src/effects/bubbles.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// BUBBLES — Procedural soap bubble / underwater bubble overlay
// ─────────────────────────────────────────────────────────────────────────────
//
// TECHNIQUE
// ---------
// Bubbles are rendered using a circle SDF with:
//   1. Transparent interior with slight refraction (thin glass lens effect)
//   2. A bright iridescent rim — soap bubbles reflect the environment via
//      thin-film interference, producing rainbow colours
//   3. A specular highlight at the top-left (ambient lighting)
//   4. Soft glow around the outside
//
// IRIDESCENT RIM
// --------------
// Thin-film interference produces colours that shift based on the viewing
// angle. We approximate this by rotating through the hue spectrum based on
// the angle around the bubble's circumference:
//   angle = atan(dy, dx)
//   hue = angle / (2*PI) + time * drift
// A HSV→RGB conversion produces the rainbow ring.
//
// REFRACTION
// ----------
// The bubble interior slightly distorts the background, sampling from a
// neighbourhood of the current UV. A sphere normal approximation (same as
// water droplets) drives a subtle inward displacement.
//
// LIFECYCLE
// ---------
// Bubbles drift upward and sway. They don't pop — they wrap around the top
// of the frame, creating a continuous ambient effect.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uDensity;   // bubble density (0-1)
uniform float uSize;      // bubble size range (0-1)
uniform float uSpeed;     // rise speed (0-3)
uniform float uRainbow;   // iridescent rim intensity (0-1)
uniform float uOpacity;   // overall opacity (0-1)
uniform float uTime;

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}

// Hue to RGB conversion (no external textures needed)
vec3 hue2rgb(float h) {
    h = fract(h);
    float r = abs(h * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(h * 6.0 - 2.0);
    float b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}

// Draw a single bubble and return its colour contribution.
// Returns 0 outside the bubble, additive RGB inside/on rim.
vec3 bubble(vec2 uv, vec2 centre, float radius, float rainbow, float time) {
    vec2  d      = uv - centre;
    float aspect = uInputSize.x / uInputSize.y;
    d.x         *= aspect;                 // correct for non-square screens
    float dist   = length(d);

    if (dist > radius * 1.1) return vec3(0.0);

    // ── Rim iridescence ───────────────────────────────────────────────────
    float rimStart = radius * 0.82;
    float rimEnd   = radius * 1.0;
    float rim      = smoothstep(rimStart, rimEnd, dist)
                   * smoothstep(rimEnd * 1.08, rimEnd, dist);

    float angle    = atan(d.y, d.x / aspect);  // 0 to 2*PI around the bubble
    float hue      = angle / 6.2832 + time * 0.08;
    vec3  iridescence = hue2rgb(hue) * rim * rainbow;

    // ── Interior refraction ───────────────────────────────────────────────
    float interior = smoothstep(rimStart, rimStart * 0.9, dist);
    vec2  norm2    = d / max(dist, 0.001) / aspect;
    float h        = sqrt(max(0.0, 1.0 - dot(norm2 * (dist / radius),
                                              norm2 * (dist / radius))));
    vec2  refUV    = vTextureCoord - norm2 * (1.0 - h) * 0.04;
    vec3  refColor = texture(uTexture, clamp(refUV, 0.0, 1.0)).rgb;

    // ── Specular highlight (top-left, simulates overhead light) ──────────
    vec2  lightDir = normalize(vec2(-0.6, -0.8));
    float spec     = pow(max(0.0, dot(normalize(vec3(-d.x / aspect, -d.y, h)),
                                      vec3(lightDir, 0.5))), 12.0);
    float specMask = smoothstep(radius * 0.5, 0.0, dist);
    float specular = spec * specMask * 0.9;

    // ── Assemble ──────────────────────────────────────────────────────────
    vec3 result = vec3(0.0);
    result += iridescence;
    result += refColor * interior * 0.08;   // subtle interior tint
    result += vec3(specular);               // white highlight

    // Outer glow
    float glow = exp(-pow((dist - radius) / (radius * 0.15), 2.0)) * 0.15;
    result    += vec3(0.8, 0.9, 1.0) * glow;

    return result;
}

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);
    vec3 acc = vec3(0.0);

    float gridScale  = mix(3.0, 12.0, uDensity);
    float maxRadius  = mix(0.03, 0.12, uSize);

    // 9 neighbouring cells — unrolled to avoid dynamic array indexing
    float aspect = uInputSize.x / uInputSize.y;

    #define BUBBLE(OX, OY) { \
        vec2  cell    = floor(vTextureCoord * gridScale + vec2(float(OX), float(OY))); \
        float rx      = hash21(cell); \
        float ry      = hash21(cell + vec2(3.7, 9.1)); \
        float rv      = hash21(cell + vec2(1.2, 5.6)); \
        float rs      = hash21(cell + vec2(7.3, 2.4)); \
        float speed   = uSpeed * (0.5 + rv * 0.8) * 0.06; \
        float phase   = hash21(cell + vec2(4.1, 8.3)); \
        float swayAmp = 0.015 / gridScale; \
        float cx = (cell.x + rx * 0.8 + 0.1 \
                   + sin(uTime * 0.9 * (0.7 + rv * 0.5) + phase * 6.28) * swayAmp) / gridScale; \
        float cy = fract((cell.y + ry * 0.8 + 0.1) / gridScale - uTime * speed + phase); \
        float r  = maxRadius * (0.4 + rs * 0.6); \
        acc     += bubble(vTextureCoord, vec2(cx, cy), r, uRainbow, uTime); \
    }

    BUBBLE(-1,-1) BUBBLE(0,-1) BUBBLE(1,-1)
    BUBBLE(-1, 0) BUBBLE(0, 0) BUBBLE(1, 0)
    BUBBLE(-1, 1) BUBBLE(0, 1) BUBBLE(1, 1)
    #undef BUBBLE

    // Additive composite
    vec3 result = src.rgb + acc * uOpacity;
    finalColor  = vec4(result, src.a);
}
`;

export const bubblesEffect: EffectDef = {
  effect: "bubbles",
  displayName: "Bubbles",
  category: "overlay",
  schema: {
    props: z.object({
      density: z.number().min(0).max(1).default(0.4),
      size:    z.number().min(0).max(1).default(0.5),
      speed:   z.number().min(0).max(3).default(0.8),
      rainbow: z.number().min(0).max(1).default(0.8),
      opacity: z.number().min(0).max(1).default(0.7),
      time:    z.number().default(0),
    }),
    channels: [
      { path: "props.density", type: "scalar", label: "Density", default: 0.4 },
      { path: "props.size",    type: "scalar", label: "Size",    default: 0.5 },
      { path: "props.speed",   type: "scalar", label: "Speed",   default: 0.8 },
      { path: "props.rainbow", type: "scalar", label: "Rainbow", default: 0.8 },
      { path: "props.opacity", type: "scalar", label: "Opacity", default: 0.7 },
      { path: "props.time",    type: "scalar", label: "Time",    default: 0   },
    ],
    inspector: [
      { path: "props.density", label: "Density", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.size",    label: "Size",    control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.speed",   label: "Speed",   control: "number", min: 0, max: 3,    step: 0.1  },
      { path: "props.rainbow", label: "Rainbow", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.opacity", label: "Opacity", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.time",    label: "Time",    control: "number", min: 0, max: 1000, step: 0.1  },
    ],
  },
  glsl: FRAGMENT,
};

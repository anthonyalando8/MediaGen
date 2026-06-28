// packages/effects/src/effects/old-tv.ts
//
// Old TV / CRT — combines five sub-effects in one pass:
//   1. Barrel distortion (curved screen geometry)
//   2. Scanlines (dark horizontal bands)
//   3. RGB phosphor shift (very subtle per-channel lateral offset)
//   4. Noise / static
//   5. Vignette (rounded screen corners)
//
// `time` drives the noise animation — keyframe it or drive via the
// channel system for moving static.
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uBarrel;
uniform float uScanlines;
uniform float uNoise;
uniform float uRgbShift;
uniform float uTime;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Barrel / pincushion distortion — positive = barrel, negative = pincushion.
vec2 barrel(vec2 uv, float k) {
    vec2 cc = uv - 0.5;
    float r2 = dot(cc, cc);
    return uv + cc * (r2 * k);
}

void main(void) {
    // 1. Barrel distortion
    vec2 uv = barrel(vTextureCoord, uBarrel * 0.5);

    // Vignette from barrel (black outside the original rect)
    float vign = 0.0;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        finalColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // 2. Rounded-corner vignette
    vec2 vig = abs(uv - 0.5) * 2.2;
    float vigMask = smoothstep(0.9, 1.0, max(vig.x, vig.y));
    vign = vigMask;

    // 3. RGB phosphor shift
    float shift = uRgbShift / uInputSize.x;
    float r = texture(uTexture, uv + vec2( shift, 0.0)).r;
    float g = texture(uTexture, uv             ).g;
    float b = texture(uTexture, uv - vec2( shift, 0.0)).b;
    float a = texture(uTexture, uv             ).a;
    vec3 col = vec3(r, g, b);

    // 4. Scanlines — dark band every 2 screen pixels
    float line   = floor(uv.y * uInputSize.y);
    float scan   = mix(1.0, 0.55, step(0.5, fract(line * 0.5))) * uScanlines;
    col *= (1.0 - uScanlines) + scan;

    // 5. Noise / static
    float noise = (hash(uv + vec2(uTime * 0.1)) - 0.5) * 2.0;
    col += noise * uNoise;

    // Apply vignette
    col = mix(col, vec3(0.0), vign);

    // Slight desaturation + contrast for that faded CRT look
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(lum), 0.15);
    col = (col - 0.5) * 1.05 + 0.5;

    finalColor = vec4(clamp(col, 0.0, 1.0), a);
}
`;

export const oldTvEffect: EffectDef = {
  effect: "old-tv",
  displayName: "Old TV",
  category: "stylize",
  schema: {
    props: z.object({
      barrel:   z.number().min(0).max(1).default(0.3),
      scanlines: z.number().min(0).max(1).default(0.4),
      noise:    z.number().min(0).max(0.5).default(0.05),
      rgbShift: z.number().min(0).max(10).default(1.5),
      time:     z.number().default(0),
    }),
    channels: [
      { path: "props.barrel",    type: "scalar", label: "Barrel",    default: 0.3  },
      { path: "props.scanlines", type: "scalar", label: "Scanlines", default: 0.4  },
      { path: "props.noise",     type: "scalar", label: "Noise",     default: 0.05 },
      { path: "props.rgbShift",  type: "scalar", label: "RGB Shift", default: 1.5  },
      { path: "props.time",      type: "scalar", label: "Time",      default: 0    },
    ],
    inspector: [
      { path: "props.barrel",    label: "Barrel",    control: "number", min: 0, max: 1,   step: 0.01 },
      { path: "props.scanlines", label: "Scanlines", control: "number", min: 0, max: 1,   step: 0.01 },
      { path: "props.noise",     label: "Noise",     control: "number", min: 0, max: 0.5, step: 0.01 },
      { path: "props.rgbShift",  label: "RGB Shift", control: "number", min: 0, max: 10,  step: 0.1  },
      { path: "props.time",      label: "Time",      control: "number", min: 0, max: 1000, step: 0.1 },
    ],
  },
  glsl: FRAGMENT,
};

// packages/effects/src/effects/glow.ts
//
// Glow/bloom: extracts pixels above `uThreshold` (a bright-pass), blurs
// that extracted layer using a small fixed-radius kernel, then adds it
// back additively, scaled by `uIntensity`. Single-pass: the bright-pass
// extraction and a fixed-radius blur both happen in one fragment shader
// (a cheaper, lower-quality approximation than blur.ts's true separable
// 2-pass — appropriate for glow, where the blur itself doesn't need to be
// precise, just soft).

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uThreshold;
uniform float uIntensity;
uniform float uRadius;

vec3 brightPass(vec3 color) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return color * smoothstep(uThreshold, uThreshold + 0.2, luma);
}

void main(void) {
    vec4 base = texture(uTexture, vTextureCoord);
    vec2 texel = uRadius / uInputSize.xy;

    vec3 bloom = vec3(0.0);
    float total = 0.0;
    // a small fixed 5x5 ring sample — cheap single-pass approximation, not
    // a true Gaussian (see module doc on why that's an acceptable tradeoff
    // for glow specifically).
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            vec2 offset = vec2(float(x), float(y)) * texel;
            float weight = 1.0 / (1.0 + float(x * x + y * y));
            bloom += brightPass(texture(uTexture, vTextureCoord + offset).rgb) * weight;
            total += weight;
        }
    }
    bloom /= max(total, 0.0001);

    finalColor = vec4(base.rgb + bloom * uIntensity, base.a);
}
`;

export const glowEffect: EffectDef = {
  effect: "glow",
  displayName: "Glow",
  category: "stylize",
  schema: {
    props: z.object({
      threshold: z.number().min(0).max(1).default(0.6),
      intensity: z.number().min(0).default(0.5),
      radius: z.number().min(0).default(4),
    }),
    channels: [
      { path: "props.threshold", type: "scalar", label: "Threshold", default: 0.6 },
      { path: "props.intensity", type: "scalar", label: "Intensity", default: 0.5 },
      { path: "props.radius", type: "scalar", label: "Radius", default: 4 },
    ],
    inspector: [
      { path: "props.threshold", label: "Threshold", control: "number" },
      { path: "props.intensity", label: "Intensity", control: "number" },
      { path: "props.radius", label: "Radius", control: "number" },
    ],
  },
  glsl: FRAGMENT,
};
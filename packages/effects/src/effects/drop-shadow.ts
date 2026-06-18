// packages/effects/src/effects/drop-shadow.ts
//
// Drop shadow: samples the source's alpha at an offset position to build
// a soft silhouette (via a small blur ring, same cheap approximation
// glow.ts uses), tinted `uColor` and faded by `uOpacity`, composited
// BEHIND the original (the original is drawn on top, unshifted).

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec2 uOffset;
uniform float uBlur;
uniform float uOpacity;
uniform vec3 uColor;

void main(void) {
    vec2 texel = 1.0 / uInputSize.xy;
    vec2 shadowUv = vTextureCoord - uOffset * texel;

    float shadowAlpha = 0.0;
    float total = 0.0;
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            vec2 sampleOffset = vec2(float(x), float(y)) * uBlur * texel;
            float weight = 1.0 / (1.0 + float(x * x + y * y));
            shadowAlpha += texture(uTexture, shadowUv + sampleOffset).a * weight;
            total += weight;
        }
    }
    shadowAlpha = (shadowAlpha / max(total, 0.0001)) * uOpacity;

    vec4 source = texture(uTexture, vTextureCoord);
    vec3 shadowColor = uColor * shadowAlpha;
    // composite source OVER the shadow — source's own alpha wins where it's opaque.
    vec3 outColor = shadowColor * (1.0 - source.a) + source.rgb * source.a;
    float outAlpha = shadowAlpha * (1.0 - source.a) + source.a;
    finalColor = vec4(outColor, outAlpha);
}
`;

export const dropShadowEffect: EffectDef = {
  effect: "drop-shadow",
  displayName: "Drop Shadow",
  category: "stylize",
  schema: {
    props: z.object({
      offsetX: z.number().default(4),
      offsetY: z.number().default(4),
      blur: z.number().min(0).default(4),
      opacity: z.number().min(0).max(1).default(0.5),
      color: z.object({ l: z.number(), c: z.number(), h: z.number(), alpha: z.number().optional() }).default({ l: 0, c: 0, h: 0 }),
    }),
    channels: [
      { path: "props.offsetX", type: "scalar", label: "Offset X", default: 4 },
      { path: "props.offsetY", type: "scalar", label: "Offset Y", default: 4 },
      { path: "props.blur", type: "scalar", label: "Blur", default: 4 },
      { path: "props.opacity", type: "scalar", label: "Opacity", default: 0.5 },
      { path: "props.color", type: "color", label: "Color", default: { l: 0, c: 0, h: 0 } },
    ],
    inspector: [
      { path: "props.offsetX", label: "Offset X", control: "number" },
      { path: "props.offsetY", label: "Offset Y", control: "number" },
      { path: "props.blur", label: "Blur", control: "number" },
      { path: "props.opacity", label: "Opacity", control: "number" },
      { path: "props.color", label: "Color", control: "color" },
    ],
  },
  glsl: FRAGMENT,
};
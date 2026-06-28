// packages/effects/src/effects/halation.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uThreshold;
uniform float uRadius;
uniform float uIntensity;
uniform vec3  uColor;

// 13-tap radial blur approximation for the halation spread.
vec3 glowBlur(vec2 uv, float r) {
    vec2  px  = r / uInputSize.xy;
    vec3  acc = texture(uTexture, uv).rgb;
    float w   = 1.0;
    for (int i = 0; i < 6; i++) {
        float a = float(i) * 1.0472; // 60-degree steps
        vec2  d = vec2(cos(a), sin(a)) * px * 0.5;
        acc += texture(uTexture, uv + d).rgb; w += 1.0;
    }
    for (int i = 0; i < 6; i++) {
        float a = (float(i) + 0.5) * 1.0472;
        vec2  d = vec2(cos(a), sin(a)) * px;
        acc += texture(uTexture, uv + d).rgb; w += 1.0;
    }
    return acc / w;
}

void main(void) {
    vec4  src     = texture(uTexture, vTextureCoord);
    vec3  blurred = glowBlur(vTextureCoord, uRadius);
    float blurLum = dot(blurred, vec3(0.2126, 0.7152, 0.0722));
    float halo    = max(blurLum - uThreshold, 0.0) / (1.0 - uThreshold + 0.001);
    // Screen blend so the halo never clips to pure white
    vec3  halation = uColor * halo * uIntensity;
    vec3  result   = src.rgb + halation * (1.0 - src.rgb);
    finalColor = vec4(result, src.a);
}
`;

export const halationEffect: EffectDef = {
  effect: "halation",
  displayName: "Halation",
  category: "stylize",
  schema: {
    props: z.object({
      threshold: z.number().min(0).max(1).default(0.65),
      radius:    z.number().min(0).max(40).default(12),
      intensity: z.number().min(0).max(2).default(0.6),
      color:     z.object({ l: z.number(), c: z.number(), h: z.number(), alpha: z.number().optional() })
                   .default({ l: 0.55, c: 0.18, h: 30 }), // warm red in OKLCH
    }),
    channels: [
      { path: "props.threshold", type: "scalar", label: "Threshold", default: 0.65 },
      { path: "props.radius",    type: "scalar", label: "Radius",    default: 12   },
      { path: "props.intensity", type: "scalar", label: "Intensity", default: 0.6  },
      { path: "props.color",     type: "color",  label: "Color",     default: { l: 0.55, c: 0.18, h: 30 } },
    ],
    inspector: [
      { path: "props.threshold", label: "Threshold", control: "number", min: 0, max: 1,  step: 0.01 },
      { path: "props.radius",    label: "Radius",    control: "number", min: 0, max: 40, step: 0.5  },
      { path: "props.intensity", label: "Intensity", control: "number", min: 0, max: 2,  step: 0.01 },
      { path: "props.color",     label: "Color",     control: "color"                                },
    ],
  },
  glsl: FRAGMENT,
};

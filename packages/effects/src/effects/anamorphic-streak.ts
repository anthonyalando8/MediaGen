// packages/effects/src/effects/anamorphic-streak.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uThreshold;
uniform float uLength;
uniform float uIntensity;
uniform float uVertical;
uniform vec3  uTint;

// Accumulate bright pixels along one axis with exponential falloff.
// 24 taps fully unrolled to avoid dynamic array indexing (ES1 compat).
float streakLum(vec2 uv) {
    vec2  step_ = (uVertical < 0.5)
                  ? vec2(1.0 / uInputSize.x, 0.0)
                  : vec2(0.0, 1.0 / uInputSize.y);
    float acc  = 0.0;
    float wSum = 0.0;
    // Macro for each tap to keep code manageable under loop-unroll constraint
    #define TAP(T) { float w = exp(-(T) * 4.0); vec2 off = step_ * ((T) * uLength); \
        float lP = dot(texture(uTexture, uv + off).rgb, vec3(0.2126,0.7152,0.0722)); \
        float lN = dot(texture(uTexture, uv - off).rgb, vec3(0.2126,0.7152,0.0722)); \
        acc += (max(lP - uThreshold, 0.0) + max(lN - uThreshold, 0.0)) * w; wSum += w; }
    TAP(0.0417) TAP(0.0833) TAP(0.1250) TAP(0.1667)
    TAP(0.2083) TAP(0.2500) TAP(0.2917) TAP(0.3333)
    TAP(0.3750) TAP(0.4167) TAP(0.4583) TAP(0.5000)
    TAP(0.5417) TAP(0.5833) TAP(0.6250) TAP(0.6667)
    TAP(0.7083) TAP(0.7500) TAP(0.7917) TAP(0.8333)
    TAP(0.8750) TAP(0.9167) TAP(0.9583) TAP(1.0000)
    #undef TAP
    return acc / max(wSum, 0.0001);
}

void main(void) {
    vec4  src    = texture(uTexture, vTextureCoord);
    float streak = streakLum(vTextureCoord) * uIntensity;
    finalColor = vec4(src.rgb + uTint * streak, src.a);
}
`;

export const anamorphicStreakEffect: EffectDef = {
  effect: "anamorphic-streak",
  displayName: "Anamorphic Streak",
  category: "stylize",
  schema: {
    props: z.object({
      threshold: z.number().min(0).max(1).default(0.75),
      length:    z.number().min(0).max(200).default(80),
      intensity: z.number().min(0).max(3).default(1.2),
      vertical:  z.number().min(0).max(1).default(0),
      tint:      z.object({ l: z.number(), c: z.number(), h: z.number(), alpha: z.number().optional() })
                   .default({ l: 0.65, c: 0.12, h: 230 }), // cool blue in OKLCH
    }),
    channels: [
      { path: "props.threshold", type: "scalar", label: "Threshold", default: 0.75 },
      { path: "props.length",    type: "scalar", label: "Length",    default: 80   },
      { path: "props.intensity", type: "scalar", label: "Intensity", default: 1.2  },
      { path: "props.vertical",  type: "scalar", label: "Vertical",  default: 0    },
      { path: "props.tint",      type: "color",  label: "Tint",      default: { l: 0.65, c: 0.12, h: 230 } },
    ],
    inspector: [
      { path: "props.threshold", label: "Threshold", control: "number", min: 0, max: 1,   step: 0.01 },
      { path: "props.length",    label: "Length",    control: "number", min: 0, max: 200,  step: 1    },
      { path: "props.intensity", label: "Intensity", control: "number", min: 0, max: 3,   step: 0.01 },
      { path: "props.vertical",  label: "Vertical",  control: "toggle"                                },
      { path: "props.tint",      label: "Tint",      control: "color"                                 },
    ],
  },
  glsl: FRAGMENT,
};

// packages/effects/src/effects/motion-blur.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uAngle;
uniform float uDistance;
uniform float uSamples;
uniform float uFalloff;

void main(void) {
    float rad = uAngle * 0.01745329;
    vec2  dir = vec2(cos(rad), sin(rad)) * (uDistance / uInputSize.xy);

    vec4  acc  = vec4(0.0);
    float wSum = 0.0;
    int   n    = int(clamp(uSamples, 2.0, 16.0));

    // Fully unrolled 16-tap accumulation — avoids dynamic loop indexing issues.
    #define MBTAP(I) if ((I) < n) { \
        float t = float(I) / max(float(n) - 1.0, 1.0); \
        float w = mix(1.0, pow(1.0 - t, 2.0), uFalloff); \
        acc += texture(uTexture, vTextureCoord - dir * t) * w; \
        wSum += w; }
    MBTAP(0)  MBTAP(1)  MBTAP(2)  MBTAP(3)
    MBTAP(4)  MBTAP(5)  MBTAP(6)  MBTAP(7)
    MBTAP(8)  MBTAP(9)  MBTAP(10) MBTAP(11)
    MBTAP(12) MBTAP(13) MBTAP(14) MBTAP(15)
    #undef MBTAP

    finalColor = acc / max(wSum, 0.0001);
}
`;

export const motionBlurEffect: EffectDef = {
  effect: "motion-blur",
  displayName: "Motion Blur",
  category: "stylize",
  schema: {
    props: z.object({
      angle:    z.number().min(0).max(360).default(0),
      distance: z.number().min(0).max(60).default(20),
      samples:  z.number().int().min(2).max(16).default(8),
      falloff:  z.number().min(0).max(1).default(0.5),
    }),
    channels: [
      { path: "props.angle",    type: "scalar", label: "Angle",    default: 0   },
      { path: "props.distance", type: "scalar", label: "Distance", default: 20  },
      { path: "props.samples",  type: "scalar", label: "Samples",  default: 8   },
      { path: "props.falloff",  type: "scalar", label: "Falloff",  default: 0.5 },
    ],
    inspector: [
      { path: "props.angle",    label: "Angle",    control: "number", min: 0,   max: 360, step: 1    },
      { path: "props.distance", label: "Distance", control: "number", min: 0,   max: 60,  step: 0.5  },
      { path: "props.samples",  label: "Samples",  control: "number", min: 2,   max: 16,  step: 1    },
      { path: "props.falloff",  label: "Falloff",  control: "number", min: 0,   max: 1,   step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

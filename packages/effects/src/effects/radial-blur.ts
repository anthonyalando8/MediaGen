// packages/effects/src/effects/radial-blur.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uCenterX;
uniform float uCenterY;
uniform float uStrength;
uniform float uSamples;
uniform float uSpin;

void main(void) {
    vec2  center = vec2(uCenterX, 1.0 - uCenterY); // flip Y for GL texture coords
    vec2  dir    = vTextureCoord - center;
    int   n      = int(clamp(uSamples, 2.0, 16.0));
    vec4  acc    = vec4(0.0);

    // Fully unrolled 16-tap accumulation.
    #define RBTAP(I) if ((I) < n) { \
        float t = float(I) / max(float(n) - 1.0, 1.0); \
        vec2  zoomOff = dir * (t * uStrength); \
        float angle   = t * uStrength * uSpin * 3.14159; \
        float cosA = cos(angle); float sinA = sin(angle); \
        vec2  spun = vec2(dir.x * cosA - dir.y * sinA, dir.x * sinA + dir.y * cosA) - dir; \
        acc += texture(uTexture, clamp(vTextureCoord - zoomOff + spun, 0.0, 1.0)); }
    RBTAP(0)  RBTAP(1)  RBTAP(2)  RBTAP(3)
    RBTAP(4)  RBTAP(5)  RBTAP(6)  RBTAP(7)
    RBTAP(8)  RBTAP(9)  RBTAP(10) RBTAP(11)
    RBTAP(12) RBTAP(13) RBTAP(14) RBTAP(15)
    #undef RBTAP

    finalColor = acc / float(n);
}
`;

export const radialBlurEffect: EffectDef = {
  effect: "radial-blur",
  displayName: "Radial Blur",
  category: "stylize",
  schema: {
    props: z.object({
      centerX:  z.number().min(0).max(1).default(0.5),
      centerY:  z.number().min(0).max(1).default(0.5),
      strength: z.number().min(0).max(0.1).default(0.02),
      samples:  z.number().int().min(2).max(16).default(10),
      spin:     z.number().min(0).max(1).default(0),
    }),
    channels: [
      { path: "props.centerX",  type: "scalar", label: "Center X",  default: 0.5  },
      { path: "props.centerY",  type: "scalar", label: "Center Y",  default: 0.5  },
      { path: "props.strength", type: "scalar", label: "Strength",  default: 0.02 },
      { path: "props.samples",  type: "scalar", label: "Samples",   default: 10   },
      { path: "props.spin",     type: "scalar", label: "Spin",      default: 0    },
    ],
    inspector: [
      { path: "props.centerX",  label: "Center X",  control: "number", min: 0, max: 1,    step: 0.01  },
      { path: "props.centerY",  label: "Center Y",  control: "number", min: 0, max: 1,    step: 0.01  },
      { path: "props.strength", label: "Strength",  control: "number", min: 0, max: 0.1,  step: 0.001 },
      { path: "props.samples",  label: "Samples",   control: "number", min: 2, max: 16,   step: 1     },
      { path: "props.spin",     label: "Spin",      control: "number", min: 0, max: 1,    step: 0.01  },
    ],
  },
  glsl: FRAGMENT,
};

// packages/effects/src/effects/day-for-night.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uExposure;
uniform float uCoolness;
uniform float uDesaturate;
uniform float uShadowLift;

void main(void) {
    vec4  src = texture(uTexture, vTextureCoord);
    vec3  col = src.rgb;
    // 1. Crush exposure
    col *= pow(0.5, uExposure);
    // 2. Cool blue shift
    col.r *= (1.0 - uCoolness * 0.35);
    col.g *= (1.0 - uCoolness * 0.15);
    col.b  = col.b + (1.0 - col.b) * uCoolness * 0.25;
    // 3. Partial desaturation
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(lum), uDesaturate);
    // 4. Shadow lift
    col = col + uShadowLift * (1.0 - col) * (1.0 - col);
    finalColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
`;

export const dayForNightEffect: EffectDef = {
  effect: "day-for-night",
  displayName: "Day for Night",
  category: "color",
  schema: {
    props: z.object({
      exposure:   z.number().min(0).max(3).default(1.5),
      coolness:   z.number().min(0).max(1).default(0.4),
      desaturate: z.number().min(0).max(1).default(0.5),
      shadowLift: z.number().min(0).max(0.2).default(0.04),
    }),
    channels: [
      { path: "props.exposure",   type: "scalar", label: "Exposure",    default: 1.5  },
      { path: "props.coolness",   type: "scalar", label: "Coolness",    default: 0.4  },
      { path: "props.desaturate", type: "scalar", label: "Desaturate",  default: 0.5  },
      { path: "props.shadowLift", type: "scalar", label: "Shadow Lift", default: 0.04 },
    ],
    inspector: [
      { path: "props.exposure",   label: "Exposure",    control: "number", min: 0, max: 3,   step: 0.05  },
      { path: "props.coolness",   label: "Coolness",    control: "number", min: 0, max: 1,   step: 0.01  },
      { path: "props.desaturate", label: "Desaturate",  control: "number", min: 0, max: 1,   step: 0.01  },
      { path: "props.shadowLift", label: "Shadow Lift", control: "number", min: 0, max: 0.2, step: 0.005 },
    ],
  },
  glsl: FRAGMENT,
};

// packages/effects/src/effects/letterbox.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uSize;
uniform float uSoftness;
uniform vec3  uColor;
uniform float uOpacity;

void main(void) {
    vec4  src        = texture(uTexture, vTextureCoord);
    float topMask    = smoothstep(uSize, uSize - uSoftness, vTextureCoord.y);
    float bottomMask = smoothstep(1.0 - uSize, 1.0 - uSize + uSoftness, vTextureCoord.y);
    float barMask    = clamp(topMask + bottomMask, 0.0, 1.0) * uOpacity;
    vec3  result     = mix(src.rgb, uColor, barMask);
    finalColor = vec4(result, src.a);
}
`;

export const letterboxEffect: EffectDef = {
  effect: "letterbox",
  displayName: "Letterbox",
  category: "stylize",
  schema: {
    props: z.object({
      size:     z.number().min(0).max(0.3).default(0.12),
      softness: z.number().min(0).max(0.05).default(0.005),
      color:    z.object({ l: z.number(), c: z.number(), h: z.number(), alpha: z.number().optional() })
                  .default({ l: 0, c: 0, h: 0 }),
      opacity:  z.number().min(0).max(1).default(1),
    }),
    channels: [
      { path: "props.size",     type: "scalar", label: "Size",     default: 0.12  },
      { path: "props.softness", type: "scalar", label: "Softness", default: 0.005 },
      { path: "props.color",    type: "color",  label: "Color",    default: { l: 0, c: 0, h: 0 } },
      { path: "props.opacity",  type: "scalar", label: "Opacity",  default: 1     },
    ],
    inspector: [
      { path: "props.size",     label: "Size",     control: "number", min: 0, max: 0.3,  step: 0.001 },
      { path: "props.softness", label: "Softness", control: "number", min: 0, max: 0.05, step: 0.001 },
      { path: "props.color",    label: "Color",    control: "color"                                    },
      { path: "props.opacity",  label: "Opacity",  control: "number", min: 0, max: 1,    step: 0.01  },
    ],
  },
  glsl: FRAGMENT,
};

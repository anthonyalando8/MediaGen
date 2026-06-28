// packages/effects/src/effects/vignette.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uRadius;
uniform float uSoftness;
uniform float uAmount;

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    vec2 centered = vTextureCoord - 0.5;
    // Normalize so 1.0 = corner distance (sqrt(0.5^2+0.5^2) = 0.7071)
    float dist = length(centered) / 0.7071;
    // Vignette mask: 0 at centre, 1 at edges beyond radius
    float vignette = smoothstep(uRadius, uRadius + uSoftness, dist);
    color.rgb = mix(color.rgb, color.rgb * (1.0 - uAmount), vignette);
    finalColor = color;
}
`;

export const vignetteEffect: EffectDef = {
  effect: "vignette",
  displayName: "Vignette",
  category: "color",
  schema: {
    props: z.object({
      radius:   z.number().min(0).max(1).default(0.75),
      softness: z.number().min(0).max(1).default(0.45),
      amount:   z.number().min(0).max(1).default(0.5),
    }),
    channels: [
      { path: "props.radius",   type: "scalar", label: "Radius",   default: 0.75 },
      { path: "props.softness", type: "scalar", label: "Softness", default: 0.45 },
      { path: "props.amount",   type: "scalar", label: "Amount",   default: 0.5  },
    ],
    inspector: [
      { path: "props.radius",   label: "Radius",   control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.softness", label: "Softness", control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.amount",   label: "Amount",   control: "number", min: 0, max: 1, step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

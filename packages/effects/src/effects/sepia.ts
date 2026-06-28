// packages/effects/src/effects/sepia.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAmount;

void main(void) {
    vec4 col = texture(uTexture, vTextureCoord);
    vec3 sepia = vec3(
        dot(col.rgb, vec3(0.393, 0.769, 0.189)),
        dot(col.rgb, vec3(0.349, 0.686, 0.168)),
        dot(col.rgb, vec3(0.272, 0.534, 0.131))
    );
    finalColor = vec4(mix(col.rgb, sepia, uAmount), col.a);
}
`;

export const sepiaEffect: EffectDef = {
  effect: "sepia",
  displayName: "Sepia",
  category: "color",
  schema: {
    props: z.object({
      amount: z.number().min(0).max(1).default(0.8),
    }),
    channels: [{ path: "props.amount", type: "scalar", label: "Amount", default: 0.8 }],
    inspector: [
      { path: "props.amount", label: "Amount", control: "number", min: 0, max: 1, step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

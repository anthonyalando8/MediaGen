// packages/effects/src/effects/curves.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uRedSlope;
uniform float uGreenSlope;
uniform float uBlueSlope;

void main(void) {
    vec4 col = texture(uTexture, vTextureCoord);
    // Power curve per channel (slope=1 = no change)
    col.r = pow(col.r, 1.0 / max(uRedSlope,   0.001));
    col.g = pow(col.g, 1.0 / max(uGreenSlope, 0.001));
    col.b = pow(col.b, 1.0 / max(uBlueSlope,  0.001));
    finalColor = col;
}
`;

export const curvesEffect: EffectDef = {
  effect: "curves",
  displayName: "Curves",
  category: "color",
  schema: {
    props: z.object({
      redSlope:   z.number().min(0).max(2).default(1),
      greenSlope: z.number().min(0).max(2).default(1),
      blueSlope:  z.number().min(0).max(2).default(1),
    }),
    channels: [
      { path: "props.redSlope",   type: "scalar", label: "Red",   default: 1 },
      { path: "props.greenSlope", type: "scalar", label: "Green", default: 1 },
      { path: "props.blueSlope",  type: "scalar", label: "Blue",  default: 1 },
    ],
    inspector: [
      { path: "props.redSlope",   label: "Red",   control: "number", min: 0, max: 2, step: 0.01 },
      { path: "props.greenSlope", label: "Green", control: "number", min: 0, max: 2, step: 0.01 },
      { path: "props.blueSlope",  label: "Blue",  control: "number", min: 0, max: 2, step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

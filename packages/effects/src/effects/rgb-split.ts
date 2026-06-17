// packages/effects/src/effects/rgb-split.ts
//
// Chromatic-aberration-style RGB split: offsets the red and blue channels
// in opposite directions by `uAmount`, leaving green centered — the
// classic "glitch"/VHS look.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uAmount;
uniform float uAngle;

void main(void) {
    vec2 direction = vec2(cos(uAngle), sin(uAngle));
    vec2 offset = direction * (uAmount / uInputSize.xy);

    float r = texture(uTexture, vTextureCoord + offset).r;
    float g = texture(uTexture, vTextureCoord).g;
    float b = texture(uTexture, vTextureCoord - offset).b;
    float a = texture(uTexture, vTextureCoord).a;

    finalColor = vec4(r, g, b, a);
}
`;

export const rgbSplitEffect: EffectDef = {
  effect: "rgb-split",
  displayName: "RGB Split",
  category: "distort",
  schema: {
    props: z.object({
      amount: z.number().min(0).default(0),
      angle: z.number().default(0),
    }),
    channels: [
      { path: "props.amount", type: "scalar", label: "Amount", default: 0 },
      { path: "props.angle", type: "angle", label: "Angle", default: 0 },
    ],
    inspector: [
      { path: "props.amount", label: "Amount", control: "number" },
      { path: "props.angle", label: "Angle", control: "number" },
    ],
  },
  glsl: FRAGMENT,
};
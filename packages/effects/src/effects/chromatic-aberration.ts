// packages/effects/src/effects/chromatic-aberration.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uAmount;

void main(void) {
    float off = uAmount / uInputSize.x;
    float r = texture(uTexture, vTextureCoord + vec2( off, 0.0)).r;
    float g = texture(uTexture, vTextureCoord).g;
    float b = texture(uTexture, vTextureCoord - vec2( off, 0.0)).b;
    float a = texture(uTexture, vTextureCoord).a;
    finalColor = vec4(r, g, b, a);
}
`;

export const chromaticAberrationEffect: EffectDef = {
  effect: "chromatic-aberration",
  displayName: "Chromatic Aberration",
  category: "distort",
  schema: {
    props: z.object({
      amount: z.number().min(0).max(20).default(2),
    }),
    channels: [{ path: "props.amount", type: "scalar", label: "Amount", default: 2 }],
    inspector: [
      { path: "props.amount", label: "Amount", control: "number", min: 0, max: 20, step: 0.1 },
    ],
  },
  glsl: FRAGMENT,
};

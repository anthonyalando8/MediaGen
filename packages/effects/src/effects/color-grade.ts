// packages/effects/src/effects/color-grade.ts
//
// Per-channel lift/gamma/gain using the same ColorOKLCH-as-triple approach
// as grade.ts: the picker controls l/c/h which are used as independent r/g/b
// numeric channels in the shader, not as OKLCH colour values.
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;

void main(void) {
    vec4 col = texture(uTexture, vTextureCoord);
    // Lift: additive shadow offset
    vec3 graded = clamp(col.rgb + uLift, 0.0, 1.0);
    // Gain: multiplicative highlight scale
    graded = clamp(graded * uGain, 0.0, 1.0);
    // Gamma: power curve
    graded = pow(graded, 1.0 / max(uGamma, vec3(0.001)));
    finalColor = vec4(graded, col.a);
}
`;

const colorTriple = z.object({
  l: z.number(), c: z.number(), h: z.number(),
  alpha: z.number().optional(),
});

export const colorGradeEffect: EffectDef = {
  effect: "color-grade",
  displayName: "Color Grade",
  category: "color",
  schema: {
    props: z.object({
      lift:  colorTriple.default({ l: 0, c: 0, h: 0 }),
      gamma: colorTriple.default({ l: 1, c: 1, h: 1 }),
      gain:  colorTriple.default({ l: 1, c: 1, h: 1 }),
    }),
    channels: [
      { path: "props.lift",  type: "color", label: "Lift",  default: { l: 0, c: 0, h: 0 } },
      { path: "props.gamma", type: "color", label: "Gamma", default: { l: 1, c: 1, h: 1 } },
      { path: "props.gain",  type: "color", label: "Gain",  default: { l: 1, c: 1, h: 1 } },
    ],
    inspector: [
      { path: "props.lift",  label: "Lift",  control: "color" },
      { path: "props.gamma", label: "Gamma", control: "color" },
      { path: "props.gain",  label: "Gain",  control: "color" },
    ],
  },
  glsl: FRAGMENT,
};

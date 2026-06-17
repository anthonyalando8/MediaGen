// packages/effects/src/effects/grade.ts
//
// Standard lift/gamma/gain color grade: lift biases blacks (additive),
// gain scales whites (multiplicative), gamma reshapes the midtone curve
// (power). Each is a per-channel triple for color casts, not just
// brightness.
//
// `EffectRef.props` is `Record<string, Scalar>` (core/types/node.ts) —
// `Scalar` only permits string | number | boolean | ColorOKLCH, so a
// structured 3-component value has to be `ColorOKLCH`, the one
// already-supported structured type (and the one the inspector already
// has a "color" control for). This is a parameter-shape reuse, not a
// claim that lift/gamma/gain are OKLCH colors — the shader below reads
// `.l`/`.c`/`.h` purely as three independent numeric channels (mapped to
// the shader's r/g/b uniforms 1:1), same as `ColorOKLCHSchema`'s `l: z.number()`
// etc. impose no [0,1]-lightness constraint that would make this wrong.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    vec3 graded = color.rgb;
    // lift: additive, biases blacks without affecting white point.
    graded = graded + uLift * (1.0 - graded);
    // gamma: power curve on the midtones — guard against pow(<0, ...).
    graded = pow(clamp(graded, 0.0, 1.0), 1.0 / max(uGamma, vec3(0.001)));
    // gain: multiplicative, scales whites.
    graded = graded * uGain;
    finalColor = vec4(clamp(graded, 0.0, 1.0), color.a);
}
`;

const colorTriple = z.object({ l: z.number(), c: z.number(), h: z.number(), alpha: z.number().optional() });

export const gradeEffect: EffectDef = {
  effect: "grade",
  displayName: "Color Grade",
  category: "color",
  schema: {
    props: z.object({
      lift: colorTriple.default({ l: 0, c: 0, h: 0 }),
      gamma: colorTriple.default({ l: 1, c: 1, h: 1 }),
      gain: colorTriple.default({ l: 1, c: 1, h: 1 }),
    }),
    channels: [
      { path: "props.lift", type: "color", label: "Lift", default: { l: 0, c: 0, h: 0 } },
      { path: "props.gamma", type: "color", label: "Gamma", default: { l: 1, c: 1, h: 1 } },
      { path: "props.gain", type: "color", label: "Gain", default: { l: 1, c: 1, h: 1 } },
    ],
    inspector: [
      { path: "props.lift", label: "Lift", control: "color" },
      { path: "props.gamma", label: "Gamma", control: "color" },
      { path: "props.gain", label: "Gain", control: "color" },
    ],
  },
  glsl: FRAGMENT,
};
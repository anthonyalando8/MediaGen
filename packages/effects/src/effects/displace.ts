// packages/effects/src/effects/displace.ts
//
// Procedural sine-wave displacement (not a displacement-MAP effect, which
// would need a second texture input — out of scope for this single-input
// pass model in Phase 2). Distorts UV coordinates by a sine wave along
// each axis; animation comes from keyframing `props.phase`, not a
// built-in clock, keeping the shader itself a pure function of its
// uniforms (no hidden per-frame state — same determinism guarantee the
// Evaluator already requires).

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uPhase;

void main(void) {
    vec2 uv = vTextureCoord;
    uv.x += sin(uv.y * uFrequency + uPhase) * uAmplitude;
    uv.y += sin(uv.x * uFrequency + uPhase) * uAmplitude;
    finalColor = texture(uTexture, uv);
}
`;

export const displaceEffect: EffectDef = {
  effect: "displace",
  displayName: "Displace",
  category: "distort",
  schema: {
    props: z.object({
      amplitude: z.number().min(0).default(0),
      frequency: z.number().default(10),
      phase: z.number().default(0),
    }),
    channels: [
      { path: "props.amplitude", type: "scalar", label: "Amplitude", default: 0 },
      { path: "props.frequency", type: "scalar", label: "Frequency", default: 10 },
      { path: "props.phase", type: "scalar", label: "Phase", default: 0 },
    ],
    inspector: [
      { path: "props.amplitude", label: "Amplitude", control: "number" },
      { path: "props.frequency", label: "Frequency", control: "number" },
      { path: "props.phase", label: "Phase", control: "number" },
    ],
  },
  glsl: FRAGMENT,
};
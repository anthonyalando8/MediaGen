// packages/effects/src/effects/levels.ts
//
// Levels: remaps [inBlack, inWhite] -> [0,1] (clamped), applies a gamma
// curve, then remaps [0,1] -> [outBlack, outWhite] — the classic
// Photoshop/AE "Levels" model. A full spline-based "Curves" control is a
// UI-layer enhancement on top of these same uniforms (the curve editor,
// §9, P2 Week 9) rather than a different shader.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uInBlack;
uniform float uInWhite;
uniform float uGamma;
uniform float uOutBlack;
uniform float uOutWhite;

float remap(float v) {
    float t = clamp((v - uInBlack) / max(uInWhite - uInBlack, 0.0001), 0.0, 1.0);
    t = pow(t, 1.0 / max(uGamma, 0.001));
    return mix(uOutBlack, uOutWhite, t);
}

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    finalColor = vec4(remap(color.r), remap(color.g), remap(color.b), color.a);
}
`;

export const levelsEffect: EffectDef = {
  effect: "levels",
  displayName: "Levels",
  category: "color",
  schema: {
    props: z.object({
      inBlack: z.number().min(0).max(1).default(0),
      inWhite: z.number().min(0).max(1).default(1),
      gamma: z.number().min(0).default(1),
      outBlack: z.number().min(0).max(1).default(0),
      outWhite: z.number().min(0).max(1).default(1),
    }),
    channels: [
      { path: "props.inBlack", type: "scalar", label: "Input Black", default: 0 },
      { path: "props.inWhite", type: "scalar", label: "Input White", default: 1 },
      { path: "props.gamma", type: "scalar", label: "Gamma", default: 1 },
      { path: "props.outBlack", type: "scalar", label: "Output Black", default: 0 },
      { path: "props.outWhite", type: "scalar", label: "Output White", default: 1 },
    ],
    inspector: [
      { path: "props.inBlack", label: "Input Black", control: "number" },
      { path: "props.inWhite", label: "Input White", control: "number" },
      { path: "props.gamma", label: "Gamma", control: "number" },
      { path: "props.outBlack", label: "Output Black", control: "number" },
      { path: "props.outWhite", label: "Output White", control: "number" },
    ],
  },
  glsl: FRAGMENT,
};
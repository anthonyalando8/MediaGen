// packages/effects/src/effects/film-grain.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAmount;
uniform float uSeed;

// Hash-based pseudo-random: seed offset uses vec2(uSeed) to avoid vec2+float mismatch.
float rand(vec2 uv) {
    return fract(sin(dot(uv + vec2(uSeed), vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    float noise = (rand(vTextureCoord) - 0.5) * 2.0; // -1 .. +1
    color.rgb = mix(color.rgb, color.rgb + noise, uAmount);
    finalColor = color;
}
`;

export const filmGrainEffect: EffectDef = {
  effect: "film-grain",
  displayName: "Film Grain",
  category: "stylize",
  schema: {
    props: z.object({
      amount: z.number().min(0).max(1).default(0.05),
      seed:   z.number().default(0),
    }),
    channels: [
      { path: "props.amount", type: "scalar", label: "Amount", default: 0.05 },
      { path: "props.seed",   type: "scalar", label: "Seed",   default: 0    },
    ],
    inspector: [
      { path: "props.amount", label: "Amount", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.seed",   label: "Seed",   control: "number", min: 0, max: 1000, step: 1    },
    ],
  },
  glsl: FRAGMENT,
};

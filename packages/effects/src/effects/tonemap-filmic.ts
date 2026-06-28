// packages/effects/src/effects/tonemap-filmic.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uExposure;
uniform float uGamma;

// Hable filmic tone-mapping operator (simplified Uncharted 2 curve).
vec3 hable(vec3 x) {
    const float A = 0.15;
    const float B = 0.50;
    const float C = 0.10;
    const float D = 0.20;
    const float E = 0.02;
    const float F = 0.30;
    return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

void main(void) {
    vec4  src = texture(uTexture, vTextureCoord);
    vec3  col = src.rgb * uExposure;
    // Normalise by the white point (W = 11.2 is the standard Uncharted value)
    vec3  whiteScale = 1.0 / hable(vec3(11.2));
    col = hable(col) * whiteScale;
    col = pow(max(col, vec3(0.0)), vec3(1.0 / max(uGamma, 0.001)));
    finalColor = vec4(col, src.a);
}
`;

export const tonemapFilmicEffect: EffectDef = {
  effect: "tonemap-filmic",
  displayName: "Filmic Tone-Map",
  category: "color",
  schema: {
    props: z.object({
      exposure: z.number().min(0).max(5).default(1),
      gamma:    z.number().min(0.1).max(3).default(2.2),
    }),
    channels: [
      { path: "props.exposure", type: "scalar", label: "Exposure", default: 1   },
      { path: "props.gamma",    type: "scalar", label: "Gamma",    default: 2.2 },
    ],
    inspector: [
      { path: "props.exposure", label: "Exposure", control: "number", min: 0,   max: 5, step: 0.1  },
      { path: "props.gamma",    label: "Gamma",    control: "number", min: 0.1, max: 3, step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

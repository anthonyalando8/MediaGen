// packages/effects/src/effects/bleach-bypass.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uStrength;
uniform float uContrast;
uniform float uShadows;

void main(void) {
    vec4  src  = texture(uTexture, vTextureCoord);
    float lum  = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3  grey = vec3(lum);
    // Screen blend between colour and greyscale to reduce saturation
    vec3  screen = 1.0 - (1.0 - src.rgb) * (1.0 - grey);
    vec3  bypass = mix(src.rgb, screen, uStrength);
    // Contrast: pivot around mid-grey (0.5)
    bypass = (bypass - 0.5) * uContrast + 0.5;
    // Shadow crush/lift
    bypass = bypass + uShadows * (1.0 - bypass) * (1.0 - bypass);
    finalColor = vec4(clamp(bypass, 0.0, 1.0), src.a);
}
`;

export const bleachBypassEffect: EffectDef = {
  effect: "bleach-bypass",
  displayName: "Bleach Bypass",
  category: "color",
  schema: {
    props: z.object({
      strength: z.number().min(0).max(1).default(0.7),
      contrast: z.number().min(0.5).max(2).default(1.2),
      shadows:  z.number().min(-1).max(1).default(-0.05),
    }),
    channels: [
      { path: "props.strength", type: "scalar", label: "Strength", default: 0.7   },
      { path: "props.contrast", type: "scalar", label: "Contrast", default: 1.2   },
      { path: "props.shadows",  type: "scalar", label: "Shadows",  default: -0.05 },
    ],
    inspector: [
      { path: "props.strength", label: "Strength", control: "number", min: 0,   max: 1,  step: 0.01 },
      { path: "props.contrast", label: "Contrast", control: "number", min: 0.5, max: 2,  step: 0.01 },
      { path: "props.shadows",  label: "Shadows",  control: "number", min: -1,  max: 1,  step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

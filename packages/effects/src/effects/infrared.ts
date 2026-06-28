// packages/effects/src/effects/infrared.ts
//
// Infrared — simulates the look of infrared film photography:
//   - Foliage/vegetation (high green reflectance) glows bright white
//   - Sky (absorbs IR) goes dark, almost black
//   - Skin tones become warm and slightly luminous
//   - High contrast between channel inversions
//
// Achieved by: channel swap (R↔G contribution), partial channel inversion
// in the blue range (sky-darkening), contrast boost, and a warm highlight
// tint.
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uStrength;
uniform float uContrast;
uniform float uGlow;

void main(void) {
    vec4  src = texture(uTexture, vTextureCoord);
    vec3  col = src.rgb;

    // Swap channels to simulate the IR response:
    //   IR film reads: high red, swapped green (the bright-foliage channel)
    float r = col.g;                    // green → red: foliage goes bright
    float g = col.g * 0.8 + col.r * 0.2; // slightly warm
    float b = 1.0 - col.b * 1.2;       // invert blue → dark sky
    vec3  ir = clamp(vec3(r, g, b), 0.0, 1.0);

    // Blend with original at uStrength
    ir = mix(col, ir, uStrength);

    // Contrast boost around 0.5 pivot
    ir = (ir - 0.5) * uContrast + 0.5;

    // Soft highlight glow (luminance-based) for the dreamy IR halo
    float lum = dot(ir, vec3(0.2126, 0.7152, 0.0722));
    float hi  = smoothstep(0.7, 1.0, lum) * uGlow;
    ir += vec3(hi * 0.8, hi * 0.7, hi * 0.5); // warm white glow

    finalColor = vec4(clamp(ir, 0.0, 1.0), src.a);
}
`;

export const infraredEffect: EffectDef = {
  effect: "infrared",
  displayName: "Infrared",
  category: "color",
  schema: {
    props: z.object({
      strength: z.number().min(0).max(1).default(0.85),
      contrast: z.number().min(0.5).max(3).default(1.4),
      glow:     z.number().min(0).max(2).default(0.4),
    }),
    channels: [
      { path: "props.strength", type: "scalar", label: "Strength", default: 0.85 },
      { path: "props.contrast", type: "scalar", label: "Contrast", default: 1.4  },
      { path: "props.glow",     type: "scalar", label: "Glow",     default: 0.4  },
    ],
    inspector: [
      { path: "props.strength", label: "Strength", control: "number", min: 0,   max: 1,  step: 0.01 },
      { path: "props.contrast", label: "Contrast", control: "number", min: 0.5, max: 3,  step: 0.01 },
      { path: "props.glow",     label: "Glow",     control: "number", min: 0,   max: 2,  step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

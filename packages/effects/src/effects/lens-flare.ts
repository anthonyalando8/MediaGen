// packages/effects/src/effects/lens-flare.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uIntensity;
uniform float uRadius;

void main(void) {
    vec4  src    = texture(uTexture, vTextureCoord);
    vec2  dir    = vTextureCoord - 0.5;
    float dist   = length(dir);
    float halo   = 1.0 - smoothstep(uRadius * 0.8, uRadius, dist);
    // Radial streak along a fixed 45-degree axis
    float streak = pow(max(dot(normalize(dir + vec2(0.0001)), vec2(0.7071, 0.7071)), 0.0), 6.0);
    vec3  flare  = vec3(1.0, 0.9, 0.7) * (halo + streak * 0.4) * uIntensity;
    finalColor = vec4(src.rgb + flare, src.a);
}
`;

export const lensFlareEffect: EffectDef = {
  effect: "lens-flare",
  displayName: "Lens Flare",
  category: "stylize",
  schema: {
    props: z.object({
      intensity: z.number().min(0).max(3).default(1),
      radius:    z.number().min(0).max(0.5).default(0.2),
    }),
    channels: [
      { path: "props.intensity", type: "scalar", label: "Intensity", default: 1   },
      { path: "props.radius",    type: "scalar", label: "Radius",    default: 0.2 },
    ],
    inspector: [
      { path: "props.intensity", label: "Intensity", control: "number", min: 0, max: 3,   step: 0.01 },
      { path: "props.radius",    label: "Radius",    control: "number", min: 0, max: 0.5, step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

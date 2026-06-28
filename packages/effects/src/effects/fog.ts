// packages/effects/src/effects/fog.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uDensity;
uniform float uFogY;
uniform vec3  uColor;
uniform float uNoiseScale;
uniform float uTime;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

void main(void) {
    vec4  src     = texture(uTexture, vTextureCoord);
    float dist    = clamp((vTextureCoord.y - uFogY) / (1.0 - uFogY + 0.001), 0.0, 1.0);
    float n       = noise(vTextureCoord * uNoiseScale + vec2(uTime * 0.05, 0.0));
    float fogMask = clamp(dist * uDensity + (n - 0.5) * 0.15 * uDensity, 0.0, 1.0);
    vec3  result  = mix(src.rgb, uColor, fogMask);
    finalColor = vec4(result, src.a);
}
`;

export const fogEffect: EffectDef = {
  effect: "fog",
  displayName: "Fog / Haze",
  category: "stylize",
  schema: {
    props: z.object({
      density:    z.number().min(0).max(1).default(0.4),
      fogY:       z.number().min(0).max(1).default(0.6),
      color:      z.object({ l: z.number(), c: z.number(), h: z.number(), alpha: z.number().optional() })
                    .default({ l: 0.96, c: 0.01, h: 240 }), // near-white cool fog
      noiseScale: z.number().min(0).max(10).default(3),
      time:       z.number().default(0),
    }),
    channels: [
      { path: "props.density",    type: "scalar", label: "Density",     default: 0.4 },
      { path: "props.fogY",       type: "scalar", label: "Horizon Y",   default: 0.6 },
      { path: "props.color",      type: "color",  label: "Color",       default: { l: 0.96, c: 0.01, h: 240 } },
      { path: "props.noiseScale", type: "scalar", label: "Noise Scale", default: 3   },
      { path: "props.time",       type: "scalar", label: "Time",        default: 0   },
    ],
    inspector: [
      { path: "props.density",    label: "Density",     control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.fogY",       label: "Horizon Y",   control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.color",      label: "Color",       control: "color"                                   },
      { path: "props.noiseScale", label: "Noise Scale", control: "number", min: 0, max: 10,   step: 0.1  },
      { path: "props.time",       label: "Time",        control: "number", min: 0, max: 1000, step: 0.1  },
    ],
  },
  glsl: FRAGMENT,
};

// packages/effects/src/effects/glitch.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uIntensity;
uniform float uSpeed;
uniform float uTime;

float rand(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
    float offset = rand(vec2(uTime * uSpeed, vTextureCoord.y)) * uIntensity / uInputSize.x;
    float r = texture(uTexture, vTextureCoord + vec2( offset, 0.0)).r;
    float g = texture(uTexture, vTextureCoord).g;
    float b = texture(uTexture, vTextureCoord - vec2( offset, 0.0)).b;
    float a = texture(uTexture, vTextureCoord).a;
    finalColor = vec4(r, g, b, a);
}
`;

export const glitchEffect: EffectDef = {
  effect: "glitch",
  displayName: "Glitch",
  category: "distort",
  schema: {
    props: z.object({
      intensity: z.number().min(0).max(30).default(10),
      speed:     z.number().min(0).max(10).default(2),
      time:      z.number().default(0),
    }),
    channels: [
      { path: "props.intensity", type: "scalar", label: "Intensity", default: 10 },
      { path: "props.speed",     type: "scalar", label: "Speed",     default: 2  },
      { path: "props.time",      type: "scalar", label: "Time",      default: 0  },
    ],
    inspector: [
      { path: "props.intensity", label: "Intensity", control: "number", min: 0, max: 30,   step: 0.5 },
      { path: "props.speed",     label: "Speed",     control: "number", min: 0, max: 10,   step: 0.1 },
      { path: "props.time",      label: "Time",      control: "number", min: 0, max: 1000, step: 0.1 },
    ],
  },
  glsl: FRAGMENT,
};

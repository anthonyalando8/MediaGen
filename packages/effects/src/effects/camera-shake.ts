// packages/effects/src/effects/camera-shake.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uTime;

void main(void) {
    float pi2 = 6.283185;
    float offsetX = sin(uTime * uFrequency * pi2) * uAmplitude / uInputSize.x;
    float offsetY = cos(uTime * uFrequency * pi2) * uAmplitude / uInputSize.y;
    vec2  displaced = vTextureCoord + vec2(offsetX, offsetY);
    finalColor = texture(uTexture, displaced);
}
`;

export const cameraShakeEffect: EffectDef = {
  effect: "camera-shake",
  displayName: "Camera Shake",
  category: "distort",
  schema: {
    props: z.object({
      amplitude: z.number().min(0).max(50).default(5),
      frequency: z.number().min(0).max(10).default(2),
      time:      z.number().default(0),
    }),
    channels: [
      { path: "props.amplitude", type: "scalar", label: "Amplitude", default: 5 },
      { path: "props.frequency", type: "scalar", label: "Frequency", default: 2 },
      { path: "props.time",      type: "scalar", label: "Time",      default: 0 },
    ],
    inspector: [
      { path: "props.amplitude", label: "Amplitude", control: "number", min: 0, max: 50, step: 0.5 },
      { path: "props.frequency", label: "Frequency", control: "number", min: 0, max: 10, step: 0.1 },
      { path: "props.time",      label: "Time",      control: "number", min: 0, max: 1000, step: 0.1 },
    ],
  },
  glsl: FRAGMENT,
};

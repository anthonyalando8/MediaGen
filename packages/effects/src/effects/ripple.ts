// packages/effects/src/effects/ripple.ts
//
// Ripple — a water-surface sinusoidal UV distortion emanating from a
// centre point. Animate `time` for a living water effect.
//
// Props:
//   - amplitude: max UV offset per wave (0-0.1)
//   - frequency: wave frequency (1-20)
//   - speed:     how fast waves propagate — keyframe `time` instead of
//                relying on a hidden clock
//   - time:      animation input (keyframeable)
//   - centerX/Y: origin of the ripple (0-1)
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uTime;
uniform float uCenterX;
uniform float uCenterY;

void main(void) {
    vec2  center = vec2(uCenterX, uCenterY);
    vec2  delta  = vTextureCoord - center;
    float dist   = length(delta);
    // Expanding circular wave: phase decreases with distance so waves
    // appear to travel outward from the centre.
    float wave   = sin(dist * uFrequency - uTime * 3.14159) * uAmplitude;
    vec2  dir    = (dist > 0.0001) ? normalize(delta) : vec2(0.0);
    vec2  uv     = vTextureCoord + dir * wave;
    finalColor   = texture(uTexture, clamp(uv, 0.0, 1.0));
}
`;

export const rippleEffect: EffectDef = {
  effect: "ripple",
  displayName: "Ripple",
  category: "distort",
  schema: {
    props: z.object({
      amplitude: z.number().min(0).max(0.1).default(0.02),
      frequency: z.number().min(1).max(50).default(20),
      time:      z.number().default(0),
      centerX:   z.number().min(0).max(1).default(0.5),
      centerY:   z.number().min(0).max(1).default(0.5),
    }),
    channels: [
      { path: "props.amplitude", type: "scalar", label: "Amplitude", default: 0.02 },
      { path: "props.frequency", type: "scalar", label: "Frequency", default: 20   },
      { path: "props.time",      type: "scalar", label: "Time",      default: 0    },
      { path: "props.centerX",   type: "scalar", label: "Center X",  default: 0.5  },
      { path: "props.centerY",   type: "scalar", label: "Center Y",  default: 0.5  },
    ],
    inspector: [
      { path: "props.amplitude", label: "Amplitude", control: "number", min: 0,   max: 0.1, step: 0.001 },
      { path: "props.frequency", label: "Frequency", control: "number", min: 1,   max: 50,  step: 1     },
      { path: "props.time",      label: "Time",      control: "number", min: 0,   max: 1000, step: 0.1  },
      { path: "props.centerX",   label: "Center X",  control: "number", min: 0,   max: 1,   step: 0.01  },
      { path: "props.centerY",   label: "Center Y",  control: "number", min: 0,   max: 1,   step: 0.01  },
    ],
  },
  glsl: FRAGMENT,
};

// packages/effects/src/effects/bloom.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uThreshold;
uniform float uIntensity;
uniform float uRadius;

// 9-tap approximate Gaussian using vTextureCoord (UV space).
vec4 blurSample(vec2 uv) {
    vec2 off = uRadius / uInputSize.xy;
    vec4 sum = vec4(0.0);
    sum += texture(uTexture, uv + vec2(-off.x, -off.y));
    sum += texture(uTexture, uv + vec2(    0.0, -off.y));
    sum += texture(uTexture, uv + vec2( off.x, -off.y));
    sum += texture(uTexture, uv + vec2(-off.x,     0.0));
    sum += texture(uTexture, uv);
    sum += texture(uTexture, uv + vec2( off.x,     0.0));
    sum += texture(uTexture, uv + vec2(-off.x,  off.y));
    sum += texture(uTexture, uv + vec2(    0.0,  off.y));
    sum += texture(uTexture, uv + vec2( off.x,  off.y));
    return sum / 9.0;
}

void main(void) {
    vec4 original = texture(uTexture, vTextureCoord);
    float lum = dot(original.rgb, vec3(0.2126, 0.7152, 0.0722));
    // Bright-pass + blur blended back over original
    vec4 blurred = blurSample(vTextureCoord);
    float brightFactor = step(uThreshold, lum);
    finalColor = original + blurred * uIntensity * brightFactor;
}
`;

export const bloomEffect: EffectDef = {
  effect: "bloom",
  displayName: "Bloom",
  category: "stylize",
  schema: {
    props: z.object({
      threshold: z.number().min(0).max(1).default(0.7),
      intensity: z.number().min(0).max(3).default(1.0),
      radius:    z.number().min(0).max(20).default(5),
    }),
    channels: [
      { path: "props.threshold", type: "scalar", label: "Threshold", default: 0.7 },
      { path: "props.intensity", type: "scalar", label: "Intensity", default: 1.0 },
      { path: "props.radius",    type: "scalar", label: "Radius",    default: 5   },
    ],
    inspector: [
      { path: "props.threshold", label: "Threshold", control: "number", min: 0, max: 1,  step: 0.01 },
      { path: "props.intensity", label: "Intensity", control: "number", min: 0, max: 3,  step: 0.01 },
      { path: "props.radius",    label: "Radius",    control: "number", min: 0, max: 20, step: 0.5  },
    ],
  },
  glsl: FRAGMENT,
};

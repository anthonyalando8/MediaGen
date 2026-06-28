// packages/effects/src/effects/glass.ts
//
// Frosted / textured glass — samples the texture with a noise-driven UV
// perturbation, giving the look of content viewed through textured glass.
// The noise is computed procedurally (no second texture needed) so it
// works within the single-input pass model.
//
// Props:
//   - blur:       size of the frosted-glass scatter in pixels (0-20)
//   - distortion: amount of underlying noise warping (0-1)
//   - scale:      scale of the noise pattern (0.5-20)
//   - brightness: optional brightness tweak (0.5-2, default 1.05 — glass
//                 typically passes slightly more light at the edges)
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uBlur;
uniform float uDistortion;
uniform float uScale;
uniform float uBrightness;

// Value noise — smooth hash lattice
float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash2(i            ), hash2(i + vec2(1.0, 0.0)), u.x),
        mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

void main(void) {
    vec2 uv = vTextureCoord;

    // Noise-based UV warp for distortion
    float nx = noise2(uv * uScale) - 0.5;
    float ny = noise2(uv * uScale + vec2(3.7, 1.3)) - 0.5;
    vec2 warpedUV = uv + vec2(nx, ny) * uDistortion * 0.05;

    // Scatter samples around the warped UV for the frosted blur
    vec2 px  = uBlur / uInputSize.xy;
    vec4 acc = vec4(0.0);
    float w  = 0.0;
    // 13-tap rotated-grid disc blur
    acc += texture(uTexture, warpedUV) * 4.0;                             w += 4.0;
    acc += texture(uTexture, warpedUV + vec2( px.x,  0.0  ));             w += 1.0;
    acc += texture(uTexture, warpedUV + vec2(-px.x,  0.0  ));             w += 1.0;
    acc += texture(uTexture, warpedUV + vec2( 0.0,   px.y ));             w += 1.0;
    acc += texture(uTexture, warpedUV + vec2( 0.0,  -px.y ));             w += 1.0;
    acc += texture(uTexture, warpedUV + vec2( px.x,  px.y ) * 0.7071);   w += 1.0;
    acc += texture(uTexture, warpedUV + vec2(-px.x,  px.y ) * 0.7071);   w += 1.0;
    acc += texture(uTexture, warpedUV + vec2( px.x, -px.y ) * 0.7071);   w += 1.0;
    acc += texture(uTexture, warpedUV + vec2(-px.x, -px.y ) * 0.7071);   w += 1.0;
    vec4 blurred = acc / w;

    // Subtle brightness lift — frosted glass scatters light
    blurred.rgb *= uBrightness;

    finalColor = vec4(blurred.rgb, blurred.a);
}
`;

export const glassEffect: EffectDef = {
  effect: "glass",
  displayName: "Glass",
  category: "stylize",
  schema: {
    props: z.object({
      blur:       z.number().min(0).max(20).default(6),
      distortion: z.number().min(0).max(1).default(0.5),
      scale:      z.number().min(0.5).max(20).default(5),
      brightness: z.number().min(0.5).max(2).default(1.05),
    }),
    channels: [
      { path: "props.blur",       type: "scalar", label: "Blur",       default: 6    },
      { path: "props.distortion", type: "scalar", label: "Distortion", default: 0.5  },
      { path: "props.scale",      type: "scalar", label: "Scale",      default: 5    },
      { path: "props.brightness", type: "scalar", label: "Brightness", default: 1.05 },
    ],
    inspector: [
      { path: "props.blur",       label: "Blur",       control: "number", min: 0,   max: 20,  step: 0.5  },
      { path: "props.distortion", label: "Distortion", control: "number", min: 0,   max: 1,   step: 0.01 },
      { path: "props.scale",      label: "Scale",      control: "number", min: 0.5, max: 20,  step: 0.5  },
      { path: "props.brightness", label: "Brightness", control: "number", min: 0.5, max: 2,   step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

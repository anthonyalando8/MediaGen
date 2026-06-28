// packages/effects/src/effects/depth-of-field.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uFocusY;
uniform float uFocusRange;
uniform float uBlurAmount;
uniform float uBokehShape;

// 13-tap disc blur — 1 centre + 6 inner + 6 outer.
vec4 discBlur(vec2 uv, float r) {
    if (r < 0.5) return texture(uTexture, uv);
    vec2 px = r / uInputSize.xy;
    vec4 acc = texture(uTexture, uv);
    for (int i = 0; i < 6; i++) {
        float a  = float(i) * 1.0472; // 60-degree steps
        float bx = mix(cos(a), sign(cos(a)) * 0.866, uBokehShape);
        float by = mix(sin(a), sign(sin(a)) * 0.866, uBokehShape);
        acc += texture(uTexture, uv + vec2(bx, by) * px * 0.5);
    }
    for (int i = 0; i < 6; i++) {
        float a  = (float(i) + 0.5) * 1.0472;
        float bx = mix(cos(a), sign(cos(a)) * 0.866, uBokehShape);
        float by = mix(sin(a), sign(sin(a)) * 0.866, uBokehShape);
        acc += texture(uTexture, uv + vec2(bx, by) * px);
    }
    return acc / 13.0;
}

void main(void) {
    float dist   = abs(vTextureCoord.y - uFocusY);
    float blur   = smoothstep(uFocusRange, uFocusRange * 2.0 + 0.001, dist) * uBlurAmount;
    finalColor   = discBlur(vTextureCoord, blur);
}
`;

export const depthOfFieldEffect: EffectDef = {
  effect: "depth-of-field",
  displayName: "Depth of Field",
  category: "stylize",
  schema: {
    props: z.object({
      focusY:     z.number().min(0).max(1).default(0.5),
      focusRange: z.number().min(0).max(0.5).default(0.15),
      blurAmount: z.number().min(0).max(30).default(8),
      bokehShape: z.number().min(0).max(1).default(0.6),
    }),
    channels: [
      { path: "props.focusY",     type: "scalar", label: "Focus Y",     default: 0.5  },
      { path: "props.focusRange", type: "scalar", label: "Focus Range", default: 0.15 },
      { path: "props.blurAmount", type: "scalar", label: "Blur Amount", default: 8    },
      { path: "props.bokehShape", type: "scalar", label: "Bokeh Shape", default: 0.6  },
    ],
    inspector: [
      { path: "props.focusY",     label: "Focus Y",     control: "number", min: 0, max: 1,   step: 0.01 },
      { path: "props.focusRange", label: "Focus Range", control: "number", min: 0, max: 0.5, step: 0.01 },
      { path: "props.blurAmount", label: "Blur Amount", control: "number", min: 0, max: 30,  step: 0.5  },
      { path: "props.bokehShape", label: "Bokeh Shape", control: "number", min: 0, max: 1,   step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

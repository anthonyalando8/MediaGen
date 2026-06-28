// packages/effects/src/effects/teal-orange.ts
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uStrength;
uniform float uShadowShift;
uniform float uHighlightShift;
uniform float uSplitPoint;

void main(void) {
    vec4  src  = texture(uTexture, vTextureCoord);
    float lum  = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));

    // Shadow zone (lum < splitPoint) → teal: drain red, lift blue
    float shadowW = smoothstep(uSplitPoint + 0.1, uSplitPoint - 0.1, lum) * uShadowShift;
    // Highlight zone (lum > splitPoint) → orange: lift red, drain blue
    float highW   = smoothstep(uSplitPoint - 0.1, uSplitPoint + 0.1, lum) * uHighlightShift;

    vec3 col = src.rgb;
    col.r -= shadowW * col.r * 0.6;
    col.b += shadowW * (1.0 - col.b) * 0.3;
    col.g += shadowW * (1.0 - col.g) * 0.1;
    col.r += highW  * (1.0 - col.r) * 0.4;
    col.b -= highW  * col.b * 0.5;

    finalColor = vec4(mix(src.rgb, col, uStrength), src.a);
}
`;

export const tealOrangeEffect: EffectDef = {
  effect: "teal-orange",
  displayName: "Teal & Orange",
  category: "color",
  schema: {
    props: z.object({
      strength:       z.number().min(0).max(1).default(0.6),
      shadowShift:    z.number().min(0).max(1).default(0.5),
      highlightShift: z.number().min(0).max(1).default(0.5),
      splitPoint:     z.number().min(0).max(1).default(0.4),
    }),
    channels: [
      { path: "props.strength",       type: "scalar", label: "Strength",        default: 0.6 },
      { path: "props.shadowShift",    type: "scalar", label: "Shadow Shift",    default: 0.5 },
      { path: "props.highlightShift", type: "scalar", label: "Highlight Shift", default: 0.5 },
      { path: "props.splitPoint",     type: "scalar", label: "Split Point",     default: 0.4 },
    ],
    inspector: [
      { path: "props.strength",       label: "Strength",        control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.shadowShift",    label: "Shadow Shift",    control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.highlightShift", label: "Highlight Shift", control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.splitPoint",     label: "Split Point",     control: "number", min: 0, max: 1, step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

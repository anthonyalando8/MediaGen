// packages/effects/src/effects/blur.ts
//
// Separable Gaussian blur — `passes: 2` (horizontal pass, then vertical),
// far cheaper than a single NxN 2D kernel for the same visual radius.
// `uDirection` (set by the renderer per-pass, not exposed as a user prop)
// picks which axis a given pass blurs along.

import { z } from "zod";
import type { EffectDef } from "../registry";
import { DEFAULT_VERTEX } from "../glsl/default.vert";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uAmount;
uniform vec2 uDirection;

// 9-tap Gaussian kernel, sigma chosen so the visible falloff matches
// "amount" in roughly comp-space pixels at 1x texture resolution.
void main(void) {
    vec2 texelSize = uDirection / uInputSize.xy;
    vec4 sum = vec4(0.0);
    float weights[5];
    weights[0] = 0.227027;
    weights[1] = 0.1945946;
    weights[2] = 0.1216216;
    weights[3] = 0.054054;
    weights[4] = 0.016216;

    sum += texture(uTexture, vTextureCoord) * weights[0];
    for (int i = 1; i < 5; i++) {
        float offset = float(i) * uAmount;
        sum += texture(uTexture, vTextureCoord + texelSize * offset) * weights[i];
        sum += texture(uTexture, vTextureCoord - texelSize * offset) * weights[i];
    }
    finalColor = sum;
}
`;

export const blurEffect: EffectDef = {
  effect: "blur",
  displayName: "Gaussian Blur",
  category: "blur",
  schema: {
    props: z.object({ amount: z.number().min(0).default(0) }),
    channels: [{ path: "props.amount", type: "scalar", label: "Amount", default: 0 }],
    inspector: [{ path: "props.amount", label: "Amount", control: "number" }],
  },
  glsl: FRAGMENT,
  passes: 2,
};

export const BLUR_VERTEX = DEFAULT_VERTEX;
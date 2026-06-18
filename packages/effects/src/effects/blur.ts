// packages/effects/src/effects/blur.ts
//
// Separable Gaussian blur — `passes: 2` (horizontal pass, then vertical),
// far cheaper than a single NxN 2D kernel for the same visual radius.
// `uDirection` is set by the RENDERER per-pass (pass-resolver.ts's
// multi-pass execution, not a user-facing prop) — (1,0) for the
// horizontal pass, (0,1) for the vertical.
//
// IMPORTANT: no local array indexed by a loop variable (e.g. `float
// weights[5]; ... weights[i]` inside a `for`). Pixi's GlProgram only
// emits a real `#version 300 es` pragma when the source ALREADY contains
// that literal string (GlProgram.mjs's `isES300` check) — none of this
// package's shaders do, so every one of them compiles under Pixi's ES1.00
// compatibility macro-shim (`addProgramDefines`: `#define in varying`,
// `#define texture texture2D`, etc.) regardless of whether the actual
// WebGL context is v1 or v2. Dynamically-indexed local arrays inside a
// loop are a well-known compile failure under that stricter dialect on
// many real GPU driver/ANGLE translator combinations (the exact "Could
// not initialize shader" failure reported against this effect) even
// though they're valid GLSL ES 3.00. Fully unrolling avoids the array
// entirely — five explicit weighted samples, no loop, no indexing.

import { z } from "zod";
import type { EffectDef } from "../registry";
import { DEFAULT_VERTEX } from "../glsl/default.vert";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uAmount;
uniform vec2 uDirection;

// 9-tap Gaussian kernel, sigma chosen so the visible falloff matches
// "amount" in roughly comp-space pixels at 1x texture resolution. Fully
// unrolled (no array, no loop-variable indexing) — see module doc.
void main(void) {
    vec2 texelSize = uDirection / uInputSize.xy;
    vec2 offset1 = texelSize * uAmount * 1.0;
    vec2 offset2 = texelSize * uAmount * 2.0;
    vec2 offset3 = texelSize * uAmount * 3.0;
    vec2 offset4 = texelSize * uAmount * 4.0;

    vec4 sum = texture(uTexture, vTextureCoord) * 0.227027;
    sum += texture(uTexture, vTextureCoord + offset1) * 0.1945946;
    sum += texture(uTexture, vTextureCoord - offset1) * 0.1945946;
    sum += texture(uTexture, vTextureCoord + offset2) * 0.1216216;
    sum += texture(uTexture, vTextureCoord - offset2) * 0.1216216;
    sum += texture(uTexture, vTextureCoord + offset3) * 0.054054;
    sum += texture(uTexture, vTextureCoord - offset3) * 0.054054;
    sum += texture(uTexture, vTextureCoord + offset4) * 0.016216;
    sum += texture(uTexture, vTextureCoord - offset4) * 0.016216;
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
// packages/effects/src/transitions/dip.ts
//
// "dip" (dip-to-black, or any solid color) and "cut" (instant swap, no
// blend at all — included here since it shares this file's trivial
// shader shape rather than warranting its own file). Logically matches
// every TransitionDef's signature: `vec4 trans(sampler2D from, sampler2D
// to, float progress)` (§6) — `uFrom`/`uTo`/`uProgress` are the
// renderer-supplied uniforms implementing that signature in GLSL (each
// transition is a full `main()`, not a callable `trans` function, since
// function-style sampler params aren't portable pre-GLSL-ES-3.1 — same
// logical signature, different GLSL-legal shape).

import { z } from "zod";
import type { TransitionDef } from "../registry";

const DIP_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uTo;
uniform float uProgress;
uniform vec3 uColor;

void main(void) {
    vec4 from = texture(uTexture, vTextureCoord);
    vec4 to = texture(uTo, vTextureCoord);
    // first half: from -> color; second half: color -> to.
    float toColor = clamp(uProgress * 2.0, 0.0, 1.0);
    float fromColor = clamp(uProgress * 2.0 - 1.0, 0.0, 1.0);
    vec4 dipped = mix(from, vec4(uColor, 1.0), toColor);
    finalColor = mix(dipped, to, fromColor);
}
`;

const CUT_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uTo;
uniform float uProgress;

void main(void) {
    finalColor = uProgress < 0.5 ? texture(uTexture, vTextureCoord) : texture(uTo, vTextureCoord);
}
`;

export const dipTransition: TransitionDef = {
  preset: "dip",
  displayName: "Dip to Color",
  glsl: DIP_FRAGMENT,
  schema: {
    props: z.object({ color: z.object({ l: z.number(), c: z.number(), h: z.number() }).default({ l: 0, c: 0, h: 0 }) }),
    inspector: [{ path: "props.color", label: "Color", control: "color" }],
  },
};

export const cutTransition: TransitionDef = {
  preset: "cut",
  displayName: "Cut",
  glsl: CUT_FRAGMENT,
  schema: {
    props: z.object({}),
    inspector: [],
  },
};

const DISSOLVE_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uTo;
uniform float uProgress;

void main(void) {
    finalColor = mix(texture(uTexture, vTextureCoord), texture(uTo, vTextureCoord), uProgress);
}
`;

export const crossDissolveTransition: TransitionDef = {
  preset: "cross-dissolve",
  displayName: "Cross Dissolve",
  glsl: DISSOLVE_FRAGMENT,
  schema: {
    props: z.object({}),
    inspector: [],
  },
};
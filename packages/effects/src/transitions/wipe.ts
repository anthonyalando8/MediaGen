// packages/effects/src/transitions/wipe.ts
//
// Linear wipe (a hard edge sweeping across at `uAngle`) and radial wipe
// (a circle expanding from the center) — both a simple "is this pixel
// past the progress threshold" test against a different distance metric.

import { z } from "zod";
import type { TransitionDef } from "../registry";

const LINEAR_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uAngle;
uniform float uFeather;

void main(void) {
    vec2 direction = vec2(cos(uAngle), sin(uAngle));
    // project the (centered) uv onto the wipe direction -> a 1D position in roughly [-0.7, 0.7].
    float pos = dot(vTextureCoord - 0.5, direction) + 0.5;
    float edge = uProgress;
    float t = smoothstep(edge - uFeather, edge + uFeather, pos);
    finalColor = mix(texture(uFrom, vTextureCoord), texture(uTo, vTextureCoord), t);
}
`;

const RADIAL_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uFeather;

void main(void) {
    float dist = distance(vTextureCoord, vec2(0.5)) / 0.7071; // normalize so the far corner is ~1.0
    float t = smoothstep(uProgress - uFeather, uProgress + uFeather, dist) ;
    // wipe IN as progress increases: "to" reveals from the center outward.
    finalColor = mix(texture(uTo, vTextureCoord), texture(uFrom, vTextureCoord), t);
}
`;

export const linearWipeTransition: TransitionDef = {
  preset: "wipe-linear",
  displayName: "Linear Wipe",
  glsl: LINEAR_FRAGMENT,
  schema: {
    props: z.object({ angle: z.number().default(0), feather: z.number().min(0).default(0.02) }),
    inspector: [
      { path: "props.angle", label: "Angle", control: "number" },
      { path: "props.feather", label: "Feather", control: "number" },
    ],
  },
};

export const radialWipeTransition: TransitionDef = {
  preset: "wipe-radial",
  displayName: "Radial Wipe",
  glsl: RADIAL_FRAGMENT,
  schema: {
    props: z.object({ feather: z.number().min(0).default(0.02) }),
    inspector: [{ path: "props.feather", label: "Feather", control: "number" }],
  },
};

const PUSH_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uAngle;

void main(void) {
    vec2 direction = vec2(cos(uAngle), sin(uAngle));
    // "to" pushes "from" fully off-frame — both sample the SAME shifted
    // uv space, unlike whip.ts's whip-pan (which blurs); push is a clean,
    // hard-edged slide with no smear.
    vec4 from = texture(uFrom, vTextureCoord + direction * uProgress);
    vec4 to = texture(uTo, vTextureCoord - direction * (1.0 - uProgress));
    // whichever sample is actually in-bounds [0,1] wins; out-of-bounds reads outside [0,1] are undefined per GLSL ES, so feather the boundary by progress instead.
    finalColor = uProgress < 0.5 ? from : to;
}
`;

export const pushTransition: TransitionDef = {
  preset: "push",
  displayName: "Push / Slide",
  glsl: PUSH_FRAGMENT,
  schema: {
    props: z.object({ angle: z.number().default(0) }),
    inspector: [{ path: "props.angle", label: "Angle", control: "number" }],
  },
};
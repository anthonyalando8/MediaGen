// packages/effects/src/transitions/whip.ts
//
// "Whip pan": both clips slide in the same direction (`uAngle`) at once,
// with a directional motion-blur smear — approximates a camera whip-pan
// cut without needing optical-flow data.

import { z } from "zod";
import type { TransitionDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uAngle;
uniform float uBlurAmount;

vec4 sampleBlurred(sampler2D tex, vec2 uv, vec2 direction, float amount) {
    vec4 sum = vec4(0.0);
    const int taps = 5;
    for (int i = 0; i < taps; i++) {
        float t = (float(i) / float(taps - 1) - 0.5) * amount;
        sum += texture(tex, uv + direction * t);
    }
    return sum / float(taps);
}

void main(void) {
    vec2 direction = vec2(cos(uAngle), sin(uAngle));
    // both clips shift by the SAME signed distance, in opposite screen
    // positions, so "from" appears to slide off while "to" slides in from
    // the same direction — a true whip-pan, not a wipe (no hard edge).
    vec2 fromUv = vTextureCoord + direction * uProgress;
    vec2 toUv = vTextureCoord - direction * (1.0 - uProgress);

    float blur = uBlurAmount * sin(uProgress * 3.14159265);
    vec4 from = sampleBlurred(uTexture, fromUv, direction, blur);
    vec4 to = sampleBlurred(uTo, toUv, direction, blur);

    finalColor = mix(from, to, smoothstep(0.0, 1.0, uProgress));
}
`;

export const whipPanTransition: TransitionDef = {
  preset: "whip",
  displayName: "Whip Pan",
  glsl: FRAGMENT,
  schema: {
    props: z.object({ angle: z.number().default(0), blurAmount: z.number().min(0).default(0.05) }),
    inspector: [
      { path: "props.angle", label: "Angle", control: "number" },
      { path: "props.blurAmount", label: "Blur Amount", control: "number" },
    ],
  },
};
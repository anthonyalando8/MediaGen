// packages/effects/src/transitions/slam.ts
//
// "Slam": the incoming clip punches in with a fast zoom-out-to-rest plus a
// white-flash at the moment of impact (progress ~0.15) — a high-energy,
// short-form-video-style transition. The zoom is on `uTo` only; `uFrom`
// holds steady until the flash clears, then `uTo` takes over.

import { z } from "zod";
import type { TransitionDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uZoomStart;
uniform float uFlashIntensity;

void main(void) {
    // "to" zooms in from uZoomStart down to 1.0 (its natural scale) over
    // the transition's duration — sampled by scaling its UV around center
    // (a SMALLER UV range = the texture appears more zoomed-in).
    float zoom = mix(uZoomStart, 1.0, smoothstep(0.0, 1.0, uProgress));
    vec2 zoomedUv = (vTextureCoord - 0.5) * zoom + 0.5;
    vec4 to = texture(uTo, zoomedUv);

    // a brief white flash peaking at progress ~0.15 (right as the zoom
    // settles), fading out by ~0.4 — gives the "impact" feel.
    float flash = uFlashIntensity * exp(-pow((uProgress - 0.15) * 6.0, 2.0));

    vec4 from = texture(uTexture, vTextureCoord);
    vec4 base = uProgress < 0.15 ? from : to;
    finalColor = vec4(mix(base.rgb, vec3(1.0), clamp(flash, 0.0, 1.0)), base.a);
}
`;

export const slamTransition: TransitionDef = {
  preset: "slam",
  displayName: "Slam",
  glsl: FRAGMENT,
  schema: {
    props: z.object({
      zoomStart: z.number().min(1).default(1.4),
      flashIntensity: z.number().min(0).max(1).default(0.8),
    }),
    inspector: [
      { path: "props.zoomStart", label: "Zoom Start", control: "number" },
      { path: "props.flashIntensity", label: "Flash Intensity", control: "number" },
    ],
  },
};
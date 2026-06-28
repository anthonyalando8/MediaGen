// packages/effects/src/effects/kaleidoscope.ts
//
// Kaleidoscope — tiles the image into N radial mirror segments around a
// centre point, creating the classic symmetrical mandala look.
// `segments` controls the number of pie slices (2-16).
// `rotation` spins the entire pattern (animatable for a spinning effect).
// `zoom` scales the source sample within each segment.
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uSegments;
uniform float uRotation;
uniform float uZoom;
uniform float uCenterX;
uniform float uCenterY;

void main(void) {
    vec2  uv    = vTextureCoord - vec2(uCenterX, uCenterY);
    float angle = atan(uv.y, uv.x) + uRotation;
    float dist  = length(uv);

    // Fold into one segment
    float segAngle = 3.14159265 / uSegments;
    // Map angle into [0, 2*segAngle]
    angle = mod(angle, 2.0 * segAngle);
    // Mirror inside each segment
    if (angle > segAngle) angle = 2.0 * segAngle - angle;

    // Reconstruct UV from folded polar coords
    vec2 sampleUV = vec2(
        cos(angle) * dist / uZoom + 0.5,
        sin(angle) * dist / uZoom + 0.5
    );
    // Tile using fract so out-of-range samples wrap
    sampleUV = fract(sampleUV);

    finalColor = texture(uTexture, sampleUV);
}
`;

export const kaleidoscopeEffect: EffectDef = {
  effect: "kaleidoscope",
  displayName: "Kaleidoscope",
  category: "distort",
  schema: {
    props: z.object({
      segments: z.number().int().min(2).max(16).default(6),
      rotation: z.number().min(0).max(6.2832).default(0),
      zoom:     z.number().min(0.1).max(3).default(1),
      centerX:  z.number().min(0).max(1).default(0.5),
      centerY:  z.number().min(0).max(1).default(0.5),
    }),
    channels: [
      { path: "props.segments", type: "scalar", label: "Segments", default: 6   },
      { path: "props.rotation", type: "scalar", label: "Rotation", default: 0   },
      { path: "props.zoom",     type: "scalar", label: "Zoom",     default: 1   },
      { path: "props.centerX",  type: "scalar", label: "Center X", default: 0.5 },
      { path: "props.centerY",  type: "scalar", label: "Center Y", default: 0.5 },
    ],
    inspector: [
      { path: "props.segments", label: "Segments", control: "number", min: 2,   max: 16,    step: 1    },
      { path: "props.rotation", label: "Rotation", control: "number", min: 0,   max: 6.283, step: 0.01 },
      { path: "props.zoom",     label: "Zoom",     control: "number", min: 0.1, max: 3,     step: 0.05 },
      { path: "props.centerX",  label: "Center X", control: "number", min: 0,   max: 1,     step: 0.01 },
      { path: "props.centerY",  label: "Center Y", control: "number", min: 0,   max: 1,     step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

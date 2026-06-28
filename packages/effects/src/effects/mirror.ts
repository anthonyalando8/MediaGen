// packages/effects/src/effects/mirror.ts
//
// Mirror — reflects the image along a chosen axis.
//
// mode:
//   0 = horizontal (left half mirrored to right)
//   1 = vertical   (top half mirrored to bottom)
//   2 = diagonal ↘ (top-left quadrant tiled to all four)
//   3 = quad        (all four quadrants mirrored — kaleidoscope-lite)
//
// `offset` shifts the mirror axis from 0.5 (centre) in either direction.
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uMode;
uniform float uOffset;

void main(void) {
    vec2 uv = vTextureCoord;

    if (uMode < 0.5) {
        // Horizontal: mirror left→right at x = uOffset
        uv.x = abs(uv.x - uOffset) + uOffset;
        // Clamp to [0,1] — pixels beyond the edge reflect from the source edge
        uv.x = clamp(1.0 - abs(uv.x - 1.0), 0.0, 1.0);
        uv.x = clamp(abs(uv.x), 0.0, 1.0);
        uv.x = abs(uv.x - uOffset) + uOffset;
        uv.x = 1.0 - abs(1.0 - uv.x);
        uv.x = clamp(uv.x, 0.0, 1.0);

    } else if (uMode < 1.5) {
        // Vertical: mirror top→bottom at y = uOffset
        uv.y = abs(uv.y - uOffset) + uOffset;
        uv.y = 1.0 - abs(1.0 - uv.y);
        uv.y = clamp(uv.y, 0.0, 1.0);

    } else if (uMode < 2.5) {
        // Diagonal: fold both axes
        uv.x = abs(uv.x - uOffset) + uOffset;
        uv.x = 1.0 - abs(1.0 - uv.x);
        uv.x = clamp(uv.x, 0.0, 1.0);
        uv.y = abs(uv.y - uOffset) + uOffset;
        uv.y = 1.0 - abs(1.0 - uv.y);
        uv.y = clamp(uv.y, 0.0, 1.0);

    } else {
        // Quad: four-way mirror around centre — true kaleidoscope-lite
        // Map all coordinates into the top-left quadrant
        if (uv.x > 0.5) uv.x = 1.0 - uv.x;
        if (uv.y > 0.5) uv.y = 1.0 - uv.y;
        uv = clamp(uv, 0.0, 0.5);
    }

    finalColor = texture(uTexture, uv);
}
`;

export const mirrorEffect: EffectDef = {
  effect: "mirror",
  displayName: "Mirror",
  category: "distort",
  schema: {
    props: z.object({
      mode:   z.number().int().min(0).max(3).default(0),
      offset: z.number().min(0).max(1).default(0.5),
    }),
    channels: [
      { path: "props.mode",   type: "scalar", label: "Mode",   default: 0   },
      { path: "props.offset", type: "scalar", label: "Offset", default: 0.5 },
    ],
    inspector: [
      {
        path: "props.mode", label: "Mode", control: "select",
        options: ["Horizontal", "Vertical", "Diagonal", "Quad"],
      },
      { path: "props.offset", label: "Offset", control: "number", min: 0, max: 1, step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};

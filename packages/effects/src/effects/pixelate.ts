// packages/effects/src/effects/pixelate.ts
//
// Pixelate / Mosaic — quantises UV coordinates to a coarser grid,
// sampling the texture at the centre of each cell for a pixel-art look.
// `sizeX` and `sizeY` control cell dimensions in pixels independently
// so you can do rectangular pixels (e.g. classic CRT-style tall cells).
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uSizeX;
uniform float uSizeY;

void main(void) {
    // Cell size in UV space
    float dx = uSizeX / uInputSize.x;
    float dy = uSizeY / uInputSize.y;
    // Snap UV to the centre of the nearest cell
    vec2 uv = vec2(
        floor(vTextureCoord.x / dx) * dx + dx * 0.5,
        floor(vTextureCoord.y / dy) * dy + dy * 0.5
    );
    finalColor = texture(uTexture, uv);
}
`;

export const pixelateEffect: EffectDef = {
  effect: "pixelate",
  displayName: "Pixelate",
  category: "stylize",
  schema: {
    props: z.object({
      sizeX: z.number().min(1).max(100).default(10),
      sizeY: z.number().min(1).max(100).default(10),
    }),
    channels: [
      { path: "props.sizeX", type: "scalar", label: "Width",  default: 10 },
      { path: "props.sizeY", type: "scalar", label: "Height", default: 10 },
    ],
    inspector: [
      { path: "props.sizeX", label: "Width",  control: "number", min: 1, max: 100, step: 1 },
      { path: "props.sizeY", label: "Height", control: "number", min: 1, max: 100, step: 1 },
    ],
  },
  glsl: FRAGMENT,
};

// packages/renderer-webgl/src/color.ts
//
// OKLCH -> sRGB conversion (via OKLab, Björn Ottosson's reference formulas),
// used to turn ColorOKLCH fills/strokes/text colors into the packed
// 0xRRGGBB integers Pixi's Graphics/TextStyle APIs expect.

import type { ColorOKLCH } from "contract";

function linearToSrgb(c: number): number {
  const x = Math.min(Math.max(c, 0), 1);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** OKLCH -> linear sRGB, via OKLab. */
function oklchToLinearSrgb(color: ColorOKLCH): [number, number, number] {
  const hRad = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hRad);
  const b = color.c * Math.sin(hRad);
  const l = color.l;

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

/**
 * Converts a ColorOKLCH to a packed 0xRRGGBB integer. `alpha`, if present,
 * is dropped here — apply it via the display object's `.alpha` (already
 * carrying the node's sampled opacity) rather than per-fill alpha.
 */
export function oklchToHex(color: ColorOKLCH): number {
  const [r, g, b] = oklchToLinearSrgb(color).map(linearToSrgb);
  const toByte = (c: number) => Math.round(Math.min(Math.max(c, 0), 1) * 255);
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}
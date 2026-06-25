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
 * Converts a packed 0xRRGGBB integer to a packed hex string like "#ff0000".
 */
export function hexToString(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/** sRGB 0–255 integers → ColorOKLCH (via linear sRGB → OKLab → OKLCH). */
export function rgbToOklch(r: number, g: number, b: number): ColorOKLCH {
  // sRGB → linear
  function toLinear(c: number): number {
    const v = Math.min(Math.max(c / 255, 0), 1);
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);

  // linear sRGB → OKLab
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  // OKLab → OKLCH
  const c = Math.sqrt(a * a + bLab * bLab);
  const h = ((Math.atan2(bLab, a) * 180) / Math.PI + 360) % 360;

  return { l: Math.round(L * 1000) / 1000, c: Math.round(c * 1000) / 1000, h: Math.round(h * 10) / 10 };
}

/** Hex string ("#rrggbb" or "rrggbb") → ColorOKLCH. */
export function hexStringToOklch(hex: string): ColorOKLCH {
  const clean = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const n = parseInt(clean, 16);
  return rgbToOklch((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

export function oklchToHex(color: ColorOKLCH): number {
  const [r, g, b] = oklchToLinearSrgb(color).map(linearToSrgb);
  const toByte = (c: number) => Math.round(Math.min(Math.max(c, 0), 1) * 255);
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}
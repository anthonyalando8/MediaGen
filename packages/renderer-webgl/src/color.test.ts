// packages/renderer-webgl/src/color.test.ts
import { describe, expect, it } from "vitest";
import { oklchToHex } from "./color";

describe("oklchToHex", () => {
  it("converts OKLCH white to 0xffffff", () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe(0xffffff);
  });

  it("converts OKLCH black to 0x000000", () => {
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe(0x000000);
  });

  it("converts a mid-grey (achromatic) to an equal-channel grey", () => {
    const hex = oklchToHex({ l: 0.5, c: 0, h: 0 });
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(255);
  });

  it("produces distinct hex values for different hues at the same lightness/chroma", () => {
    const red = oklchToHex({ l: 0.6, c: 0.15, h: 30 });
    const green = oklchToHex({ l: 0.6, c: 0.15, h: 140 });
    const blue = oklchToHex({ l: 0.6, c: 0.15, h: 260 });
    expect(red).not.toBe(green);
    expect(green).not.toBe(blue);
    expect(red).not.toBe(blue);
  });

  it("always returns a value within the 24-bit RGB range", () => {
    const samples = [
      { l: 0.9, c: 0.3, h: 0 },
      { l: 0.1, c: 0.3, h: 200 },
      { l: 0.6, c: 0.15, h: 250 }, // shape default fill
    ];
    for (const color of samples) {
      const hex = oklchToHex(color);
      expect(hex).toBeGreaterThanOrEqual(0);
      expect(hex).toBeLessThanOrEqual(0xffffff);
    }
  });
});
// apps/editor/src/persistence/scene-import-text-fit.test.ts
//
// Regression coverage for the "beat 4" bug: layerTextNodes/kineticTextNodes
// sized captions purely from frame WIDTH with no check against frame
// HEIGHT, so a long body at landscape aspect (narrower available height
// than portrait, same width-driven font size) rendered its top lines above
// the visible frame. fitWrappedLines() is the shared fix — shrinks the
// font until the wrapped block fits, with a final top/bottom clamp.
import { describe, expect, it } from "vitest";
import { fitWrappedLines } from "./scene-import";

describe("fitWrappedLines", () => {
  it("reproduces run 031 beat_04 (23-word quote_card body, 1920x1080 landscape) without overflow", () => {
    const body =
      "We will examine the erosion of deep thought in Aster and the significance of the one place that still remembers the old ways.";
    const W = 1920, H = 1080;
    const availHFrac = 0.86;
    const { totalH } = fitWrappedLines(body, W, H, 700, 0.075, availHFrac);

    expect(totalH).toBeLessThanOrEqual(H * availHFrac + 1); // +1 for rounding slack
  });

  it("short text that already fits is untouched by the shrink loop (byte-for-byte, common case)", () => {
    const W = 1920, H = 1080;
    const fontScale = 0.075;
    const short = fitWrappedLines("A short line.", W, H, 700, fontScale);
    expect(short.fs).toBe(Math.round(W * fontScale)); // no shrink triggered
  });

  it("never shrinks past the floor ratio of the requested scale", () => {
    // A pathologically long single run of text at a big hero scale.
    const longText = new Array(40).fill("word").join(" ");
    const W = 1080, H = 1080; // square-ish, tight available height
    const fontScaleStart = 0.13; // hero size
    const { fs } = fitWrappedLines(longText, W, H, 700, fontScaleStart);
    const floorFs = Math.round(W * fontScaleStart * 0.55);
    expect(fs).toBeGreaterThanOrEqual(floorFs);
  });

  it("portrait orientation (the pre-existing common case) doesn't need to shrink at all", () => {
    // Same beat_04 text, but portrait — far more available height (1920)
    // relative to its own (narrower) width than landscape has, so the
    // unshrunk starting size already fits and the loop never triggers.
    const body =
      "We will examine the erosion of deep thought in Aster and the significance of the one place that still remembers the old ways.";
    const W = 1080, fontScale = 0.075;
    const portrait = fitWrappedLines(body, W, 1920, 700, fontScale);
    expect(portrait.fs).toBe(Math.round(W * fontScale));
    expect(portrait.totalH).toBeLessThanOrEqual(1920 * 0.86);
  });

  it("reproduces run 036 beat_01 ('ENDLESS TAB-SWITCHING' title_card, 3840x2160 4K landscape) — a single unbreakable hyphenated word no longer overflows the column", () => {
    // "TAB-SWITCHING" has no space, so it's one unbreakable wrap token —
    // the height-only check (totalH vs availH) never caught this, since
    // two short lines don't exceed the height budget even though the
    // second line's WIDTH blew past the column on its own.
    const W = 3840, H = 2160;
    const margin = Math.round(W * 0.1);
    const colWidth = W - margin * 2;
    const { lines } = fitWrappedLines("ENDLESS TAB-SWITCHING", W, H, 700, 0.13);
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(colWidth + 1); // +1 rounding slack
    }
  });

  it("a single unbreakable long word still respects the shrink floor rather than shrinking forever", () => {
    const W = 800, H = 800;
    const fontScaleStart = 0.13;
    const { fs } = fitWrappedLines("SUPERCALIFRAGILISTICEXPIALIDOCIOUS", W, H, 700, fontScaleStart);
    const floorFs = Math.round(W * fontScaleStart * 0.55);
    expect(fs).toBeGreaterThanOrEqual(floorFs);
  });
});

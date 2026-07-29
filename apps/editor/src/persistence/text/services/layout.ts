// apps/editor/src/persistence/text/services/layout.ts
//
// P0 · Layout + fitting primitives, lifted verbatim from scene-import.ts.
//
// THE TWO FITTERS: `fitTextToBox` is the unified fitter (box in px, absolute
// floor) — every representation should call this. `fitWrappedLines` is the
// older frame-fraction fitter (kept EXPORTED and behavior-identical so the
// legacy `buildBeatGroup` path can keep calling it during P0/P1). Both now
// share `wrapLines` + `measureText`, which is the drift risk removed. Once
// golden-file tests confirm parity end-to-end, `fitWrappedLines` can be
// re-expressed as a thin wrapper over `fitTextToBox` and deleted (P4).

import type { ColorOKLCH } from "core";
import { measureText, spaceWidth } from "./measure";
import { tierPx, tierFloorPx, tierTracking, type TierName } from "./type-scale";

export interface FitBox { x: number; y: number; w: number; h: number; }
export interface FitResult { fs: number; lineH: number; lines: { text: string; width: number }[]; totalH: number; fits: boolean; }

export const SAFE = { x: 0.08, y: 0.08 };   // title-safe inset (both axes)
export const MAX_BLOCK_H = 0.62;             // max fraction of frame height one block may cover
export const LINE_H_DISPLAY = 1.2;
export const LINE_H_BODY = 1.28;

export const _FONT_SCALE_SHRINK_STEP = 0.92;
export const _FONT_SCALE_FLOOR_RATIO = 0.55;

export function safeBox(W: number, H: number): FitBox {
  return {
    x: Math.round(W * SAFE.x), y: Math.round(H * SAFE.y),
    w: Math.round(W * (1 - 2 * SAFE.x)), h: Math.round(H * (1 - 2 * SAFE.y)),
  };
}

export function wrapLines(text: string, fs: number, weight: number, colWidth: number): { text: string; width: number }[] {
  const space = spaceWidth(fs, weight);
  const words = text.replace(/\*/g, "").split(/\s+/).filter(Boolean);
  const lines: { text: string; width: number }[] = [];
  let lineWords: string[] = [];
  let lineWidth = 0;
  const flush = () => {
    if (lineWords.length) lines.push({ text: lineWords.join(" "), width: lineWidth });
    lineWords = [];
    lineWidth = 0;
  };
  for (const w of words) {
    const ww = measureText(w, fs, weight);
    if (lineWords.length > 0 && lineWidth + space + ww > colWidth) flush();
    lineWords.push(w);
    lineWidth += (lineWords.length > 1 ? space : 0) + ww;
  }
  flush();
  return lines;
}

/** Fit `text` into a box (width AND height, px): wrap at `startPx`, shrink
 * until it fits `boxH` and no line exceeds `boxW`, never below `floorPx`. */
export function fitTextToBox(
  text: string, boxW: number, boxH: number, weight: number,
  startPx: number, floorPx: number, lineHeightRatio = LINE_H_BODY,
): FitResult {
  const maxLineWidth = (ls: { width: number }[]) => ls.reduce((m, l) => Math.max(m, l.width), 0);
  let fs = Math.max(floorPx, Math.round(startPx));
  let lines = wrapLines(text, fs, weight, boxW);
  let lineH = fs * lineHeightRatio;
  let totalH = lines.length * lineH;
  while ((totalH > boxH || maxLineWidth(lines) > boxW) && fs > floorPx) {
    fs = Math.max(floorPx, Math.min(fs - 1, Math.round(fs * _FONT_SCALE_SHRINK_STEP)));
    lines = wrapLines(text, fs, weight, boxW);
    lineH = fs * lineHeightRatio;
    totalH = lines.length * lineH;
  }
  return { fs, lineH, lines, totalH, fits: totalH <= boxH && maxLineWidth(lines) <= boxW };
}

/** Legacy frame-fraction fitter — kept behavior-identical for the
 * `buildBeatGroup` path. See the file header. */
export function fitWrappedLines(text: string, W: number, H: number, weight: number, fontScaleStart: number, availHFrac = 0.86) {
  const margin = Math.round(W * 0.1);
  const colWidth = W - margin * 2;
  const availH = H * availHFrac;
  const floorScale = fontScaleStart * _FONT_SCALE_FLOOR_RATIO;
  const maxLineWidth = (ls: { width: number }[]) => ls.reduce((m, l) => Math.max(m, l.width), 0);

  let fontScale = fontScaleStart;
  let fs = Math.round(W * fontScale);
  let lines = wrapLines(text, fs, weight, colWidth);
  let lineH = fs * 1.3;
  let totalH = lines.length * lineH;

  while ((totalH > availH || maxLineWidth(lines) > colWidth) && fontScale > floorScale) {
    fontScale = Math.max(floorScale, fontScale * _FONT_SCALE_SHRINK_STEP);
    fs = Math.round(W * fontScale);
    lines = wrapLines(text, fs, weight, colWidth);
    lineH = fs * 1.3;
    totalH = lines.length * lineH;
  }
  return { fs, lines, lineH, totalH };
}

// ── P4 · N-role measured stacker ────────────────────────────────────────────
// Generalises stat-figure's two-block "measure both, stack without collision"
// math into N roles (kicker/heading/body, …) for editorial-lede.

export interface StackBlock {
  text?: string;
  tier: TierName;
  weight?: number;
  color?: ColorOKLCH;
  maxWFrac?: number;   // fraction of `safe.w` this block wraps to (default 1)
}

export interface StackedBlock {
  fit: FitResult;
  box: FitBox;
  color?: ColorOKLCH;
  weight?: number;
  tracking?: number;
}

/** Stack text blocks vertically by MEASURED height, centered in `safe`.
 * Blocks with no `text` (e.g. an absent kicker) are skipped entirely rather
 * than leaving a gap. */
export function stackByHeight(safe: FitBox, W: number, H: number, blocks: StackBlock[]): StackedBlock[] {
  const measured = blocks
    .filter((b) => !!b.text && b.text.trim().length > 0)
    .map((b) => {
      const boxW = Math.round(safe.w * (b.maxWFrac ?? 1));
      const fs = tierPx(b.tier, W, H);
      const floor = tierFloorPx(b.tier, W, H);
      const fit = fitTextToBox(b.text!, boxW, safe.h, b.weight ?? 600, fs, floor, LINE_H_BODY);
      const gap = Math.round(fs * 0.5);
      return { b, fit, boxW, gap };
    });

  let totalH = 0;
  measured.forEach((m, idx) => {
    totalH += m.fit.totalH;
    if (idx < measured.length - 1) totalH += m.gap;
  });

  let y = Math.round(safe.y + Math.max(0, (safe.h - totalH) / 2));
  return measured.map((m) => {
    const box: FitBox = { x: safe.x, y, w: m.boxW, h: m.fit.totalH };
    y += m.fit.totalH + m.gap;
    return { fit: m.fit, box, color: m.b.color, weight: m.b.weight, tracking: tierTracking(m.b.tier, m.fit.fs) };
  });
}

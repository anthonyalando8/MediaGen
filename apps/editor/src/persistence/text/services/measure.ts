// apps/editor/src/persistence/text/services/measure.ts
//
// P0 · Single source of glyph measurement. Lifted verbatim from
// scene-import.ts so every representation (and both former pipelines) measure
// identically — no drift possible. Inter is loaded by the editor's theme.css
// by import time; the estimate fallback only fires under SSR/tests.

let _measureCtx: CanvasRenderingContext2D | null | undefined;

function measureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx !== undefined) return _measureCtx;
  try {
    _measureCtx = document.createElement("canvas").getContext("2d");
  } catch {
    _measureCtx = null;
  }
  return _measureCtx;
}

/** Real glyph-advance width for `text` at the given size + weight. */
export function measureText(text: string, fontSize: number, weight: number): number {
  const ctx = measureCtx();
  if (!ctx) return text.length * fontSize * (weight >= 600 ? 0.56 : 0.52);
  ctx.font = `${weight} ${fontSize}px Inter, system-ui, sans-serif`;
  return ctx.measureText(text).width;
}

/** Width of a single space in the given font (measured, not guessed). */
export function spaceWidth(fontSize: number, weight: number): number {
  return Math.max(fontSize * 0.22, measureText("a a", fontSize, weight) - measureText("aa", fontSize, weight));
}

/** Normalize a token for matching body words against word_times. */
export function normWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']/gi, "");
}

// apps/editor/src/persistence/text/services/timing.ts
//
// P0 · Turns beat-relative `in`/`out` (ms) and `word_times` into absolute
// frame windows. The word-matching pointer logic is lifted verbatim from
// buildBeatGroup's body block so word-caption keeps identical sync.

import type { SceneLayer, SceneWordTime } from "../scene-types";
import { normWord } from "./measure";

export interface Window { start: number; dur: number; end: number; }

/** A layer's absolute frame window, clamped to at least 1 frame.
 * `out: null` runs to the end of the (linger-extended) beat. */
export function layerWindow(layer: SceneLayer, startFrame: number, durationFrames: number, fps: number): Window {
  const start = startFrame + Math.round(((layer.in ?? 0) / 1000) * fps);
  const end = layer.out != null ? startFrame + Math.round((layer.out / 1000) * fps) : startFrame + durationFrames;
  return { start, end, dur: Math.max(1, end - start) };
}

/** Evenly-staggered sub-window for item `idx` of `total`, inside `win`. Same
 * stagger cadence numbered-list/chat-bubbles already computed inline,
 * extracted so the per-item P4 representations (stat-band, anaphora-stack,
 * meta-chips, index-entry) share one definition. */
export function staggerWindow(win: Window, idx: number, total: number): Window {
  const staggerF = Math.min(8, Math.max(3, Math.round(win.dur / (total + 2))));
  const start = win.start + idx * staggerF;
  const end = win.end || win.start + win.dur;
  return { start, end, dur: Math.max(1, end - start) };
}

export interface WordTiming {
  text: string;
  emphasis: boolean;
  startAbs?: number;
  endAbs?: number;
}

/** Match display words against `word_times` by advancing a pointer (skipping
 * spillover), returning absolute enter/exit frames per word. Same algorithm
 * as buildBeatGroup — identical caption sync. */
export function matchWordTimes(
  words: { text: string; emphasis: boolean }[],
  wordTimes: SceneWordTime[] | undefined,
  emphasisWords: SceneWordTime[] | undefined,
  startFrame: number,
  fps: number,
): WordTiming[] {
  const wt = wordTimes ?? [];
  let wtPtr = 0;
  const emphasisSet = new Set((emphasisWords ?? []).map((e) => normWord(e.text)));
  const out: WordTiming[] = [];
  for (const dw of words) {
    const norm = normWord(dw.text);
    let startAbs: number | undefined;
    let endAbs: number | undefined;
    for (let p = wtPtr; p < wt.length; p++) {
      if (normWord(wt[p].text) === norm) {
        startAbs = startFrame + Math.round(wt[p].start_s * fps);
        endAbs = startFrame + Math.round(wt[p].end_s * fps);
        wtPtr = p + 1;
        break;
      }
    }
    out.push({ text: dw.text, emphasis: dw.emphasis || emphasisSet.has(norm), startAbs, endAbs });
  }
  return out;
}

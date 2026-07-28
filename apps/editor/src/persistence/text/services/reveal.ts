// apps/editor/src/persistence/text/services/reveal.ts
//
// P0 · Reveals as composable channel-key builders. Each returns the exact
// `*Keys` / `fillChannel` shapes `textNode` already consumes, so a
// representation composes an entrance by combining these instead of
// hand-writing keyframes. The keyframe *values* are lifted verbatim from
// scene-import.ts so existing reveals are byte-identical.
//
// EASE_OUT + eased() live here because every node factory eases its keys
// through them; nodes.ts imports from this file.

import type { ColorOKLCH } from "core";

export const EASE_OUT = { outHandle: [0, 0] as [number, number], inHandle: [0.58, 1] as [number, number] };

/** All-but-last key eases (bezier); the terminal key keeps "linear" by
 * convention (its outgoing segment is never sampled). */
export function eased<T extends { frame: number }>(keys: T[]): (T & { interp: "bezier" | "linear" })[] {
  return keys.map((k, i) => ({ ...k, interp: i < keys.length - 1 ? ("bezier" as const) : ("linear" as const) }));
}

// ── Position / opacity / scale key builders ────────────────────────────────

/** Rise-and-fade-in entrance (the HUD/keyword/line entrance pattern). */
export function fadeRise(start: number, entF: number, x: number, y: number, rise: number) {
  return {
    posKeys: [
      { frame: start, value: { x, y: y + rise, z: 0 } },
      { frame: start + entF, value: { x, y, z: 0 } },
    ],
    opacityKeys: [
      { frame: start, value: 0 },
      { frame: start + entF, value: 1 },
    ],
  };
}

/** Plain fade-in with no move. */
export function fadeIn(start: number, entF: number) {
  return { opacityKeys: [{ frame: start, value: 0 }, { frame: start + entF, value: 1 }] };
}

/** Keyword scale settle (0.94 → 1). */
export function scaleSettle(start: number, entF: number) {
  return { scaleKeys: [{ frame: start, value: { x: 0.94, y: 0.94 } }, { frame: start + entF, value: { x: 1, y: 1 } }] };
}

/** Kinetic per-line pop with a bounce (kinetic_type). */
export function popBounce(lineStart: number, popF: number) {
  return {
    scaleKeys: [
      { frame: lineStart, value: { x: 0.7, y: 0.7 } },
      { frame: lineStart + popF, value: { x: 1.08, y: 1.08 } },
      { frame: lineStart + popF + 4, value: { x: 1, y: 1 } },
    ],
    opacityKeys: [
      { frame: lineStart, value: 0 },
      { frame: lineStart + Math.max(1, Math.round(popF * 0.4)), value: 1 },
    ],
  };
}

// ── Word-sync reveals (caption / karaoke) ──────────────────────────────────

/** Spoken-word colour flash: fg → spike → fg, timed to the word. */
export function wordHighlight(startAbs: number, endAbs: number, fg: ColorOKLCH, spike: ColorOKLCH) {
  return {
    fillChannel: {
      keys: [
        { frame: startAbs, value: fg },
        { frame: startAbs + 2, value: spike },
        { frame: Math.max(startAbs + 3, endAbs), value: fg },
      ],
    },
  };
}

/** Dim-until-spoken opacity reveal (past words stay readable at full). */
export function wordReveal(beatStart: number, startAbs: number) {
  return {
    opacityKeys: [
      { frame: beatStart, value: 0.45 },
      { frame: Math.max(beatStart, startAbs - 1), value: 0.45 },
      { frame: startAbs + 2, value: 1 },
    ],
  };
}

/** Emphasis-word scale pop as it lands. */
export function emphasisPop(startAbs: number) {
  return {
    scaleKeys: [
      { frame: startAbs, value: { x: 1, y: 1 } },
      { frame: startAbs + 2, value: { x: 1.08, y: 1.08 } },
      { frame: startAbs + 9, value: { x: 1, y: 1 } },
    ],
  };
}

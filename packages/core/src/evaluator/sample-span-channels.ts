// packages/core/src/evaluator/sample-span-channels.ts
//
// Evaluates per-span animation channels for a single TextSpan at a given
// frame, returning the animated scalar overrides that layout() should apply
// to the GlyphRun.
//
// FILL MODE — what happens outside the animation window:
//
//   "none"      → outside the window the span uses static defaults (opacity 1,
//                 offsets 0). The animation resets after it completes.
//   "forwards"  → after the window ends, hold the LAST keyframe value.
//                 DEFAULT — a fade-in stays visible, a slide-in stays in place.
//   "backwards" → before the window starts, hold the FIRST keyframe value.
//                 Useful when key[0] = opacity:0 so the span is pre-hidden.
//   "both"      → forwards after + backwards before.
//
// Span-local time: channels are keyframed relative to the span's own start
// (localFrame 0 = composition frame span.time.start), so presets are
// authored once and reusable regardless of when a span is placed.

import type { Frame } from "../types/ids";
import type { TextSpan } from "../types/text-span";
import type { FillMode } from "../types/text-span";
import type { ColorOKLCH } from "../types/primitives";
import { sampleChannel } from "./sample-channels";

export interface SampledSpan {
  opacity: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  color?: ColorOKLCH;
}

/** Static defaults — what a span looks like with no animation applied. */
const DEFAULTS: SampledSpan = { opacity: 1, offsetX: 0, offsetY: 0, scale: 1 };

/** Apply one channel's sampled value into a SampledSpan result object. */
function applyChannel(result: SampledSpan, path: string, value: unknown): void {
  switch (path) {
    case "opacity": result.opacity = value as number; break;
    case "offsetX": result.offsetX = value as number; break;
    case "offsetY": result.offsetY = value as number; break;
    case "scale":   result.scale   = value as number; break;
    case "color":   result.color   = value as ColorOKLCH; break;
  }
}

export function sampleSpanChannels(span: TextSpan, frame: Frame): SampledSpan {
  const result: SampledSpan = { ...DEFAULTS };

  if (!span.time) {
    // No time window — span is always active, sample channels at absolute frame.
    if (span.channels?.length) {
      for (const ch of span.channels) {
        applyChannel(result, ch.path, sampleChannel(ch, frame));
      }
    }
    return result;
  }

  const { start, duration, fillMode = "forwards" } = span.time;
  const end = start + duration;
  const localFrame = (frame - start) as Frame;

  // ── Before the window ────────────────────────────────────────────────
  if (frame < start) {
    if (fillMode === "backwards" || fillMode === "both") {
      // Hold FIRST keyframe value (localFrame 0)
      if (span.channels?.length) {
        for (const ch of span.channels) {
          applyChannel(result, ch.path, sampleChannel(ch, 0 as Frame));
        }
      }
    } else {
      // "none" or "forwards" before window — static defaults, but
      // if the first keyframe starts at opacity:0 we still want to hide.
      // For "none"/"forwards": return defaults (span is fully visible pre-entry
      // unless the author explicitly wants "backwards").
    }
    return result;
  }

  // ── After the window ─────────────────────────────────────────────────
  if (frame >= end) {
    if (fillMode === "forwards" || fillMode === "both") {
      // Hold LAST keyframe value. Keyframes are authored at span-local frames
      // 0..durationF. Passing `duration` clamps to the last key via
      // interpolate()'s beyond-last-key behaviour (returns the last value).
      if (span.channels?.length) {
        for (const ch of span.channels) {
          applyChannel(result, ch.path, sampleChannel(ch, duration as Frame));
        }
      }
    }
    // "none" / "backwards": fall through → return static defaults (resets)
    return result;
  }

  // ── Inside the window — normal sampling ──────────────────────────────
  if (span.channels?.length) {
    for (const ch of span.channels) {
      applyChannel(result, ch.path, sampleChannel(ch, localFrame));
    }
  }
  return result;
}
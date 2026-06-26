// packages/core/src/evaluator/sample-span-channels.ts
//
// Evaluates per-span animation channels for a single TextSpan at a given
// frame, returning the animated scalar overrides that layout() should apply
// to the GlyphRun.
//
// Span channels use the same interpolation engine as node channels — each
// Channel has a `path` that maps to a span-level property:
//   "opacity"  → GlyphRun.opacity  (number 0–1)
//   "offsetX"  → GlyphRun.offsetX  (number px)
//   "offsetY"  → GlyphRun.offsetY  (number px)
//   "scale"    → GlyphRun.scale    (number multiplier)
//   "color"    → GlyphRun.color    (ColorOKLCH)
//
// Time-gating: if the span has a `time` window and `frame` is outside it,
// opacity is 0 regardless of channels (the span is "off"). Inside the window
// channels are sampled relative to the span's start frame so keyframe values
// are authored in span-local time (frame 0 = when the span begins).

import type { Frame } from "../types/ids";
import type { TextSpan } from "../types/text-span";
import type { ColorOKLCH } from "../types/primitives";
import { sampleChannel } from "./sample-channels";

export interface SampledSpan {
  opacity: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  color?: ColorOKLCH;
}

export function sampleSpanChannels(span: TextSpan, frame: Frame): SampledSpan {
  // Time-gate: if this span has a time window and we're outside it, invisible.
  if (span.time) {
    const { start, duration } = span.time;
    if (frame < start || frame >= start + duration) {
      return { opacity: 0, offsetX: 0, offsetY: 0, scale: 1 };
    }
  }

  // Defaults — used when no channel overrides the value.
  const result: SampledSpan = { opacity: 1, offsetX: 0, offsetY: 0, scale: 1 };
  if (!span.channels?.length) return result;

  // Span-local frame: channels are keyframed relative to the span's own start.
  const localFrame = span.time ? (frame - span.time.start) : frame;

  for (const channel of span.channels) {
    // Temporarily set keys to span-local time for sampling
    const sampled = sampleChannel(channel, localFrame as Frame);
    switch (channel.path) {
      case "opacity":  result.opacity  = sampled as number; break;
      case "offsetX":  result.offsetX  = sampled as number; break;
      case "offsetY":  result.offsetY  = sampled as number; break;
      case "scale":    result.scale    = sampled as number; break;
      case "color":    result.color    = sampled as ColorOKLCH; break;
    }
  }
  return result;
}
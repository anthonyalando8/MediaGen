// packages/core/src/types/text-span.ts
//
// Rich text span — a run of characters sharing the same style overrides.
// Multiple spans form a paragraph; line breaks are encoded as "\n" within
// span text (a span can span a line break, splitting into multiple GlyphRuns
// in the layout function).
//
// Design: overrides are OPTIONAL — absent means "inherit from the node's
// own props.fontSize / props.fill / props.fontFamily". This keeps the
// common case (whole-paragraph style) simple: one span with no overrides.
// Backwards-compat: nodes without `props.spans` fall back to `props.text`.

import type { ColorOKLCH } from "./primitives";
import type { Channel } from "./channel";
import type { Frame, Id } from "./ids";

export interface TextSpanTime {
  /** Frame at which this span becomes visible (inclusive). */
  start: Frame;
  /** Duration in frames that this span is visible. */
  duration: Frame;
}

export interface TextSpan {
  /** The text content, may contain "\n" for line breaks. */
  text: string;
  /** Override font weight. 400 = regular, 700 = bold. */
  weight?: number;
  /** Override italic rendering. */
  italic?: boolean;
  /** Override color for just this span. */
  color?: ColorOKLCH;
  /** Override font size for just this span. */
  fontSize?: number;
  /** Override font family for just this span. */
  fontFamily?: string;
  /** Underline decoration. */
  underline?: boolean;
  /**
   * Optional time window for this span. When set, the span is only visible
   * between [start, start+duration). Outside this window opacity=0.
   * When absent the span is always visible (inherits node visibility).
   */
  time?: TextSpanTime;
  /**
   * Per-span animation channels. Path is relative to the span itself:
   *   "opacity"  → number 0–1
   *   "offsetX"  → number px
   *   "offsetY"  → number px
   *   "scale"    → number multiplier
   *   "color"    → ColorOKLCH
   * Sampled by sampleSpanChannels() in the evaluator.
   */
  channels?: Channel[];
  /** Stable identity for timeline display + channel addressing. Auto-assigned. */
  id?: Id;
}
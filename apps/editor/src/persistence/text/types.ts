// apps/editor/src/persistence/text/types.ts
//
// P1 · The one contract every text representation implements.

import type { ColorOKLCH, Node } from "core";
import type { SceneBeat, SceneLayer } from "./scene-types";
import type { FitBox } from "./services/layout";

/** Beat data a representation may read. Used for `fields` gating in the
 * selector — a representation is only eligible when the beat carries what it
 * needs. */
export type FieldName = "keyword" | "body" | "items" | "attribution" | "term" | "brand" | "word_times";

/** Where the representation paints. The compiler uses this only for
 * documentation/telemetry today; composition still owns the frame. */
export type TextRegion = "band" | "full" | "lower" | "corner";

/** The independent selection axis (§06) — how the words should READ,
 * separate from `archetype` (how the frame is COMPOSED). */
export type TextIntent =
  | "caption" | "title" | "quote" | "stat" | "definition" | "list"
  | "dialogue" | "warning" | "comparison" | "qa" | "timeline" | "takeaway"
  | "lower_third" | "emphasis";

/** Normalised, representation-agnostic view of a beat's text content. */
export interface BeatFields {
  keyword?: string;
  body?: string;
  brand?: string;
  term?: string;
  attribution?: string;
  items?: { text: string; label?: string; speaker?: string; side?: string }[];
}

/** What the selector scores against. */
export interface BeatIntent {
  intent?: TextIntent;      // explicit (P2); absent → legacy mapping
  archetype: string;
  reveal?: string;
  size?: "hero" | "normal";
  hasBody: boolean;
  hasWordTimes: boolean;
  hasItems: boolean;
  hasAttribution: boolean;
  textLayerCount: number;
}

/** Everything a representation needs to emit its Node[]. */
export interface TextBuildContext {
  beat: SceneBeat;
  archetype: string;
  /** role === "text" layers on the beat, in order. */
  textLayers: SceneLayer[];
  fields: BeatFields;
  frame: { W: number; H: number; fps: number };
  time: { startFrame: number; durationFrames: number };
  palette: { accent: ColorOKLCH; spike: ColorOKLCH; fg: ColorOKLCH };
  /** Resolved text fill (respects accent_override). */
  fill: ColorOKLCH;
  /** Title-safe box for the frame. */
  safe: FitBox;
}

export interface TextRepresentation {
  /** Stable id — referenced by the selector and by `beat.text_intent`. */
  id: string;
  /** Beat fields this representation requires to render. */
  fields: FieldName[];
  region: TextRegion;
  /** Affinity 0..1 for a given intent — higher wins. */
  supports(intent: BeatIntent): number;
  /** Emit the text-region nodes. MUST use shared services only. */
  build(ctx: TextBuildContext): Node[];
}

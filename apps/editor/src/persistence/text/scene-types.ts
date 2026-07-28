// apps/editor/src/persistence/text/scene-types.ts
//
// The scene.json shapes the text pipeline reads. These are LIFTED from
// scene-import.ts so the text/ modules and the compiler share one definition
// instead of duplicating it. During integration, delete the duplicated
// interfaces from scene-import.ts and import them from here.
//
// `items` / `attribution` / `term` on SceneLayer are ADDITIVE (P3) — they are
// only read by the new representations (numbered-list, chat-bubbles,
// definition-card, comparison-labels). Every existing scene omits them and is
// unaffected.

export interface SceneWordTime {
  text: string;
  start_s: number;
  end_s: number;
  tier?: number;
}

export interface SceneLayerSource {
  query?: string;
  kind?: "image" | "video";
}

/** A structured item for list/dialogue/comparison representations (P3). */
export interface SceneTextItem {
  text: string;
  label?: string;    // numbered-list marker override, stat label, etc.
  speaker?: string;  // chat-bubbles / dialogue
  side?: "a" | "b";  // comparison / before-after / pros-cons
}

export interface SceneLayer {
  role: "background" | "foreground" | "scrim" | "text" | "shape" | "icon" | "overlay" | "lower_third";
  source?: SceneLayerSource;
  fit?: "cover" | "contain" | "fill";
  slot?: "left" | "right" | "top" | "bottom" | "pip";
  shape?: string;
  opacity?: number;
  text?: string;
  reveal?: string;
  size?: "hero" | "normal";
  anchor_y?: number;
  asset_id?: string;
  kind?: "image" | "video";
  in: number;
  out: number | null;

  // ── P3 additive: structured text ─────────────────────────────────────
  items?: SceneTextItem[];   // numbered-list, chat-bubbles, comparison
  attribution?: string;      // pull-quote / testimonial / tweet
  term?: string;             // definition-card headword (falls back to keyword)
}

export interface SceneVisual {
  asset_id?: string;
  kind?: "image" | "video";
  role?: string;
  fit?: "cover" | "contain" | "fill";
  opacity?: number;
  relevance?: number;
  query?: string;
  alternatives?: string[];
}

export interface SceneBeat {
  id?: string;
  hud_tag?: string;
  keyword?: string;
  body?: string;
  duration_ms?: number;
  accent_override?: string | null;
  layout?: string;
  word_times?: SceneWordTime[];
  emphasis_times?: SceneWordTime[];
  visual?: SceneVisual;
  audio?: { asset_id?: string };
  transition?: string;
  entry_vector?: { x: number; y: number; scale: number };
  camera?: string;
  background?: string;
  pattern_interrupt?: string | null;
  intensity?: number;
  archetype?: string;
  layers?: SceneLayer[];

  // ── P2 additive: the text-representation selection axis ───────────────
  // Independent of `archetype` (composition). Absent → the selector falls
  // back to the exact legacy archetype/reveal mapping (parity).
  text_intent?: string;
}

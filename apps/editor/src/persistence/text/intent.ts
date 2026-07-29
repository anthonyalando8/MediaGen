// apps/editor/src/persistence/text/intent.ts
//
// P1/P2 · Normalise a beat into (a) a BeatIntent the selector scores and
// (b) BeatFields a representation reads. Keeps every representation free of
// raw scene.json shape-poking.

import type { SceneBeat, SceneLayer } from "./scene-types";
import type { BeatFields, BeatIntent, TextIntent } from "./types";

const TEXT_INTENTS = new Set<TextIntent>([
  "caption", "title", "quote", "stat", "definition", "list",
  "dialogue", "warning", "comparison", "qa", "timeline", "takeaway",
  "lower_third", "emphasis",
  "meta",
]);

export function intentOf(beat: SceneBeat, archetype: string, textLayers: SceneLayer[]): BeatIntent {
  const explicit = beat.text_intent && TEXT_INTENTS.has(beat.text_intent as TextIntent)
    ? (beat.text_intent as TextIntent)
    : undefined;
  const anyItems = textLayers.some((l) => (l.items?.length ?? 0) > 0);
  const anyAttribution = textLayers.some((l) => !!l.attribution) || !!beat.layers?.some((l) => !!l.attribution);
  return {
    intent: explicit,
    archetype,
    reveal: textLayers[0]?.reveal,
    size: textLayers.some((l) => l.size === "hero") ? "hero" : "normal",
    hasBody: !!(beat.body && beat.body.trim()),
    hasWordTimes: (beat.word_times?.length ?? 0) > 0,
    hasItems: anyItems,
    hasAttribution: anyAttribution,
    hasAccentSpan: !!(beat.accent_span && beat.accent_span.trim()),
    textLayerCount: textLayers.length,
  };
}

export function fieldsOf(beat: SceneBeat, textLayers: SceneLayer[]): BeatFields {
  const withItems = textLayers.find((l) => (l.items?.length ?? 0) > 0);
  const withAttr = textLayers.find((l) => !!l.attribution);
  const withTerm = textLayers.find((l) => !!l.term);
  return {
    keyword: beat.keyword,
    body: beat.body,
    brand: undefined, // brand is emitted by the compiler, not a representation
    term: withTerm?.term ?? beat.keyword,
    attribution: withAttr?.attribution,
    items: withItems?.items,
  };
}

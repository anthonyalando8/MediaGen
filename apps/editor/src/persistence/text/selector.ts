// apps/editor/src/persistence/text/selector.ts
//
// P1/P2 · Pick ONE representation for a beat's text region.
//
//   • When the beat carries an explicit `text_intent` (P2), score the whole
//     library via `supports()`, keep only representations whose required
//     `fields` are present, and honour a variety guard.
//   • When it doesn't, fall back to the EXACT legacy archetype/reveal mapping
//     so pre-P2 scenes render byte-identically.
//
// The selector never hard-codes a representation's behaviour — only ids.

import * as registry from "./registry";
import type { BeatFields, BeatIntent, TextRepresentation } from "./types";

/** Legacy archetype/reveal → representation id, reproducing today's routing
 * in buildBeatGroupFromLayers exactly. */
export function legacyRepresentationId(i: BeatIntent): string {
  if (i.reveal === "kinetic") return "kinetic-lines";
  if ((i.archetype === "stat_callout" || i.archetype === "poster_card") && i.textLayerCount >= 2) return "stat-figure";
  if (i.archetype === "lower_third") return "lower-third";
  if (i.archetype === "text_over_dimmed") return "word-caption";
  return i.size === "hero" ? "hero-title" : "pull-quote";
}

function hasFields(rep: TextRepresentation, fields: BeatFields, i: BeatIntent): boolean {
  return rep.fields.every((f) => {
    switch (f) {
      case "keyword": return !!fields.keyword;
      case "body": return i.hasBody;
      case "items": return i.hasItems;
      case "attribution": return i.hasAttribution;
      case "term": return !!fields.term;
      case "word_times": return i.hasWordTimes;
      case "brand": return true;
      default: return true;
    }
  });
}

export interface SelectOpts {
  fields: BeatFields;
  /** Recently-chosen ids (most recent last) for the variety guard. */
  used?: string[];
  maxConsecutive?: number;
}

export function select(i: BeatIntent, opts: SelectOpts): TextRepresentation | undefined {
  if (i.intent) {
    const ranked = registry.list()
      .filter((r) => hasFields(r, opts.fields, i))
      .map((r) => [r, r.supports(i)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1]);
    for (const [r] of ranked) {
      if (!violatesVariety(r.id, opts)) return r;
    }
    if (ranked.length) return ranked[0][0]; // variety is a preference, not a hard stop
  }
  // Fallback: exact legacy routing.
  const legacy = registry.get(legacyRepresentationId(i));
  if (legacy) return legacy;
  return registry.get("pull-quote");
}

function violatesVariety(id: string, opts: SelectOpts): boolean {
  const max = opts.maxConsecutive ?? 2;
  const used = opts.used ?? [];
  if (used.length < max) return false;
  const tail = used.slice(-max);
  return tail.every((u) => u === id);
}

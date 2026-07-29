// apps/editor/src/persistence/text/index.ts
//
// Barrel + registration side-effects. Importing this module registers every
// representation exactly once (registry.register throws on a dup, so a double
// import is caught, not silently doubled). The compiler imports this once.
//
// ADDING A REPRESENTATION = create representations/<id>.ts (call register at
// module scope) and add one import line here. Nothing else changes.

import "./representations/word-caption";
import "./representations/hero-title";
import "./representations/pull-quote";
import "./representations/stat-figure";
import "./representations/kinetic-lines";
import "./representations/lower-third";
// ── P3 library ─────────────────────────────────────────────────────────────
import "./representations/definition-card";
import "./representations/numbered-list";
import "./representations/chat-bubbles";
import "./representations/comparison-labels";
// ── P4 library (read off a real reference) ────────────────────────────────
import "./representations/accent-headline";
import "./representations/stat-band";
import "./representations/editorial-lede";
import "./representations/anaphora-stack";
import "./representations/index-entry";
import "./representations/meta-chips";
import "./representations/image-kicker";

export * as registry from "./registry";
export { select, legacyRepresentationId } from "./selector";
export { intentOf, fieldsOf } from "./intent";
export { buildTextRegion } from "./build-text-region";
export type { TextRepresentation, TextBuildContext, BeatIntent, TextIntent } from "./types";

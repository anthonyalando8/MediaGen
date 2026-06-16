// packages/core/src/types/exposed.ts
//
// Phase 2 §4.3 — the override mechanism for precomp instances. A
// `Composition` declares which of its inner nodes' props can be overridden
// per-INSTANCE (`Composition.exposed[]`); a `comp` node instancing it
// supplies overrides keyed by `PropBinding.key` on its OWN `props` (e.g.
// `compNode.props = { "title": "Q3 Results" }`). `applyExposed`
// (evaluator/precomp.ts, P2) reads `exposed[]` + the instance's `props` and
// writes each binding's `target` path into the resolved inner node before
// evaluating it.

import type { Id } from "./ids";

export interface PropBinding {
  /** The key an instance's `props` uses to supply an override — e.g. `compNode.props["title"]`. */
  key: string;
  /** Display label in the instance's inspector (effect-stack-style auto-generated UI, §6's "the inspector is free"). */
  label: string;
  /** Which inner node/prop this binding drives once resolved. */
  target: { nodeId: Id; path: string };
  type: "scalar" | "color" | "text" | "asset";
}
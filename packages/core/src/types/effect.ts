// packages/core/src/types/effect.ts
//
// Phase 2 §4.1 — a reference to an effect/transition registered in the
// `effects` package (packages/effects/src/registry.ts, P2), plus its
// (optionally channelizable) parameters. `core` never imports `effects` —
// this is just the data shape a `Node.effects[]` entry carries; the
// `effects` package and `renderer-webgl/passes` give `effect`/`preset`
// meaning at render time.

import type { Channel } from "./channel";
import type { Frame, Id } from "./ids";
import type { Scalar } from "./node";

/** One effect applied to a node — `Node.effects[]`, ordered (stacking order = render order). */
export interface EffectRef {
  id: Id;
  /** EffectRegistry key, e.g. "blur" | "grade" | "glow". */
  effect: string;
  enabled: boolean;
  /** Static uniform values, by the effect's own param name. */
  props: Record<string, Scalar>;
  /** Animated uniforms — `channel.path` convention: `"fx.<ref.id>.<prop>"`. */
  channels?: Channel[];
}

/**
 * Spans the boundary between two siblings in z-order — `Node.transitionIn`/
 * `transitionOut` (one node "transitions in" as the previous one
 * "transitions out", same `durationF` window).
 */
export interface TransitionRef {
  /** TransitionRegistry key, e.g. "slam" | "whip" | "dip" | "wipe". */
  preset: string;
  durationF: Frame;
  props: Record<string, Scalar>;
}
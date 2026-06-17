// packages/core/src/evaluator/sample-effects.ts
//
// Phase 2 §7's pseudocode: "node.effects -> PassSpec{ kind:"effect",
// ref:effect, uniforms:sampled }". Mirrors sample-channels.ts's "static ⊕
// channels" pattern, but for an EffectRef's `props`/`channels` instead of
// a Node's — kept SEPARATE from sampleChannels rather than generalizing it,
// because an effect's channel paths use a different namespace convention
// ("fx.<ref.id>.<prop>" — EffectRef's doc, types/effect.ts) than a node's
// own channels ("props.<key>" directly): trying to share one function
// across both would mean threading a path-prefix-stripping parameter
// through sampleChannels for a single Phase 2 caller, for no real benefit.

import type { EffectRef } from "../types/effect";
import type { Scalar } from "../types/node";
import type { Frame } from "../types/ids";
import { sampleChannel } from "./sample-channels";

/**
 * Returns `ref.props` with every channel in `ref.channels` (if any) whose
 * path is "fx.<ref.id>.<prop>" sampled at `frame` and written over the
 * corresponding prop — i.e. the per-effect equivalent of
 * `sampleChannels(node, frame)`. The PREFIX ("fx.<ref.id>.") is stripped
 * to get the bare prop key.
 */
export function sampleEffectProps(ref: EffectRef, frame: Frame): Record<string, Scalar> {
  const sampled: Record<string, Scalar> = { ...ref.props };
  const prefix = `fx.${ref.id}.`;

  for (const channel of ref.channels ?? []) {
    if (!channel.path.startsWith(prefix)) continue; // not this effect's channel — e.g. belongs to a sibling node entirely, defensively ignored rather than throwing.
    const key = channel.path.slice(prefix.length);
    sampled[key] = sampleChannel(channel, frame) as unknown as Scalar;
  }

  return sampled;
}

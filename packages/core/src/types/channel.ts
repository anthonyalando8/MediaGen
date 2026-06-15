// packages/core/src/types/channel.ts
import type { Json } from "./primitives";
import type { Id } from "./ids";
import type { ChannelValue, Keyframe } from "./keyframe";

export type ChannelType = "scalar" | "vec2" | "vec3" | "color" | "angle" | "path";

/**
 * A path-addressed, typed animation curve. `path` is a dotted path into the
 * node's sampled value (e.g. "transform.scale", "opacity", "props.fontSize").
 *
 * Invariant: `keys` is sorted ascending by `frame`.
 */
export interface Channel<V = ChannelValue> {
  id: Id;
  path: string;
  type: ChannelType;
  additive?: boolean;
  keys: Keyframe<V>[];
  /** P2 — springs/noise; bakes to keys for deterministic export. */
  generator?: { id: string; params: Json; baked: boolean };
}

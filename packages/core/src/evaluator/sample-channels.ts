// packages/core/src/evaluator/sample-channels.ts
//
// "Apply each channel onto a clone of the node's static values at frame"
// (Deliverable 07). Channels are path-addressed by a dotted path into the
// node's static fields ("transform.scale", "opacity", "props.fontSize").
// In Phase 1, every channel path is at most two segments deep — the second
// segment selects a whole ChannelValue-typed field (a Vec2/Vec3/ColorOKLCH/
// number), never a component of one.

import type { ChannelValue } from "../types/keyframe";
import type { Channel } from "../types/channel";
import type { Node, Scalar } from "../types/node";
import type { Transform } from "../types/transform";
import type { Frame } from "../types/ids";
import { interpolate } from "./interpolate";

export type SampledNode = Pick<Node, "transform" | "opacity" | "props">;

/** Samples a single channel at `frame`. Thin wrapper over `interpolate`. */
export function sampleChannel<V extends ChannelValue>(channel: Channel<V>, frame: Frame): V {
  return interpolate(channel, frame);
}

/**
 * Writes `value` at `path` (e.g. "transform.scale", "opacity", "props.fill")
 * within `target`, replacing whatever was at that path.
 */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (next === null || typeof next !== "object") {
      throw new Error(`channel path "${path}" traverses through a non-object at "${parts[i]}"`);
    }
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Returns a clone of `node`'s `transform`/`opacity`/`props` with every
 * channel in `node.channels` sampled at `frame` and written over the
 * corresponding static field. Spread this onto `node` to get the
 * frame-accurate values: `{ ...node, ...sampleChannels(node, frame) }`.
 */
export function sampleChannels(node: Node, frame: Frame): SampledNode {
  const sampled: { transform: Transform; opacity: number; props: Record<string, Scalar> } = {
    transform: { ...node.transform },
    opacity: node.opacity,
    props: { ...node.props },
  };

  for (const channel of node.channels) {
    setPath(sampled as unknown as Record<string, unknown>, channel.path, sampleChannel(channel, frame));
  }

  return sampled;
}

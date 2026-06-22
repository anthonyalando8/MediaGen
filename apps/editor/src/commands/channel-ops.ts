
// apps/editor/src/commands/channel-ops.ts
//
// Phase 2 §9.2 — curve editor commands. Every edit is a set op on
// channel.keys[] (or channel itself) — undo/redo and persistence come
// free from the op-log exactly as the blueprint specifies.

import { createId, createOp, toFrame } from "core";
import type { Channel, Composition, Id, Json, Op } from "core";
import type { Interp, Keyframe } from "core";
import { findNodeIndex } from "./find-node-index";

function findChannelIndex(node: { channels: Channel[] }, channelId: Id): number {
  const idx = node.channels.findIndex((c) => c.id === channelId);
  if (idx === -1) throw new Error(`channel "${channelId}" not found`);
  return idx;
}

function sortedKeys(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => (a.frame as number) - (b.frame as number));
}

/** Adds a new Channel to node.channels[] — used when applying a motion preset. */
export function addChannelOp(comp: Composition, nodeId: Id, channel: Channel): Op {
  const nodeIdx = findNodeIndex(comp, nodeId);
  const existing = comp.root[nodeIdx].channels;
  const after = [...existing, channel];
  return createOp({
    type: "set", compId: comp.id,
    path: `/root/${nodeIdx}/channels`,
    before: existing as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}

/** Adds a keyframe to an existing channel, keeping keys sorted by frame. */
export function addKeyframeOp(comp: Composition, nodeId: Id, channelId: Id, keyframe: Keyframe): Op {
  const nodeIdx = findNodeIndex(comp, nodeId);
  const channelIdx = findChannelIndex(comp.root[nodeIdx], channelId);
  const channel = comp.root[nodeIdx].channels[channelIdx];
  const after = { ...channel, keys: sortedKeys([...channel.keys, keyframe]) };
  return createOp({
    type: "set", compId: comp.id,
    path: `/root/${nodeIdx}/channels/${channelIdx}`,
    before: channel as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}

/** Moves a keyframe to a new frame position (by index in keys[]). */
export function moveKeyframeOp(comp: Composition, nodeId: Id, channelId: Id, keyIndex: number, newFrame: number): Op {
  const nodeIdx = findNodeIndex(comp, nodeId);
  const channelIdx = findChannelIndex(comp.root[nodeIdx], channelId);
  const channel = comp.root[nodeIdx].channels[channelIdx];
  const newKeys = channel.keys.map((k, i) =>
    i === keyIndex ? { ...k, frame: toFrame(newFrame) } : k
  );
  const after = { ...channel, keys: sortedKeys(newKeys) };
  return createOp({
    type: "set", compId: comp.id,
    path: `/root/${nodeIdx}/channels/${channelIdx}`,
    before: channel as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}

/** Deletes a keyframe by index. */
export function deleteKeyframeOp(comp: Composition, nodeId: Id, channelId: Id, keyIndex: number): Op {
  const nodeIdx = findNodeIndex(comp, nodeId);
  const channelIdx = findChannelIndex(comp.root[nodeIdx], channelId);
  const channel = comp.root[nodeIdx].channels[channelIdx];
  const after = { ...channel, keys: channel.keys.filter((_, i) => i !== keyIndex) };
  return createOp({
    type: "set", compId: comp.id,
    path: `/root/${nodeIdx}/channels/${channelIdx}`,
    before: channel as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}

/** Sets bezier handles on a keyframe. */
export function setKeyframeHandlesOp(
  comp: Composition, nodeId: Id, channelId: Id, keyIndex: number,
  inHandle?: [number, number], outHandle?: [number, number]
): Op {
  const nodeIdx = findNodeIndex(comp, nodeId);
  const channelIdx = findChannelIndex(comp.root[nodeIdx], channelId);
  const channel = comp.root[nodeIdx].channels[channelIdx];
  const newKeys = channel.keys.map((k, i) =>
    i === keyIndex ? { ...k, ...(inHandle ? { inHandle } : {}), ...(outHandle ? { outHandle } : {}) } : k
  );
  const after = { ...channel, keys: newKeys };
  return createOp({
    type: "set", compId: comp.id,
    path: `/root/${nodeIdx}/channels/${channelIdx}`,
    before: channel as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}

/** Easing presets for the curve editor dropdown. */
export const EASING_PRESETS: Record<string, { interp: Interp; outHandle?: [number, number]; inHandle?: [number, number] }> = {
  linear:      { interp: "linear" },
  hold:        { interp: "hold" },
  "ease-in":   { interp: "bezier", outHandle: [0.42, 0.0], inHandle: [1.0, 1.0] },
  "ease-out":  { interp: "bezier", outHandle: [0.0, 0.0], inHandle: [0.58, 1.0] },
  "ease-in-out": { interp: "bezier", outHandle: [0.42, 0.0], inHandle: [0.58, 1.0] },
  "bounce":    { interp: "bezier", outHandle: [0.2, 1.4], inHandle: [0.8, -0.4] },
};

/** Applies an easing preset to a keyframe — sets interp + handles. */
export function applyEasingPresetOp(
  comp: Composition, nodeId: Id, channelId: Id, keyIndex: number, presetName: string
): Op {
  const preset = EASING_PRESETS[presetName];
  if (!preset) throw new Error(`unknown easing preset: "${presetName}"`);
  const nodeIdx = findNodeIndex(comp, nodeId);
  const channelIdx = findChannelIndex(comp.root[nodeIdx], channelId);
  const channel = comp.root[nodeIdx].channels[channelIdx];
  const newKeys = channel.keys.map((k, i) =>
    i === keyIndex ? { ...k, interp: preset.interp, ...(preset.outHandle ? { outHandle: preset.outHandle } : {}), ...(preset.inHandle ? { inHandle: preset.inHandle } : {}) } : k
  );
  const after = { ...channel, keys: newKeys };
  return createOp({
    type: "set", compId: comp.id,
    path: `/root/${nodeIdx}/channels/${channelIdx}`,
    before: channel as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}
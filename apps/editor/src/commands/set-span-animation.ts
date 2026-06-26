// apps/editor/src/commands/set-span-animation.ts
//
// Commands for adding/replacing animation on a single TextSpan.
//
// Design: spans are stored as `props.spans[]`. Animating span[i] means
// replacing the whole spans array with a new one where spans[i] has updated
// `time` and/or `channels`. One undoable op per action.

import { createId, createOp } from "core";
import type { Channel, Composition, Frame, Id, Json, Op } from "core";
import type { TextSpan } from "core";
import { findNodeIndex } from "./find-node-index";

type SpanAnimPreset = "fadeIn" | "slideUp" | "slideDown" | "pop" | "typeOn";

/**
 * Returns keyframe channels for a named animation preset.
 * All durations are in frames; default 15f transition.
 */
export function spanPresetChannels(preset: SpanAnimPreset, durationF = 15): Channel[] {
  const id = () => createId();
  switch (preset) {
    case "fadeIn":
      return [{
        id: id(), path: "opacity", type: "scalar",
        keys: [{ frame: 0 as Frame, value: 0, interp: "bezier" }, { frame: durationF as Frame, value: 1, interp: "linear" }],
      }];
    case "slideUp":
      return [
        {
          id: id(), path: "opacity", type: "scalar",
          keys: [{ frame: 0 as Frame, value: 0, interp: "bezier" }, { frame: durationF as Frame, value: 1, interp: "linear" }],
        },
        {
          id: id(), path: "offsetY", type: "scalar",
          keys: [{ frame: 0 as Frame, value: 40, interp: "bezier" }, { frame: durationF as Frame, value: 0, interp: "linear" }],
        },
      ];
    case "slideDown":
      return [
        {
          id: id(), path: "opacity", type: "scalar",
          keys: [{ frame: 0 as Frame, value: 0, interp: "bezier" }, { frame: durationF as Frame, value: 1, interp: "linear" }],
        },
        {
          id: id(), path: "offsetY", type: "scalar",
          keys: [{ frame: 0 as Frame, value: -40, interp: "bezier" }, { frame: durationF as Frame, value: 0, interp: "linear" }],
        },
      ];
    case "pop":
      return [
        {
          id: id(), path: "scale", type: "scalar",
          keys: [
            { frame: 0 as Frame, value: 0, interp: "bezier" },
            { frame: Math.round(durationF * 0.6) as Frame, value: 1.2, interp: "bezier" },
            { frame: durationF as Frame, value: 1, interp: "linear" },
          ],
        },
        {
          id: id(), path: "opacity", type: "scalar",
          keys: [{ frame: 0 as Frame, value: 0, interp: "bezier" }, { frame: Math.round(durationF * 0.4) as Frame, value: 1, interp: "linear" }],
        },
      ];
    case "typeOn":
      // TypeOn: each span fades in quickly (simulates typing)
      return [{
        id: id(), path: "opacity", type: "scalar",
        keys: [{ frame: 0 as Frame, value: 0, interp: "linear" }, { frame: 3 as Frame, value: 1, interp: "linear" }],
      }];
  }
}

/** Set or replace all channels on span[spanIndex]. */
export function setSpanChannelsOp(
  comp: Composition,
  nodeId: Id,
  spanIndex: number,
  channels: Channel[],
): Op {
  const idx = findNodeIndex(comp, nodeId);
  const node = comp.root[idx];
  const spans: TextSpan[] = ((node.props.spans as unknown as TextSpan[]) ?? []).map((s, i) =>
    i === spanIndex ? { ...s, channels } : s
  );
  const before = node.props as unknown as Json;
  const after = { ...(node.props as object), spans } as unknown as Json;
  return createOp({ type: "set", compId: comp.id, path: `/root/${idx}/props`, before, after, txn: createId() });
}

/** Set or replace the time window on span[spanIndex]. */
export function setSpanTimeOp(
  comp: Composition,
  nodeId: Id,
  spanIndex: number,
  start: Frame,
  duration: Frame,
  fillMode: "none" | "forwards" | "backwards" | "both" = "forwards",
): Op {
  const idx = findNodeIndex(comp, nodeId);
  const node = comp.root[idx];
  const spans: TextSpan[] = ((node.props.spans as unknown as TextSpan[]) ?? []).map((s, i) =>
    i === spanIndex ? { ...s, time: { start, duration, fillMode } } : s
  );
  const before = node.props as unknown as Json;
  const after = { ...(node.props as object), spans } as unknown as Json;
  return createOp({ type: "set", compId: comp.id, path: `/root/${idx}/props`, before, after, txn: createId() });
}

/** Clear all animation (channels + time) from span[spanIndex]. */
export function clearSpanAnimationOp(
  comp: Composition,
  nodeId: Id,
  spanIndex: number,
): Op {
  const idx = findNodeIndex(comp, nodeId);
  const node = comp.root[idx];
  const spans: TextSpan[] = ((node.props.spans as unknown as TextSpan[]) ?? []).map((s, i) => {
    if (i !== spanIndex) return s;
    const { channels: _c, time: _t, ...rest } = s;
    return rest;
  });
  const before = node.props as unknown as Json;
  const after = { ...(node.props as object), spans } as unknown as Json;
  return createOp({ type: "set", compId: comp.id, path: `/root/${idx}/props`, before, after, txn: createId() });
}
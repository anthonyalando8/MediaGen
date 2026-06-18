// apps/editor/src/commands/move-clip-time.ts
//
// The clip-arrangement timeline's drag commands (new scope — not in the
// Phase 2 blueprint, which only specs a keyframe/curve editor at §9.2;
// see TimelineTrack.tsx's module doc). Mirrors transform-node.ts's
// "current value -> one 'set' Op, called once per gesture on pointer-up"
// pattern exactly: `moveClipOp` changes ONLY `time.start` (a body drag,
// duration fixed), `trimClipOp` changes the WHOLE `time` object at once
// (an edge drag — start AND duration move together as one coherent user
// action / one undo step, same reasoning as scaleNode/rotateNode setting
// the whole `transform` object when position changes alongside scale or
// rotation).

import { createId, createOp } from "core";
import type { Composition, Id, Json, Op, TimeSpan } from "core";
import { findNodeIndex } from "./find-node-index";

/** Moves a clip to a new start frame, keeping its duration fixed — the timeline bar's BODY drag. `newStart` isn't clamped here (negative starts are a valid, if unusual, authoring state — same "don't second-guess the user" stance as moveNode not clamping position). */
export function moveClipOp(comp: Composition, nodeId: Id, newStart: number): Op {
  const index = findNodeIndex(comp, nodeId);
  const time = comp.root[index].time;
  const after: TimeSpan = { ...time, start: newStart as TimeSpan["start"] };
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/time`,
    before: time as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}

/** Sets a clip's start AND duration together as one op — the timeline bar's LEFT/RIGHT EDGE drag (a left-trim changes both; a right-trim changes only duration, but still goes through this same one-op path for a single, consistent commit shape). Duration is floored at 1 frame — a zero/negative-duration clip has no meaningful overlap window and breaks `inSpan`'s `[start, start+duration)` convention. */
export function trimClipOp(comp: Composition, nodeId: Id, newStart: number, newDuration: number): Op {
  const index = findNodeIndex(comp, nodeId);
  const time = comp.root[index].time;
  const duration = Math.max(1, newDuration);
  const after: TimeSpan = { ...time, start: newStart as TimeSpan["start"], duration: duration as TimeSpan["duration"] };
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/time`,
    before: time as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}
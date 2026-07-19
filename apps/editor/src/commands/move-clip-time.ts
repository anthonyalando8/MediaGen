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
//
// ── CHANGE IN THIS REVISION ────────────────────────────────────────────────
// `calcCompDuration` is now AUDIO-AWARE. It previously derived the sequence
// length from `comp.root` (visual clips) only, so audio tracks that ran past
// the last visual clip were outside `comp.duration` — and since preview
// (Viewport's playhead loop), the export frame clock, and the export offline
// audio buffer are ALL bounded by `comp.duration`, that trailing audio was
// silently dropped from both preview and export. Maxing audio-track ends into
// the result makes the sequence always cover the furthest-right thing on the
// timeline (visual OR audio), so an audio-only tail plays as a blank screen +
// audio in preview and exports identically. Backward compatible: with no audio
// tracks the result equals the old visual-only value.

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

/**
 * The minimum `comp.duration` that covers all content — visual clips AND
 * audio tracks — used by the timeline after a move/trim to auto-extend (or
 * shrink) the composition's playback duration so it always matches what's on
 * the timeline. Maxing in audio ends is what lets an audio-only tail past the
 * last visual clip actually play (blank screen + audio) in both preview and
 * export instead of being cut at the visual end. A composition with no content
 * at all returns 1 (never zero — the playback loop and export clock divide by
 * duration).
 *
 * An audio track's end is `endFrame` when set, else `startFrame + 150` — the
 * same 150-frame fallback the audio timeline UI (`trackDurationFrames`) and
 * the export audio scheduler use for an untrimmed clip.
 */
export function calcCompDuration(comp: Composition): number {
  const audioTracks =
    (comp as { audioTracks?: Array<{ startFrame: number; endFrame?: number }> }).audioTracks ?? [];

  const visualEnd = comp.root.length
    ? Math.max(...comp.root.map((n) => (n.time.start as number) + (n.time.duration as number)))
    : 0;
  const audioEnd = audioTracks.length
    ? Math.max(...audioTracks.map((t) => t.endFrame ?? t.startFrame + 150))
    : 0;

  return Math.max(1, visualEnd, audioEnd);
}

/** Sets `comp.duration` directly — emitted after a move/trim op when the new clip end extends beyond (or allows shrinking of) the current comp duration. Fully undoable via the same op-log as every other change. */
export function setCompDurationOp(comp: Composition, newDuration: number): Op {
  return createOp({
    type: "set",
    compId: comp.id,
    path: "/duration",
    before: comp.duration as unknown as Json,
    after: Math.max(1, newDuration) as unknown as Json,
    txn: createId(),
  });
}

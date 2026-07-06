// apps/editor/src/commands/audio-ops.ts
//
// Commands for managing AudioTrack[] on a Composition.
// All follow the standard Op pattern: createOp({ type, path, before, after }).
//
// PATHS
// -----
// `audioTracks` is a top-level array on Composition (alongside `root`).
// The whole array is written as one `set` at `/audioTracks`.
//
// ── CHANGE IN THIS REVISION ────────────────────────────────────────────────
// Added `setAudioTrackPropsOp` — sets MULTIPLE keys on a track in a SINGLE op.
//
// Why: the previous per-key pattern (call setAudioTrackPropOp once per key from
// a single captured store snapshot) was broken for any multi-key edit. Each op
// rewrites the ENTIRE `/audioTracks` array computed from the SAME stale comp,
// so the second apply reverts the first. For a clip MOVE (startFrame+endFrame)
// that meant startFrame snapped back and only endFrame moved — i.e. the clip
// appeared to RESIZE instead of MOVE. One combined op fixes it (and collapses
// a drag-tick to a single undo entry). `setAudioTrackPropOp` is unchanged.

import type { Composition, Id, Json } from "core";
import { createId, createOp } from "core";
import type { AudioTrack } from "core";
import { defaultAudioTrack } from "core";
import type { Op } from "core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function findTrackIndex(comp: Composition, trackId: Id): number {
  const tracks = comp.audioTracks ?? [];
  const idx = tracks.findIndex((t) => t.id === trackId);
  if (idx < 0) throw new Error(`AudioTrack ${trackId} not found`);
  return idx;
}

function getTracks(comp: Composition): AudioTrack[] {
  return comp.audioTracks ?? [];
}

// ── Add audio track ───────────────────────────────────────────────────────────

/**
 * Adds a new AudioTrack to the composition, referencing the given asset.
 * Placed at `startFrame` (default 0).
 */
export function addAudioTrackOp(
  comp: Composition,
  assetId: string,
  name: string,
  startFrame = 0,
): Op {
  const tracks = getTracks(comp);
  const track = defaultAudioTrack(createId(), assetId, name, startFrame);
  const newTracks = [...tracks, track];
  return createOp({
    type:   "set",
    compId: comp.id,
    path:   "/audioTracks",
    before: tracks as unknown as Json,
    after:  newTracks as unknown as Json,
    txn:    createId(),
  });
}

// ── Remove audio track ────────────────────────────────────────────────────────

export function removeAudioTrackOp(comp: Composition, trackId: Id): Op {
  const tracks = getTracks(comp);
  const newTracks = tracks.filter((t) => t.id !== trackId);
  return createOp({
    type:   "set",
    compId: comp.id,
    path:   "/audioTracks",
    before: tracks as unknown as Json,
    after:  newTracks as unknown as Json,
    txn:    createId(),
  });
}

// ── Set a single prop on a track ──────────────────────────────────────────────

export function setAudioTrackPropOp(
  comp: Composition,
  trackId: Id,
  key: keyof AudioTrack,
  value: Json,
): Op {
  const idx    = findTrackIndex(comp, trackId);
  const tracks = getTracks(comp);
  const newTracks = tracks.map((t, i) =>
    i === idx ? { ...t, [key]: value } : t
  );
  return createOp({
    type:   "set",
    compId: comp.id,
    path:   "/audioTracks",
    before: tracks as unknown as Json,
    after:  newTracks as unknown as Json,
    txn:    createId(),
  });
}

// ── Set MULTIPLE props on a track in one op ────────────────────────────────────

/**
 * Merge `patch` onto a single track and write the whole `/audioTracks` array
 * ONCE. Use this for any edit that touches more than one field at a time —
 * move (startFrame + endFrame), left-trim (startFrame + trimIn), right-trim
 * (endFrame + trimOut) — so the fields are set atomically rather than by a
 * sequence of ops that each recompute the array from the pre-edit comp.
 */
export function setAudioTrackPropsOp(
  comp: Composition,
  trackId: Id,
  patch: Partial<AudioTrack>,
): Op {
  const idx    = findTrackIndex(comp, trackId);
  const tracks = getTracks(comp);
  const newTracks = tracks.map((t, i) =>
    i === idx ? { ...t, ...patch } : t
  );
  return createOp({
    type:   "set",
    compId: comp.id,
    path:   "/audioTracks",
    before: tracks as unknown as Json,
    after:  newTracks as unknown as Json,
    txn:    createId(),
  });
}

// ── Reorder audio tracks ──────────────────────────────────────────────────────

export function reorderAudioTracksOp(
  comp: Composition,
  newOrder: Id[],
): Op {
  const tracks  = getTracks(comp);
  const byId    = new Map(tracks.map((t) => [t.id, t]));
  const newTracks = newOrder.map((id) => byId.get(id)).filter(Boolean) as AudioTrack[];
  return createOp({
    type:   "set",
    compId: comp.id,
    path:   "/audioTracks",
    before: tracks as unknown as Json,
    after:  newTracks as unknown as Json,
    txn:    createId(),
  });
}
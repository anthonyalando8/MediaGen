// packages/core/src/types/audio-track.ts
//
// AudioTrack — an audio asset placed on the composition timeline.
// Lives in `composition.audioTracks[]`.
//
// DESIGN
// ------
// Audio tracks are deliberately separate from the Node tree because:
//   • They have no visual representation in comp space (no matrix, no opacity)
//   • They don't participate in the evaluator's frame-by-frame render pass
//   • They're driven by a dedicated AudioEngine (Web Audio API) that works
//     independently of the RAF/Pixi render loop
//   • Keeping them separate avoids polluting RenderTree and the evaluator
//
// Each track references ONE audio asset from project.assets (kind="audio").
// Multiple tracks can reference the same asset (e.g. two layers of music).
//
// TIMELINE PLACEMENT
// ------------------
// `startFrame`  : composition frame where this track begins playing
// `endFrame`    : composition frame where it stops (undefined = play to end)
// `trimIn`      : seconds into the audio file to start from (default 0)
// `trimOut`     : seconds into the audio file to stop at (undefined = full duration)
//
// VOLUME & FADES
// --------------
// `volume`      : linear gain 0–2 (1 = unity, 2 = +6dB boost)
// `fadeIn`      : fade-in duration in seconds (Web Audio gain ramp)
// `fadeOut`     : fade-out duration in seconds
//
// LOOP
// ----
// `loop`        : whether the track loops within its [startFrame, endFrame] window
//
// ID
// --
// `id`          : stable opaque identifier — used as the op-log path key
//                 and as the React key in the timeline
// `assetId`     : references project.assets[].id where kind === "audio"
// `name`        : display name (defaults to asset filename, editable)
// `muted`       : quick-mute without changing volume (preserved for undo)
// `solo`        : when true, all non-solo tracks are silenced (AudioEngine applies)
// `lane`        : vertical row index in the timeline audio section (default 0)

import type { Id } from "./ids";

export interface AudioTrack {
  id:          Id;
  assetId:     string;
  name:        string;

  // ── Timeline placement ────────────────────────────────────────────────
  /** Composition frame at which playback of this track starts. */
  startFrame:  number;
  /** Composition frame at which playback stops. Undefined = play to clip end. */
  endFrame?:   number;

  // ── Source trim ───────────────────────────────────────────────────────
  /** Seconds into the audio file to begin playing from (default 0). */
  trimIn:      number;
  /** Seconds into the audio file to stop at. Undefined = full file duration. */
  trimOut?:    number;

  // ── Volume & fades ────────────────────────────────────────────────────
  /** Linear gain 0–2. Default 1 (unity). */
  volume:      number;
  /** Fade-in duration in seconds from the track start. Default 0. */
  fadeIn:      number;
  /** Fade-out duration in seconds before the track end. Default 0. */
  fadeOut:     number;

  // ── Playback options ─────────────────────────────────────────────────
  /** Loop the audio within the [startFrame, endFrame] window. */
  loop:        boolean;
  /** Mute this track (preserves volume for undo). */
  muted:       boolean;
  /** Solo: only solo tracks play when any track is soloed. */
  solo:        boolean;

  // ── Layout ───────────────────────────────────────────────────────────
  /** Vertical row in the timeline audio section. */
  lane:        number;
}

/** Default values for a new audio track. */
export function defaultAudioTrack(id: Id, assetId: string, name: string, startFrame: number): AudioTrack {
  return {
    id,
    assetId,
    name,
    startFrame,
    endFrame:  undefined,
    trimIn:    0,
    trimOut:   undefined,
    volume:    1,
    fadeIn:    0,
    fadeOut:   0,
    loop:      false,
    muted:     false,
    solo:      false,
    lane:      0,
  };
}
// packages/export/src/virtual-clock.ts
//
// "A virtual clock steps frames 0…N" (Phase 2 blueprint, Deliverable 11.2).
// Pure sequencing — no rendering, no encoding, no browser APIs — so it's
// fully unit-testable and has zero risk of drifting from real time the way
// a wall-clock-driven export loop would (a slow frame must never skip
// output frames or duplicate them; this makes "the next frame" a pure
// function of an integer counter, not of how long the previous frame took).

export interface VirtualClock {
  /** Total number of frames this export will produce — always `durationFrames` (frame 0 included, the frame at `durationFrames` excluded, matching core's Composition.duration semantics). */
  readonly frameCount: number;
  /** The composition frame number for the Nth output frame (0-indexed). Identity for a full-speed export (every composition frame is rendered); kept as its own function so a future "export at half frame rate" mode is a one-line change here, not a rewrite of frame-pump.ts. */
  frameAt(index: number): number;
  /** Presentation timestamp, in seconds, for the Nth output frame — what gets handed to Mediabunny's `CanvasSource.add(timestamp, duration)`. */
  timestampAt(index: number): number;
  /** Duration, in seconds, of a single output frame — `1 / fps`, constant. */
  readonly frameDuration: number;
}

export interface VirtualClockOptions {
  /** Composition.duration — total frames, per core's Frame semantics (see evaluate-composition.ts). Must be a positive integer. */
  durationFrames: number;
  /** Composition.fps. */
  fps: number;
}

export function createVirtualClock(options: VirtualClockOptions): VirtualClock {
  const { durationFrames, fps } = options;
  if (!Number.isInteger(durationFrames) || durationFrames <= 0) {
    throw new Error(`createVirtualClock: durationFrames must be a positive integer, got ${durationFrames}`);
  }
  if (!(fps > 0)) {
    throw new Error(`createVirtualClock: fps must be a positive number, got ${fps}`);
  }

  const frameDuration = 1 / fps;

  return {
    frameCount: durationFrames,
    frameDuration,
    frameAt(index) {
      if (index < 0 || index >= durationFrames) {
        throw new RangeError(`VirtualClock.frameAt: index ${index} out of range [0, ${durationFrames})`);
      }
      return index;
    },
    timestampAt(index) {
      if (index < 0 || index >= durationFrames) {
        throw new RangeError(`VirtualClock.timestampAt: index ${index} out of range [0, ${durationFrames})`);
      }
      return index * frameDuration;
    },
  };
}
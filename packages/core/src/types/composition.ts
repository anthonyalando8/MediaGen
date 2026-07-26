// packages/core/src/types/composition.ts
import type { ColorOKLCH } from "./primitives";
import type { Id } from "./ids";
import type { Frame } from "./ids";
import type { Node } from "./node";
import type { PropBinding } from "./exposed";
import type { AudioTrack } from "./audio-track";

export interface Composition {
  id: Id;
  name: string;
  size: { width: number; height: number };
  fps: number;
  duration: Frame;
  background?: ColorOKLCH;
  /** The layer tree; array order = z-order. */
  root: Node[];
  /** Phase 2 §4.3 — which inner props a precomp instance of this Composition can override. */
  exposed?: PropBinding[];
  /**
   * Audio tracks placed on this composition's timeline (audio-ops.ts,
   * `/audioTracks` op path). Deliberately not part of `root`/`Node[]` — see
   * audio-track.ts's design note (no visual representation, driven by
   * AudioEngine rather than the evaluator). This field existed in practice
   * (written via ops, read via unsafe `as unknown as {...}` casts in
   * audio-ops.ts and AudioUploadPanel.tsx) before it was ever declared
   * here — declaring it properly is what let those casts be removed.
   */
  audioTracks?: AudioTrack[];
  /**
   * Resize-reference state for `rescaleRootOp` (apps/editor's
   * comp-size-ops.ts) — WITHOUT this, repeated Frame Size changes across
   * different aspect ratios compound: each resize scaled content relative
   * to whatever `size` happened to be from the PREVIOUS resize (which
   * already reflects that resize's own letterbox shrink), not the
   * original content, so alternating between two aspect ratios a few
   * times shrinks everything toward nothing. `baseSize` is captured once
   * — the first time content is ever rescaled — and never changes again;
   * `appliedScale`/`appliedOffsetX`/`appliedOffsetY` record the
   * cumulative transform CURRENTLY baked into `root`'s node positions and
   * scales relative to that base, so the next resize can correctly
   * undo it before applying the new one instead of chaining blindly.
   */
  resizeRef?: {
    baseSize: { width: number; height: number };
    appliedScale: number;
    appliedOffsetX: number;
    appliedOffsetY: number;
  };
}
// apps/editor/src/store/playback.ts
//
// Tier 3 · EPHEMERAL (not persisted, not undoable) — Deliverable 09 §9.2.

import { toFrame } from "core";
import type { Frame } from "core";
import type { StateCreator } from "zustand";
import type { EditorState } from "./index";

export interface PlaybackSlice {
  playhead: Frame;
  playing: boolean;
  setPlayhead(frame: Frame): void;
  play(): void;
  pause(): void;
}

export const createPlaybackSlice: StateCreator<EditorState, [], [], PlaybackSlice> = (set) => ({
  playhead: toFrame(0),
  playing: false,

  setPlayhead(frame) {
    set({ playhead: frame });
  },

  play() {
    set({ playing: true });
  },

  pause() {
    set({ playing: false });
  },
});
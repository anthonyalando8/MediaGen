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
  /**
   * True while `exportToMp4()` (Menubar.tsx's handleExportVideo) is
   * running. `Viewport.tsx`'s RAF loop checks this and skips rendering
   * entirely while true — export creates its OWN, second WebGL context
   * (createWebGLRenderer on a hidden canvas) that's alive for the full
   * export duration, alongside the live viewport's. Two simultaneous
   * full-resolution WebGL contexts both actively rendering is a documented
   * way to trigger a browser/driver-initiated "CONTEXT_LOST_WEBGL" under
   * GPU memory pressure (WebGL spec: "WebGL implementations use context
   * lost and restored events to regulate power and memory consumption").
   * Pausing the live viewport (which the user isn't watching during an
   * export anyway — the whole tab is busy) keeps only one context actively
   * drawing at a time.
   */
  isExporting: boolean;
  setPlayhead(frame: Frame): void;
  play(): void;
  pause(): void;
  setIsExporting(exporting: boolean): void;
}

export const createPlaybackSlice: StateCreator<EditorState, [], [], PlaybackSlice> = (set) => ({
  playhead: toFrame(0),
  playing: false,
  isExporting: false,

  setPlayhead(frame) {
    set({ playhead: frame });
  },

  play() {
    set({ playing: true });
  },

  pause() {
    set({ playing: false });
  },

  setIsExporting(exporting) {
    set({ isExporting: exporting });
  },
});
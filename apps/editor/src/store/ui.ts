// apps/editor/src/store/ui.ts
//
// Tier 3 · EPHEMERAL (not persisted, not undoable) — Deliverable 09 §9.2.
// Viewport zoom today; other view-only state (panel sizes, grid/snap
// toggles, ...) joins here in later weeks without touching Tier 1/2.

import type { StateCreator } from "zustand";
import type { EditorState } from "./index";

export interface UiSlice {
  zoom: number;
  setZoom(zoom: number): void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export const createUiSlice: StateCreator<EditorState, [], [], UiSlice> = (set) => ({
  zoom: 1,

  setZoom(zoom) {
    set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) });
  },
});
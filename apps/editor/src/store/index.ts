// apps/editor/src/store/index.ts
//
// "One store, three slices, never blended" (Deliverable 09 §9.2).
// Tier 1 (document) is persisted/undoable; Tiers 3 (selection/playback/ui)
// are ephemeral. Tier 2 (selectors.ts) is never stored — it's recomputed
// from Tier 1 on demand.

import { create } from "zustand";
import type { Project } from "core";
import { createDocumentSlice } from "./document";
import type { DocumentSlice } from "./document";
import { createSelectionSlice } from "./selection";
import type { SelectionSlice } from "./selection";
import { createPlaybackSlice } from "./playback";
import type { PlaybackSlice } from "./playback";
import { createUiSlice } from "./ui";
import type { UiSlice } from "./ui";

export type EditorState = DocumentSlice & SelectionSlice & PlaybackSlice & UiSlice;

/** Creates a fresh editor store for `project` — one per app instance (or test); never a module-level singleton. */
export function createEditorStore(project: Project) {
  return create<EditorState>()((...api) => ({
    ...createDocumentSlice(project)(...api),
    ...createSelectionSlice(...api),
    ...createPlaybackSlice(...api),
    ...createUiSlice(...api),
  }));
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export * from "./document";
export * from "./selection";
export * from "./playback";
export * from "./ui";
export * from "./selectors";
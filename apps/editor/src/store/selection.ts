// apps/editor/src/store/selection.ts
//
// Tier 3 · EPHEMERAL (not persisted, not undoable) — Deliverable 09 §9.2.

import type { Id } from "core";
import type { StateCreator } from "zustand";
import type { EditorState } from "./index";

export type Tool = "select" | "text" | "shape";

export interface SelectionSlice {
  selection: Id[];
  tool: Tool;
  select(ids: Id[]): void;
  setTool(tool: Tool): void;
}

export const createSelectionSlice: StateCreator<EditorState, [], [], SelectionSlice> = (set) => ({
  selection: [],
  tool: "select",

  select(ids) {
    set({ selection: ids });
  },

  setTool(tool) {
    set({ tool });
  },
});
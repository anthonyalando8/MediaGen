// apps/editor/src/store/document.ts
//
// Tier 1 · DOCUMENT (persisted, undoable) — Deliverable 09 §9.2.

import { applyOp, invertOp } from "core";
import type { Op, Project } from "core";
import type { StateCreator } from "zustand";
import type { EditorState } from "./index";

export interface DocumentSlice {
  document: {
    project: Project;
    opLog: Op[];
    cursor: number;
  };
  /** Applies `op` to `project.comps[op.compId]`, dropping any redo branch beyond `cursor`. */
  apply(op: Op): void;
  /** Reverts the most recently applied op, if any. */
  undo(): void;
  /** Re-applies the next op past `cursor`, if any. */
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/**
 * `op.path` (Deliverable 05.4) is a JSON Pointer into the `Composition`
 * identified by `op.compId` — `applyOp`/`invertOp` (core's pure reducer)
 * operate on that composition and return a new, immutable `Composition`,
 * which replaces `project.comps[op.compId]`. Mirrors `core`'s `History<T>`
 * shape (log + cursor) but dispatches by `compId` across `project.comps`,
 * since a Project holds multiple compositions while `History<T>` is
 * per-state.
 *
 * DEVIATION from Deliverable 09's "Zustand+Immer store": `core`'s domain
 * types (`Composition`/`Node`/`Channel`/`Json`) are recursive enough that
 * Immer's `Draft<T>` mapped type triggers `TS2589: Type instantiation is
 * excessively deep` on assignment. Since `applyOp`/`invertOp` already
 * return fully-immutable results, this slice (and the rest of the store)
 * uses plain Zustand `set()` with manual immutable spreads instead —
 * `immer` remains available for a future slice that needs deep-mutation
 * ergonomics over a *non*-`core`-shaped sub-tree.
 */
export function createDocumentSlice(initialProject: Project): StateCreator<EditorState, [], [], DocumentSlice> {
  return (set, get) => ({
    document: { project: initialProject, opLog: [], cursor: 0 },

    apply(op) {
      const { project, opLog, cursor } = get().document;
      const comp = project.comps[op.compId];
      if (!comp) throw new Error(`apply: unknown composition "${op.compId}"`);
      const nextComp = applyOp(comp, op);
      const nextOpLog = cursor < opLog.length ? opLog.slice(0, cursor) : opLog.slice();
      nextOpLog.push(op);
      set({
        document: {
          project: { ...project, comps: { ...project.comps, [op.compId]: nextComp } },
          opLog: nextOpLog,
          cursor: cursor + 1,
        },
      });
    },

    undo() {
      const { project, opLog, cursor } = get().document;
      if (cursor === 0) return;
      const op = opLog[cursor - 1];
      const nextComp = applyOp(project.comps[op.compId], invertOp(op));
      set({
        document: {
          project: { ...project, comps: { ...project.comps, [op.compId]: nextComp } },
          opLog,
          cursor: cursor - 1,
        },
      });
    },

    redo() {
      const { project, opLog, cursor } = get().document;
      if (cursor >= opLog.length) return;
      const op = opLog[cursor];
      const nextComp = applyOp(project.comps[op.compId], op);
      set({
        document: {
          project: { ...project, comps: { ...project.comps, [op.compId]: nextComp } },
          opLog,
          cursor: cursor + 1,
        },
      });
    },

    canUndo() {
      return get().document.cursor > 0;
    },

    canRedo() {
      return get().document.cursor < get().document.opLog.length;
    },
  });
}
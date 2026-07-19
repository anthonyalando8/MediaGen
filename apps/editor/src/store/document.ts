// apps/editor/src/store/document.ts
//
// Tier 1 · DOCUMENT (persisted, undoable) — Deliverable 09 §9.2.
//
// ── CHANGE IN THIS REVISION ────────────────────────────────────────────────
// Added `loadProjectDocument(project)` — replaces the ENTIRE document with a
// freshly loaded/created project (File ▸ Open a `.seabytes` file, or New
// Project). It resets the op-log + redo cursor (an imported document starts a
// clean undo history) and clears ephemeral state that referenced the OLD
// document — selection ids and the playhead — so nothing dangles. main.tsx's
// existing Tier-1 subscription persists the swapped-in project to localStorage
// automatically, exactly as it does for any other document change.

import { applyOp, invertOp, toFrame } from "core";
import type { AssetRef, Composition, Id, Op, Project } from "core";
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
  /**
   * Replaces the whole document with `project` (File ▸ Open / New Project).
   * Clears undo history (fresh op-log + cursor) and resets ephemeral state
   * that pointed at the previous document: selection is cleared, playback is
   * paused, and the playhead returns to frame 0 — otherwise a stale selected
   * node id or an out-of-range playhead from the old project would linger.
   * The Tier-1 persistence subscription (main.tsx) saves the new project to
   * localStorage on the next tick, same as any edit.
   */
  loadProjectDocument(project: Project): void;
  /**
   * Appends `asset` to `project.assets` (core's `AssetRef`, project.ts) —
   * MediaPalette's upload handler (exit criterion 02), after building the
   * AssetRef via persistence/asset-upload.ts's `fileToAssetRef`.
   *
   * NOT part of the op-log/undo stack: `project.assets` is a flat
   * Project-level array (not addressed by any Composition's JSON-pointer
   * paths — Op.path/applyOp/invertOp operate on `project.comps[compId]`),
   * and registering an uploaded asset in the library is an import action,
   * not a composition edit. Still persisted: main.tsx's Tier1 subscription
   * fires on any `document.project` replacement, including this one.
   */
  addAsset(asset: AssetRef): void;
  /**
   * Removes the asset `assetId` from `project.assets` — MediaPalette's
   * per-item remove button. Same non-op-log/non-undo rationale as
   * `addAsset`. Does NOT touch any composition: nodes whose
   * `source.assetId`/`tex.assetId` still reference a removed asset are left
   * as-is (MediaService.resolveAsset then returns `undefined` for them, and
   * TextureManager.get logs once and falls back to `Texture.EMPTY` — see
   * renderer-webgl/textures/manager.ts). Callers that want "remove and
   * delete the layers using it" compose this with `deleteSelection`
   * (store/delete-selection.ts) themselves.
   */
  removeAsset(assetId: Id): void;
  /** Registers a new Composition in the project library — used by precomposeOp. Same non-op-log rationale as addAsset: this is a library addition, not a composition edit. */
  addComp(comp: Composition): void;
}

/**
 * `op.path` (Deliverable 05.4) is a JSON Pointer into the `Composition`
 * identified by `op.compId` — `applyOp`/`invertOp` (core's pure reducer)
 * operate on that composition and return a new, immutable `Composition`,
 * which replaces `project.comps[op.compId]`. Mirrors `core`'s `History<T>`
 * shape (log + cursor) but dispatches by `compId` across `project.comps`,
 * since a Project holds multiple compositions while `History<T>` is
 * per-state.
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

    loadProjectDocument(project) {
      set({ document: { project, opLog: [], cursor: 0 } });
      // Reset ephemeral state that referenced the previous document.
      const s = get();
      s.select([]);
      s.pause();
      s.setPlayhead(toFrame(0));
    },

    addAsset(asset) {
      const { project } = get().document;
      // Upsert by id, not blind append. `AssetRef.id` is the collection's
      // key (React renders asset lists keyed by it — see MediaPalette/
      // AudioUploadPanel), so two entries sharing an id is an invariant
      // violation, not just a cosmetic duplicate. This matters because
      // Week 12's background transcode sync (AudioUploadPanel) calls
      // addAsset a second time for the SAME id once the server-processed
      // waveform/proxy/master are ready — that must replace the original
      // entry in place, not push a second one next to it.
      const existingIndex = project.assets.findIndex((a) => a.id === asset.id);
      const assets = existingIndex === -1 ? [...project.assets, asset] : project.assets.map((a, i) => (i === existingIndex ? asset : a));
      set({
        document: {
          ...get().document,
          project: { ...project, assets },
        },
      });
    },

    removeAsset(assetId) {
      const { project } = get().document;
      set({
        document: {
          ...get().document,
          project: { ...project, assets: project.assets.filter((a) => a.id !== assetId) },
        },
      });
    },

    addComp(comp) {
      const { project } = get().document;
      set({
        document: {
          ...get().document,
          project: { ...project, comps: { ...project.comps, [comp.id]: comp } },
        },
      });
    },
  });
}

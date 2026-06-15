// apps/editor/src/store/delete-selection.ts
//
// Deletes the currently-selected top-level node(s) — shared by
// use-delete-shortcut.ts (Delete/Backspace) and Toolbar.tsx's Delete
// button, so both paths behave identically. Locked nodes are skipped
// (consistent with the gizmo, which also ignores locked selections). Each
// removal is its own `removeNode` -> `apply()` call/undo step (op.txn
// grouping isn't wired into undo/redo — see document.ts) — re-fetches
// `activeComp` after each removal so later indices stay correct as earlier
// ones shift.

import { removeNode } from "../commands/remove-node";
import type { EditorStore } from "./index";
import { activeComp } from "./selectors";

export function deleteSelection(store: EditorStore): void {
  const state = store.getState();
  const { selection } = state;
  if (selection.length === 0) return;

  const comp = activeComp(state);
  const toRemove = selection.filter((id) => !comp.root.find((n) => n.id === id)?.locked);
  for (const id of toRemove) {
    state.apply(removeNode(activeComp(store.getState()), id));
  }
  if (toRemove.length > 0) state.select([]);
}
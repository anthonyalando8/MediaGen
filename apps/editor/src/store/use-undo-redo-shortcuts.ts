// apps/editor/src/store/use-undo-redo-shortcuts.ts
//
// Undo/redo UI (Deliverable 09 §9.1, Week 8): Toolbar's Undo/Redo buttons
// already call `store.getState().undo()/redo()` directly — this hook adds
// the standard keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y) on
// top of the same store methods. `canUndo()`/`canRedo()` are re-checked
// inside the handler (not via a subscription) so the listener never needs
// to be re-registered as the op-log changes.

import { useEffect } from "react";
import { useEditorStoreApi } from "./context";

export function useUndoRedoShortcuts(): void {
  const store = useEditorStoreApi();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const isModified = e.ctrlKey || e.metaKey;
      if (!isModified) return;

      const key = e.key.toLowerCase();
      const isRedo = (key === "z" && e.shiftKey) || key === "y";
      const isUndo = key === "z" && !e.shiftKey;

      if (!isUndo && !isRedo) return;

      e.preventDefault();
      const state = store.getState();
      if (isRedo && state.canRedo()) {
        state.redo();
      } else if (isUndo && state.canUndo()) {
        state.undo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
}
// apps/editor/src/store/use-delete-shortcut.ts
//
// Delete/Backspace removes the selected layer(s) (Toolbar.tsx's Delete
// button calls the same `deleteSelection` helper — delete-selection.ts).
// Ignored while focus is in a text input/select/contenteditable (the
// inspector's Name field, color/number inputs, etc.) so Backspace still
// edits text normally there.

import { useEffect } from "react";
import { deleteSelection } from "./delete-selection";
import { useEditorStoreApi } from "./context";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useDeleteShortcut(): void {
  const store = useEditorStoreApi();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (isEditableTarget(e.target)) return;
      if (store.getState().selection.length === 0) return;

      e.preventDefault();
      deleteSelection(store);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
}
// apps/editor/src/store/editor-handle.ts
// Module-level singleton for the active RichTextEditor handle.
// This avoids threading a ref through the entire component tree —
// Viewport sets it, InspectorPanel reads it.

import type { RichTextEditorHandle } from "../components/RichTextEditor";

let _handle: RichTextEditorHandle | null = null;
let _editingNodeId: string | null = null;
const _listeners: Array<() => void> = [];

// Stable snapshot — useSyncExternalStore requires the same reference
// when nothing has changed, otherwise it triggers infinite re-renders.
let _snapshot: { handle: RichTextEditorHandle | null; editingNodeId: string | null } = { handle: _handle, editingNodeId: _editingNodeId };

export function setActiveEditor(id: string | null, handle: RichTextEditorHandle | null) {
  _handle = handle;
  _editingNodeId = id;
  // Only create a new snapshot object when values actually change
  _snapshot = { handle, editingNodeId: id };
  _listeners.forEach((l) => l());
}

export function getActiveEditor() {
  return _snapshot;
}

export function subscribeActiveEditor(listener: () => void) {
  _listeners.push(listener);
  return () => {
    const i = _listeners.indexOf(listener);
    if (i >= 0) _listeners.splice(i, 1);
  };
}
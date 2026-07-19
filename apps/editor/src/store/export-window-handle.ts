// apps/editor/src/store/export-window-handle.ts
//
// Module-level singleton that owns whether the full-screen <ExportWindow>
// is open. Mirrors editor-handle.ts / path-edit-handle.ts: any component
// (the Menubar's Export button, a File > Export Video… menu item, a
// keyboard shortcut) can call `openExportWindow()` without threading a
// callback down through the tree, and <ExportWindow> subscribes via
// useSyncExternalStore.

let _open = false;
const _listeners: Array<() => void> = [];

// Stable snapshot — useSyncExternalStore requires the same reference when
// nothing changed, otherwise it loops re-rendering.
let _snapshot: { open: boolean } = { open: _open };

function emit() {
  _snapshot = { open: _open };
  _listeners.forEach((l) => l());
}

/** Open the export window. No-op if already open. */
export function openExportWindow(): void {
  if (_open) return;
  _open = true;
  emit();
}

/** Close the export window. Safe to call from inside the window (Close/Esc). */
export function closeExportWindow(): void {
  if (!_open) return;
  _open = false;
  emit();
}

export function getExportWindowState(): { open: boolean } {
  return _snapshot;
}

export function subscribeExportWindow(listener: () => void): () => void {
  _listeners.push(listener);
  return () => {
    const i = _listeners.indexOf(listener);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

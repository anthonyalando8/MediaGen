// apps/editor/src/store/path-edit-handle.ts
// Module-level singleton so InspectorPanel can trigger path edit mode
// (which is owned by Viewport) after Convert to path is clicked.

let _enter: ((nodeId: string) => void) | null = null;

export function registerPathEditHandler(fn: (nodeId: string) => void) {
  _enter = fn;
}

export function enterPathEditMode(nodeId: string) {
  _enter?.(nodeId);
}
// apps/editor/src/store/ai-scene-handle.ts
//
// Open/close singleton for the AI scene generator modal — same pattern as
// export-window-handle.ts. Lets the Menubar (File ▸ Generate AI Scene…) open
// the modal without prop-drilling; <AISceneModal> subscribes.

let _open = false;
const _listeners: Array<() => void> = [];
let _snapshot = { open: _open };

function emit() {
  _snapshot = { open: _open };
  _listeners.forEach((l) => l());
}

export function openAIScene(): void {
  if (_open) return;
  _open = true;
  emit();
}
export function closeAIScene(): void {
  if (!_open) return;
  _open = false;
  emit();
}
export function getAISceneState() {
  return _snapshot;
}
export function subscribeAIScene(listener: () => void): () => void {
  _listeners.push(listener);
  return () => {
    const i = _listeners.indexOf(listener);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

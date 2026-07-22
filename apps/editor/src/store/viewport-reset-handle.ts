// apps/editor/src/store/viewport-reset-handle.ts
//
// Bumped whenever the whole document is REPLACED (File ▸ Open / Import Scene /
// Generate AI Scene / New Project — all via document.ts `loadProjectDocument`).
// <Viewport> keys <CanvasHost> on this epoch, so a document swap fully remounts
// the canvas: a brand-new WebGL renderer with an empty texture cache and a
// cleared framebuffer. Without this, swapping to a project whose first paused
// frame is transparent left the PREVIOUS project's pixels on screen (the RAF
// loop renders the new — correct — tree, but nothing paints over the old
// framebuffer where the new frame is empty). Same proven remount the export
// path uses via CanvasHost's `active` toggle.

let _epoch = 0;
const _listeners: Array<() => void> = [];

export function resetViewport(): void {
  _epoch += 1;
  _listeners.forEach((l) => l());
}
export function getViewportEpoch(): number {
  return _epoch;
}
export function subscribeViewportReset(listener: () => void): () => void {
  _listeners.push(listener);
  return () => {
    const i = _listeners.indexOf(listener);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

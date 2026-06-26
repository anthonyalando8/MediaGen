// apps/editor/src/store/active-span-handle.ts
// Tracks which span index the user is currently focused on in the text editor.
// Set by RichTextEditor when the selection changes; read by SpanAnimPanel and
// TextEffectsPanel to focus their UI on the relevant span.
//
// Values:
//   null   — no selection / editor not open
//   -1     — selection exists inside editor but not yet in a named span
//   0..N   — specific span index (has a data-span-id)

let _activeIndex: number | null = null;
const _listeners: Array<() => void> = [];

export function setActiveSpanIndex(index: number | null) {
  _activeIndex = index;
  _listeners.forEach((l) => l());
}

export function getActiveSpanIndex(): number | null { return _activeIndex; }

export function subscribeActiveSpan(l: () => void) {
  _listeners.push(l);
  return () => { const i = _listeners.indexOf(l); if (i >= 0) _listeners.splice(i, 1); };
}
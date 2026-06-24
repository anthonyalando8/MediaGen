// apps/editor/src/components/RichTextFormatBar.tsx
//
// Format controls for the active RichTextEditor — lives in InspectorPanel
// when a text node is being edited. Reads/drives the editor via the
// module-level singleton (editor-handle.ts) so clicking these buttons
// doesn't steal focus from the contenteditable.

import { useSyncExternalStore } from "react";
import { getActiveEditor, subscribeActiveEditor } from "../store/editor-handle";
import { Section } from "./inspector-fields";

export function RichTextFormatBar() {
  // Re-render whenever the active editor changes
  const { editingNodeId, handle } = useSyncExternalStore(
    subscribeActiveEditor,
    getActiveEditor
  );

  if (!editingNodeId || !handle) return null;

  return (
    <Section title="Format Selection" defaultOpen>
      <p className="rich-format-hint">Select text in the canvas, then apply formatting below.</p>
      <div className="rich-format-bar">
        <button
          className="btn btn-sm rich-format-btn"
          title="Bold (⌘B)"
          onPointerDown={(e) => { e.preventDefault(); handle.applyBold(); }}
        >
          <b>B</b>
        </button>
        <button
          className="btn btn-sm rich-format-btn"
          title="Italic (⌘I)"
          onPointerDown={(e) => { e.preventDefault(); handle.applyItalic(); }}
        >
          <i>I</i>
        </button>
        <label className="rich-format-color" title="Text color">
          <span>Color</span>
          <input
            type="color"
            defaultValue="#ffffff"
            onInput={(e) => {
              const hex = (e.target as HTMLInputElement).value;
              handle.focus();
              handle.applyColor(hex);
            }}
          />
        </label>
      </div>
      <p className="rich-format-hint" style={{ marginTop: 4 }}>
        Press <kbd>Esc</kbd> or <kbd>⌘↵</kbd> to finish editing.
      </p>
    </Section>
  );
}
// apps/editor/src/components/Toolbar.tsx
//
// Simplified toolbar (UI/UX redesign). The toolbar is now ONLY tools +
// zoom + history:
//
//   [ Select  Text  Shape  Draw  Mask ] | [ −  100%  + ] ......... [ ⤺  ⤼ ]
//
// All Insert / Arrange / View clusters moved up to the <Menubar>:
//   • Insert (Shape/Text/Group/Null/Adjustment/Precomp) → Insert menu
//   • Group / Ungroup → Insert / Edit menus
//   • Edit/Preview/Focus presets + panel toggles → View menu
//
// Tool selection and undo/redo call the same store API as before; the zoom
// stepper reads/writes the existing `zoom` / `setZoom` (clamped 0.1–8) that
// <Viewport> and <ViewportStatusBar> already share. No document/store logic
// changed — only which controls live here.

import { MousePointer2, Pencil, PenLine, Plus, Minus, Redo2, Square, Type, Undo2 } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import type { Tool } from "../store/selection";

const TOOLS: { tool: Tool; label: string; icon: typeof Square }[] = [
  { tool: "select", label: "Select (V)", icon: MousePointer2 },
  { tool: "text", label: "Text (T)", icon: Type },
  { tool: "shape", label: "Shape (R)", icon: Square },
  { tool: "draw", label: "Draw / Brush (B)", icon: Pencil },
];

const ICON_SIZE = 15;

export function Toolbar() {
  const store = useEditorStoreApi();
  const canUndo = useEditorStore((s) => s.canUndo());
  const canRedo = useEditorStore((s) => s.canRedo());
  const tool = useEditorStore((s) => s.tool);
  const zoom = useEditorStore((s) => s.zoom);
  const selection = useEditorStore((s) => s.selection);

  return (
    <div className="toolbar">
      {/* Tools */}
      <div className="btn-group">
        {TOOLS.map(({ tool: t, label, icon: Icon }) => (
          <button
            key={t}
            className="btn btn-icon"
            aria-pressed={tool === t}
            title={label}
            onClick={() => store.getState().setTool(t)}
          >
            <Icon size={ICON_SIZE} />
          </button>
        ))}
        <button
          className="btn btn-icon"
          aria-pressed={tool === "mask"}
          title="Mask pen tool (M)"
          disabled={selection.length === 0}
          onClick={() => store.getState().setTool(tool === "mask" ? "select" : "mask")}
        >
          <PenLine size={ICON_SIZE} />
        </button>
      </div>

      <div className="toolbar__divider" />

      {/* Zoom */}
      <div className="btn-group toolbar__zoom">
        <button className="btn btn-icon" title="Zoom out" onClick={() => store.getState().setZoom(zoom / 1.2)}>
          <Minus size={ICON_SIZE} />
        </button>
        <button
          className="btn toolbar__zoom-val"
          title="Reset zoom to 100%"
          onClick={() => store.getState().setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="btn btn-icon" title="Zoom in" onClick={() => store.getState().setZoom(zoom * 1.2)}>
          <Plus size={ICON_SIZE} />
        </button>
      </div>

      <span className="toolbar__spacer" />

      {/* History */}
      <div className="btn-group">
        <button className="btn btn-icon" disabled={!canUndo} onClick={() => store.getState().undo()} title="Undo (⌘Z)">
          <Undo2 size={ICON_SIZE} />
        </button>
        <button className="btn btn-icon" disabled={!canRedo} onClick={() => store.getState().redo()} title="Redo (⌘⇧Z)">
          <Redo2 size={ICON_SIZE} />
        </button>
      </div>
    </div>
  );
}

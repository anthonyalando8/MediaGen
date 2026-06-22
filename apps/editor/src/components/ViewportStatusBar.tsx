// apps/editor/src/components/ViewportStatusBar.tsx
//
// The viewport's bottom status bar (workspace ergonomics pass). REPLACES the
// old floating <ViewportHud> that covered the top-center of the canvas — the
// zoom controls now dock in a status bar below the canvas where they never
// obstruct editable content (feedback Option A: "Canvas Size | 100% | Zoom
// Out | Zoom In | Fit Screen").
//
// Reads/writes the EXISTING store viewport zoom (store/ui.ts: `zoom`,
// `setZoom`, clamped 0.1–8) that <Viewport> already consumes for its fit
// transform, and reads the active composition size for the canvas-size
// readout. NO new state, NO logic change.

import { Maximize, Minus, Plus } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

const ICON = 15;

export function ViewportStatusBar() {
  const store = useEditorStoreApi();
  const zoom = useEditorStore((s) => s.zoom);
  const size = useEditorStore((s) => activeComp(s).size);

  return (
    <div className="viewport-statusbar" role="group" aria-label="Viewport">
      <span className="viewport-statusbar__meta">
        {Math.round(size.width)} × {Math.round(size.height)}
      </span>
      <span className="viewport-statusbar__sep" />
      <span className="viewport-statusbar__spacer" />
      <button className="viewport-statusbar__btn" title="Zoom out" onClick={() => store.getState().setZoom(zoom / 1.2)}>
        <Minus size={ICON} />
      </button>
      <span className="viewport-statusbar__pct">{Math.round(zoom * 100)}%</span>
      <button className="viewport-statusbar__btn" title="Zoom in" onClick={() => store.getState().setZoom(zoom * 1.2)}>
        <Plus size={ICON} />
      </button>
      <span className="viewport-statusbar__sep" />
      <button className="viewport-statusbar__btn viewport-statusbar__btn--text" title="Fit to view (100%)" onClick={() => store.getState().setZoom(1)}>
        <Maximize size={ICON} />
        Fit
      </button>
    </div>
  );
}

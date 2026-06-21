// apps/editor/src/components/ViewportHud.tsx
//
// Floating zoom control over the canvas (UI/UX redesign). Reads/writes the
// EXISTING store viewport zoom (store/ui.ts: `zoom`, `setZoom`, clamped
// 0.1–8) that <Viewport> already consumes for its fit transform — so this
// adds discoverable controls for behavior that was previously only reachable
// (if at all) without on-screen affordances. NO new state, NO logic change.

import { Maximize, Minus, Plus } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";

const ICON = 15;

export function ViewportHud() {
  const store = useEditorStoreApi();
  const zoom = useEditorStore((s) => s.zoom);

  return (
    <div className="viewport-hud" role="group" aria-label="Viewport zoom">
      <button className="viewport-hud__btn" title="Zoom out" onClick={() => store.getState().setZoom(zoom / 1.2)}>
        <Minus size={ICON} />
      </button>
      <span className="viewport-hud__pct">{Math.round(zoom * 100)}%</span>
      <button className="viewport-hud__btn" title="Zoom in" onClick={() => store.getState().setZoom(zoom * 1.2)}>
        <Plus size={ICON} />
      </button>
      <div className="viewport-hud__divider" />
      <button className="viewport-hud__btn" title="Fit to view (100%)" onClick={() => store.getState().setZoom(1)}>
        <Maximize size={ICON} />
      </button>
    </div>
  );
}

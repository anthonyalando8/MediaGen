// apps/editor/src/components/ViewportStatusBar.tsx
//
// Richer viewport status bar (UI/UX redesign). Reads-only chrome that now
// reports the full canvas context in one line:
//
//   [Comp name] | [W × H] | [fps] | [F#  HH:MM:SS:FF] ........ [zoom ▾] [Fit]
//
// The zoom readout is a DROPDOWN (click to pick 25/50/100/200/400 % or Fit),
// in addition to the −/+ steppers. Everything maps to the EXISTING store
// surface — `zoom` / `setZoom` / `resetView` (clamped 0.1–8), `activeComp`
// (size / fps / name), and `playhead` — so no new state and no logic change.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Maximize, Minus, Plus } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

const ICON = 14;
const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Frame index → HH:MM:SS:FF timecode at the comp's fps. */
function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const safeFps = fps > 0 ? fps : 30;
  const totalSec = Math.floor(f / safeFps);
  const ff = f % safeFps;
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

export function ViewportStatusBar() {
  const store = useEditorStoreApi();
  const zoom = useEditorStore((s) => s.zoom);
  const comp = useEditorStore((s) => activeComp(s));
  const playhead = useEditorStore((s) => s.playhead);

  const [zoomOpen, setZoomOpen] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!zoomOpen) return;
    const onDown = (e: MouseEvent) => {
      if (zoomRef.current && !zoomRef.current.contains(e.target as Node)) setZoomOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [zoomOpen]);

  const frame = Number(playhead);
  const pct = Math.round(zoom * 100);
  const compName = (comp as { name?: string }).name ?? "Composition";

  return (
    <div className="viewport-statusbar" role="group" aria-label="Viewport">
      <span className="viewport-statusbar__name">{compName}</span>
      <span className="viewport-statusbar__sep" />
      <span className="viewport-statusbar__meta">
        {Math.round(comp.size.width)} × {Math.round(comp.size.height)}
      </span>
      <span className="viewport-statusbar__sep" />
      <span className="viewport-statusbar__meta">{comp.fps} fps</span>
      <span className="viewport-statusbar__sep" />
      <span className="viewport-statusbar__tc">
        <span className="viewport-statusbar__frame">F{frame}</span>
        {timecode(frame, comp.fps)}
      </span>

      <span className="viewport-statusbar__spacer" />

      <button className="viewport-statusbar__btn" title="Zoom out" onClick={() => store.getState().setZoom(zoom / 1.2)}>
        <Minus size={ICON} />
      </button>

      <div className="viewport-statusbar__zoom" ref={zoomRef}>
        <button
          className="viewport-statusbar__zoom-trigger"
          aria-haspopup="menu"
          aria-expanded={zoomOpen}
          title="Zoom level"
          onClick={() => setZoomOpen((o) => !o)}
        >
          <span className="viewport-statusbar__pct">{pct}%</span>
          <ChevronDown size={12} />
        </button>
        {zoomOpen && (
          <div className="viewport-statusbar__zoom-menu" role="menu">
            {ZOOM_PRESETS.map((z) => (
              <button
                key={z}
                type="button"
                role="menuitemradio"
                aria-checked={pct === Math.round(z * 100)}
                className="viewport-statusbar__zoom-item"
                onClick={() => {
                  store.getState().setZoom(z);
                  setZoomOpen(false);
                }}
              >
                <span className="viewport-statusbar__zoom-check">
                  {pct === Math.round(z * 100) && <Check size={13} />}
                </span>
                {Math.round(z * 100)}%
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="viewport-statusbar__zoom-item"
              onClick={() => {
                store.getState().resetView();
                setZoomOpen(false);
              }}
            >
              <span className="viewport-statusbar__zoom-check" />
              Fit
            </button>
          </div>
        )}
      </div>

      <button className="viewport-statusbar__btn" title="Zoom in" onClick={() => store.getState().setZoom(zoom * 1.2)}>
        <Plus size={ICON} />
      </button>
      <span className="viewport-statusbar__sep" />
      <button
        className="viewport-statusbar__btn viewport-statusbar__btn--text"
        title="Fit to view (100%)"
        onClick={() => store.getState().resetView()}
      >
        <Maximize size={ICON} />
        Fit
      </button>
    </div>
  );
}

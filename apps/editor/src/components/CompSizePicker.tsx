// apps/editor/src/components/CompSizePicker.tsx
//
// Composition-size control for the canvas status bar — the fix for "the
// viewport is tied to 1920×1080". Shows the current frame size and opens a
// menu of common presets plus a custom W×H entry. Dispatches setCompSizeOp,
// which flows through the op-log (undoable) → Viewport's `computeFitTransform`
// re-fits the new aspect automatically, and the renderer clip mask updates on
// the next frame (Viewport.tsx already reacts to comp.size changes).
//
// NOTE: this changes the composition RESOLUTION, not the on-screen zoom. The
// canvas already fits the available viewport (computeFitTransform with a 32px
// margin) — pick a larger comp size or zoom to fill more of the screen.

import { useState } from "react";
import { ChevronUp, Check } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { rescaleRootOp, setCompSizeOp } from "../commands/comp-size-ops";

interface Preset { label: string; w: number; h: number; sub: string; }

const PRESETS: Preset[] = [
  { label: "HD 1080p", w: 1920, h: 1080, sub: "16:9" },
  { label: "4K UHD",   w: 3840, h: 2160, sub: "16:9" },
  { label: "Vertical", w: 1080, h: 1920, sub: "9:16" },
  { label: "Square",   w: 1080, h: 1080, sub: "1:1" },
  { label: "Cinema",   w: 2048, h: 858,  sub: "2.39:1" },
];

export function CompSizePicker() {
  const store = useEditorStoreApi();
  const size = useEditorStore((s) => activeComp(s).size);
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(size.width);
  const [h, setH] = useState(size.height);

  function apply(nw: number, nh: number) {
    const state = store.getState();
    const comp = activeComp(state);
    const { width: ow, height: oh } = comp.size;
    state.apply(setCompSizeOp(comp, nw, nh));
    // Rescale existing content to match — see comp-size-ops.ts's
    // rescaleRootOp doc for why this is TWO separate ops (root + the
    // resizeRef reference state that keeps repeated resizes from
    // compounding) and why only top-level nodes need touching. Skipped
    // when the size didn't actually change, or there's no prior valid
    // size to scale from (a brand-new empty comp).
    if (ow > 0 && oh > 0 && (ow !== nw || oh !== nh)) {
      const { rootOp, resizeRefOp } = rescaleRootOp(comp, ow, oh, nw, nh);
      state.apply(rootOp);
      state.apply(resizeRefOp);
    }
    setOpen(false);
  }

  return (
    <div className="comp-size" style={{ position: "relative" }}>
      <button
        className="comp-size__button"
        title="Composition size"
        onClick={() => { setW(size.width); setH(size.height); setOpen((v) => !v); }}
      >
        <span className="comp-size__value">{size.width} × {size.height}</span>
        <ChevronUp size={11} />
      </button>

      {open && (
        <>
          <div className="comp-size__backdrop" onClick={() => setOpen(false)} />
          <div className="comp-size__menu">
            <div className="comp-size__menu-title">Composition Size</div>
            {PRESETS.map((p) => {
              const active = p.w === size.width && p.h === size.height;
              return (
                <button
                  key={p.label}
                  className={`comp-size__item${active ? " comp-size__item--active" : ""}`}
                  onClick={() => apply(p.w, p.h)}
                >
                  <span className="comp-size__item-label">{p.label}</span>
                  <span className="comp-size__item-sub">{p.sub}</span>
                  {active && <Check size={13} />}
                </button>
              );
            })}
            <div className="comp-size__divider" />
            <div className="comp-size__custom">
              <input type="number" value={w} onChange={(e) => setW(Number(e.target.value))} aria-label="Width" />
              <span>×</span>
              <input type="number" value={h} onChange={(e) => setH(Number(e.target.value))} aria-label="Height" />
              <button className="comp-size__set" onClick={() => apply(w, h)}>Set</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

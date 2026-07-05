// apps/editor/src/components/CompSetupPanel.tsx
//
// NEW. The "start a composition" setup, relocated OUT of the viewport and into
// the right inspector panel's empty state. When the project is empty the
// viewport should read as an empty *stage* (atmosphere + a light hint), not a
// config surface — the frame-size picker + New/Import belong with the other
// settings on the right.
//
// Render this from InspectorPanel's empty branch (see README):
//
//   if (selection.length === 0) {
//     return <div className="panel panel--right"><CompSetupPanel /></div>;
//   }
//
// Uses the same setCompSizeOp the viewport overlay used — no data-model change.

import { Plus, Upload } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { setCompSizeOp } from "../commands/comp-size-ops";

const PRESETS = [
  { label: "16:9", sub: "1920×1080", w: 1920, h: 1080 },
  { label: "9:16", sub: "1080×1920", w: 1080, h: 1920 },
  { label: "1:1",  sub: "1080×1080", w: 1080, h: 1080 },
  { label: "4K",   sub: "3840×2160", w: 3840, h: 2160 },
];

export function CompSetupPanel() {
  const store = useEditorStoreApi();
  const size = useEditorStore((s) => {
    const sz = (activeComp(s) as unknown as { size?: { width: number; height: number } }).size;
    return { w: sz?.width ?? 0, h: sz?.height ?? 0 };
  });

  function setSize(w: number, h: number) {
    const state = store.getState();
    state.apply(setCompSizeOp(activeComp(state), w, h));
  }

  return (
    <div className="comp-setup">
      <div className="comp-setup__lead">
        <div className="comp-setup__title">Start a composition</div>
        <p className="comp-setup__sub">
          Pick a frame size, then add a layer or drop media onto the canvas.
        </p>
      </div>

      <div className="comp-setup__group-label">Frame size</div>
      <div className="comp-setup__presets">
        {PRESETS.map((p) => {
          const active = size.w === p.w && size.h === p.h;
          return (
            <button
              key={p.label}
              className={`comp-setup__chip${active ? " comp-setup__chip--active" : ""}`}
              onClick={() => setSize(p.w, p.h)}
            >
              <span className="comp-setup__chip-label">{p.label}</span>
              <span className="comp-setup__chip-sub">{p.sub}</span>
            </button>
          );
        })}
      </div>

      <div className="comp-setup__actions">
        <button className="btn btn-primary" style={{ width: "100%" }}>
          <Plus size={15} /> New Composition
        </button>
        <button className="btn btn-outline" style={{ width: "100%" }}>
          <Upload size={15} /> Import Media
        </button>
      </div>
    </div>
  );
}

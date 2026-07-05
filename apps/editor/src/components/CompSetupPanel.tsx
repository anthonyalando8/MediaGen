// apps/editor/src/components/CompSetupPanel.tsx
//
// The "start a composition" setup, shown in the right inspector panel as the
// project's empty state (relocated out of the viewport). Production wiring:
//   • Frame size  → setCompSizeOp (presets + custom W×H); the active size is
//                   highlighted, so this doubles as a size switcher.
//   • Import Media → real file import (fileToAssetRef → addAsset → addMediaNode
//                   → select), the same flow as MediaPalette's Upload.
//   • New Composition → seeds the canvas with a full-frame background layer so
//                   the empty state clears and there's something to build on.

import { useRef, useState } from "react";
import { Plus, Upload, ImagePlus } from "lucide-react";
import type { Id } from "core";
import { useRegistry } from "../bootstrap/registry-context";
import { fileToAssetRef } from "../persistence/asset-upload";
import type { UploadProgress } from "../persistence/asset-upload";
import { addMediaNode } from "../commands/add-media";
import { appendNodeOp } from "../commands/add-node";
import { setCompSizeOp } from "../commands/comp-size-ops";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

const PRESETS = [
  { label: "16:9", sub: "1920×1080", w: 1920, h: 1080 },
  { label: "9:16", sub: "1080×1920", w: 1080, h: 1920 },
  { label: "1:1",  sub: "1080×1080", w: 1080, h: 1080 },
  { label: "4K",   sub: "3840×2160", w: 3840, h: 2160 },
];

export function CompSetupPanel() {
  const store = useEditorStoreApi();
  const registry = useRegistry();

  const size = useEditorStore((s) => {
    const sz = (activeComp(s) as unknown as { size?: { width: number; height: number } }).size;
    return { w: sz?.width ?? 1920, h: sz?.height ?? 1080 };
  });

  const [custom, setCustom] = useState<{ w: string; h: string }>({ w: "", h: "" });
  const [uploading, setUploading] = useState<UploadProgress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function setSize(w: number, h: number) {
    const state = store.getState();
    state.apply(setCompSizeOp(activeComp(state), w, h));
  }

  function applyCustom() {
    const w = Number(custom.w), h = Number(custom.h);
    if (w > 0 && h > 0) setSize(w, h);
  }

  // ── New Composition: seed a full-frame background layer ────────────────
  function newComposition() {
    const state = store.getState();
    const op = appendNodeOp(activeComp(state), registry, "shape", { name: "Background" });
    state.apply(op);
    const node = op.after as unknown as { id: Id };
    if (node?.id) state.select([node.id]);
  }

  // ── Import Media: real upload + place on canvas ────────────────────────
  async function importMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading({ stage: "reading", fraction: 0 });
    try {
      const asset = await fileToAssetRef(file, setUploading);
      setUploading({ stage: "saving" });
      const state = store.getState();
      state.addAsset(asset);
      const op = addMediaNode(activeComp(state), registry, asset);
      state.apply(op);
      const node = op.after as unknown as { id: Id };
      if (node?.id) state.select([node.id]);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="comp-setup">
      <div className="comp-setup__lead">
        <span className="comp-setup__badge"><ImagePlus size={17} /></span>
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

      <div className="comp-setup__custom">
        <input
          type="number" min={16} placeholder="W" aria-label="Custom width"
          value={custom.w}
          onChange={(e) => setCustom((c) => ({ ...c, w: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && applyCustom()}
        />
        <span className="comp-setup__custom-x">×</span>
        <input
          type="number" min={16} placeholder="H" aria-label="Custom height"
          value={custom.h}
          onChange={(e) => setCustom((c) => ({ ...c, h: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && applyCustom()}
        />
        <button
          className="comp-setup__custom-set"
          disabled={!(Number(custom.w) > 0 && Number(custom.h) > 0)}
          onClick={applyCustom}
        >
          Set
        </button>
      </div>

      <div className="comp-setup__divider" />

      <div className="comp-setup__actions">
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={newComposition}>
          <Plus size={15} /> New Composition
        </button>
        <button
          className="btn btn-outline"
          style={{ width: "100%" }}
          disabled={uploading !== null}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={15} /> {uploading ? "Importing…" : "Import Media"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          style={{ display: "none" }}
          onChange={importMedia}
        />
      </div>
    </div>
  );
}

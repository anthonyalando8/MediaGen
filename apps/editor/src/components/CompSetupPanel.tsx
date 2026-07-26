// apps/editor/src/components/CompSetupPanel.tsx
//
// Right-panel content when nothing is selected: composition-level settings
// (frame size) plus quick actions to add the first layer. This is NOT the
// project's onboarding moment — that's <SceneStartPanel/>, a one-time hero
// over the viewport — so this panel intentionally reads as a plain settings
// section (matches the `.panel__header` used by every other panel) rather
// than a second "let's get started" pitch. It stays useful for the whole
// life of the comp, since frame size can change at any time.
//
//   • Frame size    → setCompSizeOp (presets + custom W×H); the active size is
//                     highlighted, so this doubles as a size switcher.
//   • Import Media  → real file import (fileToAssetRefViaServerOrLocal →
//                     addAsset → addMediaNode → select) — tries apps/api's
//                     upload+transcode pipeline first, falls back to the
//                     local data: URL path if the backend is unreachable.
//                     Same flow as MediaPalette's Upload.
//   • Add Background → seeds the canvas with a full-frame layer so the empty
//                     state clears and there's something to build on.

import { useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import type { Id } from "core";
import { useRegistry } from "../bootstrap/registry-context";
import { fileToAssetRefViaServerOrLocal } from "../persistence/asset-upload";
import type { ServerUploadProgress, UploadProgress } from "../persistence/asset-upload";
import { API_BASE_URL } from "../config/api";
import { addMediaNode } from "../commands/add-media";
import { appendNodeOp } from "../commands/add-node";
import { rescaleRootOp, setCompSizeOp } from "../commands/comp-size-ops";
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
  const [uploading, setUploading] = useState<UploadProgress | ServerUploadProgress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function setSize(w: number, h: number) {
    const state = store.getState();
    const comp = activeComp(state);
    const { width: ow, height: oh } = comp.size;
    state.apply(setCompSizeOp(comp, w, h));
    // Rescale existing content to match — see comp-size-ops.ts's
    // rescaleRootOp doc (two ops: root + resizeRef, so repeated resizes
    // don't compound). Skipped when unchanged, or no prior valid size.
    if (ow > 0 && oh > 0 && (ow !== w || oh !== h)) {
      const { rootOp, resizeRefOp } = rescaleRootOp(comp, ow, oh, w, h);
      state.apply(rootOp);
      state.apply(resizeRefOp);
    }
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

  // ── Import Media: real upload (server pipeline, local fallback) + place on canvas ──────
  async function importMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading({ stage: "reading", fraction: 0 });
    try {
      const asset = await fileToAssetRefViaServerOrLocal(file, API_BASE_URL, setUploading);
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
      <div className="panel__header">Composition</div>

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
          <Plus size={15} /> Add Background Layer
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
// apps/editor/src/components/MediaPalette.tsx
import { useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import type { Id } from "core";
import { addMediaNode } from "../commands/add-media";
import { useRegistry } from "../bootstrap/registry-context";
import { fileToAssetRef } from "../persistence/asset-upload";
import type { UploadProgress } from "../persistence/asset-upload";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { getKindColor, getKindIcon } from "./kind-icons";

/**
 * The "add-media palette" (Deliverable 11 Week 7): an upload button (exit
 * criterion 02 — "User adds an image from upload; it appears in canvas +
 * layer tree") plus a list of `project.assets` (image/video) with a button
 * to (re-)add each as a node.
 *
 * UI/UX redesign: each asset now reads as a media card with a kind-colored
 * thumbnail tile, larger hit targets, and an explicit add/remove pair on the
 * right. All upload/add/remove logic below is unchanged.
 */
export function MediaPalette() {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const assets = useEditorStore((s) => s.document.project.assets);
  const media = assets.filter((a) => a.kind === "image" || a.kind === "video");

  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  function handleAdd(assetIndex: number): void {
    const state = store.getState();
    state.apply(addMediaNode(activeComp(state), registry, media[assetIndex]));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setUploadProgress({ stage: "reading", fraction: 0 });
    try {
      const asset = await fileToAssetRef(file, setUploadProgress);

      setUploadProgress({ stage: "saving" });
      const state = store.getState();
      state.addAsset(asset);

      const op = addMediaNode(activeComp(state), registry, asset);
      state.apply(op);
      const node = op.after as unknown as { id: Id };
      state.select([node.id]);
    } finally {
      setUploadProgress(null);
    }
  }

  function handleRemove(assetId: Id): void {
    store.getState().removeAsset(assetId);
  }

  return (
    <div className="media-section">
      <div className="panel__header">
        Media
        <label className={`media-upload${uploadProgress ? " btn--disabled" : ""}`} title="Upload an image or video">
          <Upload size={14} />
          {uploadProgress ? "Uploading…" : "Upload"}
          <input
            type="file"
            accept="image/*,video/*"
            onChange={handleUpload}
            disabled={uploadProgress !== null}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {uploadProgress && (
        <div
          className={`upload-progress${uploadProgress.stage !== "reading" ? " upload-progress--indeterminate" : ""}`}
          role="progressbar"
          aria-valuenow={uploadProgress.stage === "reading" ? Math.round(uploadProgress.fraction * 100) : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          title={
            uploadProgress.stage === "reading"
              ? `Reading file: ${Math.round(uploadProgress.fraction * 100)}%`
              : uploadProgress.stage === "detecting-dimensions"
                ? "Reading media info…"
                : "Saving…"
          }
        >
          <div
            className="upload-progress__bar"
            style={uploadProgress.stage === "reading" ? { width: `${uploadProgress.fraction * 100}%` } : undefined}
          />
        </div>
      )}

      {media.length === 0 ? (
        <p className="panel__empty">No media yet — upload an image or video above.</p>
      ) : (
        <ul className="media-list">
          {media.map((asset, i) => {
            const Icon = getKindIcon(asset.kind);
            const color = getKindColor(asset.kind);
            return (
              <li key={asset.id} className="media-item">
                <span
                  className="media-item__thumb"
                  style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}
                >
                  <Icon size={16} />
                </span>
                <span className="media-item__info">
                  <span className="media-item__name">{asset.kind}</span>
                  <span className="media-item__id">{asset.id.slice(0, 8)}</span>
                </span>
                <span className="media-item__actions">
                  <button className="media-add" title="Add to composition" onClick={() => handleAdd(i)}>
                    <Plus size={14} />
                  </button>
                  <button className="media-remove" title="Remove from project" onClick={() => handleRemove(asset.id)}>
                    <Trash2 size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

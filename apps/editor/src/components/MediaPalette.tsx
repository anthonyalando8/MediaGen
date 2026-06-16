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
import { getKindIcon } from "./kind-icons";

/**
 * The "add-media palette" (Deliverable 11 Week 7): an upload button (exit
 * criterion 02 — "User adds an image from upload; it appears in canvas +
 * layer tree") plus a list of `project.assets` (image/video) with a button
 * to (re-)add each as a node.
 */
export function MediaPalette() {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const assets = useEditorStore((s) => s.document.project.assets);
  const media = assets.filter((a) => a.kind === "image" || a.kind === "video");

  // Surfaces fileToAssetRef's progress (asset-upload.ts) as a visible bar —
  // previously a large video's read+decode could take several seconds with
  // ZERO visual feedback: the button just sat there, then the layer
  // suddenly appeared. `null` = no upload in flight.
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

      // `addAsset`/`apply` below are synchronous, but main.tsx's Tier1
      // subscription does a synchronous `JSON.stringify` +
      // `localStorage.setItem` of the WHOLE project on this same tick
      // (persistence/local-storage.ts) — for a project holding a large
      // base64 `data:` URL, that alone can take a perceptible moment.
      // "saving" keeps the progress UI honest through that, rather than
      // it looking finished right before a final stutter.
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
      <div className="panel__header">Media</div>

      <label className={`btn${uploadProgress ? " btn--disabled" : ""}`} title="Upload an image or video">
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
            return (
              <li key={asset.id} className="media-item">
                <span className="media-item__kind">
                  <Icon size={14} />
                  {asset.kind}
                  <span className="media-item__id">{asset.id.slice(0, 6)}</span>
                </span>
                <button className="btn btn-icon" title="Add to composition" onClick={() => handleAdd(i)}>
                  <Plus size={14} />
                </button>
                <button className="btn btn-icon" title="Remove from project" onClick={() => handleRemove(asset.id)}>
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
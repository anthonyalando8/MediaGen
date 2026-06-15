// apps/editor/src/components/MediaPalette.tsx
import { Plus, Trash2, Upload } from "lucide-react";
import type { Id } from "core";
import { addMediaNode } from "../commands/add-media";
import { useRegistry } from "../bootstrap/registry-context";
import { fileToAssetRef } from "../persistence/asset-upload";
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

  function handleAdd(assetIndex: number): void {
    const state = store.getState();
    state.apply(addMediaNode(activeComp(state), registry, media[assetIndex]));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const asset = await fileToAssetRef(file);
    const state = store.getState();
    state.addAsset(asset);

    const op = addMediaNode(activeComp(state), registry, asset);
    state.apply(op);
    const node = op.after as unknown as { id: Id };
    state.select([node.id]);
  }

  function handleRemove(assetId: Id): void {
    store.getState().removeAsset(assetId);
  }

  return (
    <div className="media-section">
      <div className="panel__header">Media</div>

      <label className="btn" title="Upload an image or video">
        <Upload size={14} />
        Upload
        <input type="file" accept="image/*,video/*" onChange={handleUpload} style={{ display: "none" }} />
      </label>

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
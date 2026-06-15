// apps/editor/src/components/MediaPalette.tsx
import { Plus } from "lucide-react";
import { addMediaNode } from "../commands/add-media";
import { useRegistry } from "../bootstrap/registry-context";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { getKindIcon } from "./kind-icons";

/**
 * The "add-media palette" (Deliverable 11 Week 7): lists `project.assets`
 * (image/video) with a button to add each as a node. Phase 1 has no
 * upload/import UI yet (that's later-phase `apps/api` work) — `assets` is
 * empty until then, so this renders a placeholder.
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

  return (
    <div className="media-section">
      <div className="panel__header">Media</div>
      {media.length === 0 ? (
        <p className="panel__empty">No media yet — asset upload arrives in a later phase.</p>
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
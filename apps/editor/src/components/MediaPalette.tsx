// apps/editor/src/components/MediaPalette.tsx
import { addMediaNode } from "../commands/add-media";
import { useRegistry } from "../bootstrap/registry-context";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

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
    <div style={{ borderBottom: "1px solid #333", padding: 8 }}>
      <h4 style={{ margin: "0 0 4px" }}>Media</h4>
      {media.length === 0 ? (
        <p style={{ opacity: 0.6, fontSize: 12, margin: 0 }}>No media yet — asset upload arrives in a later phase.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {media.map((asset, i) => (
            <li key={asset.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                {asset.kind} <small>({asset.id.slice(0, 6)})</small>
              </span>
              <button onClick={() => handleAdd(i)}>+ Add</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
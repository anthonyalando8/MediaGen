// apps/editor/src/components/LayerPanel.tsx
import type { DragEvent, MouseEvent } from "react";
import { useState } from "react";
import type { Id } from "core";
import { MediaPalette } from "./MediaPalette";
import { reorderNode } from "../commands/reorder";
import { setNodeHidden, setNodeLocked } from "../commands/toggle-node-flag";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

/**
 * Layer tree — reorder, select, hide/lock (Deliverable 09 §9.1, Week 7).
 * Phase 1: a flat list of the active composition's top-level layers
 * (nested group children aren't author-able yet — see
 * commands/find-node-index.ts). Click selects; shift/ctrl+click toggles
 * multi-select; native HTML5 drag-and-drop reorders (z-order = array
 * order, Deliverable 07).
 */
export function LayerPanel() {
  const store = useEditorStoreApi();
  const root = useEditorStore((s) => activeComp(s).root);
  const selection = useEditorStore((s) => s.selection);
  const [dragOverId, setDragOverId] = useState<Id | null>(null);

  function handleSelect(e: MouseEvent, nodeId: Id): void {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const next = selection.includes(nodeId) ? selection.filter((id) => id !== nodeId) : [...selection, nodeId];
      store.getState().select(next);
    } else {
      store.getState().select([nodeId]);
    }
  }

  function handleToggleHidden(nodeId: Id, hidden: boolean): void {
    const state = store.getState();
    state.apply(setNodeHidden(activeComp(state), nodeId, !hidden));
  }

  function handleToggleLocked(nodeId: Id, locked: boolean): void {
    const state = store.getState();
    state.apply(setNodeLocked(activeComp(state), nodeId, !locked));
  }

  function handleDragStart(e: DragEvent, nodeId: Id): void {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", nodeId);
  }

  function handleDragOver(e: DragEvent, nodeId: Id): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(nodeId);
  }

  function handleDrop(e: DragEvent, toIndex: number): void {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData("text/plain") as Id;
    if (!draggedId) return;
    const state = store.getState();
    state.apply(reorderNode(activeComp(state), draggedId, toIndex));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid #333", height: "100%" }}>
      <MediaPalette />
      <div style={{ flex: 1, overflowY: "auto" }}>
        {root.length === 0 ? (
          <p style={{ opacity: 0.6, padding: 8 }}>No layers yet — add one from the toolbar.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {root.map((node, index) => {
              const hidden = Boolean(node.hidden);
              const locked = Boolean(node.locked);
              return (
                <li
                  key={node.id}
                  draggable={!locked}
                  onDragStart={(e) => handleDragStart(e, node.id)}
                  onDragOver={(e) => handleDragOver(e, node.id)}
                  onDragLeave={() => setDragOverId((id) => (id === node.id ? null : id))}
                  onDrop={(e) => handleDrop(e, index)}
                  onClick={(e) => handleSelect(e, node.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 4px",
                    cursor: locked ? "default" : "grab",
                    opacity: hidden ? 0.5 : 1,
                    background: selection.includes(node.id) ? "#2a3f5f" : "transparent",
                    outline: dragOverId === node.id ? "1px dashed #888" : "none",
                  }}
                >
                  <button
                    aria-pressed={hidden}
                    title={hidden ? "Show layer" : "Hide layer"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleHidden(node.id, hidden);
                    }}
                  >
                    {hidden ? "Show" : "Hide"}
                  </button>
                  <button
                    aria-pressed={locked}
                    title={locked ? "Unlock layer" : "Lock layer"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleLocked(node.id, locked);
                    }}
                  >
                    {locked ? "Unlock" : "Lock"}
                  </button>
                  <span style={{ flex: 1, fontWeight: selection.includes(node.id) ? "bold" : "normal" }}>
                    {node.name} <small>({node.kind})</small>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
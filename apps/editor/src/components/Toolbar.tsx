// apps/editor/src/components/Toolbar.tsx
import type { Id, NodeKindId } from "core";
import { addNode } from "../commands/add-node";
import { groupNodes } from "../commands/group-nodes";
import { useRegistry } from "../bootstrap/registry-context";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import type { Tool } from "../store/selection";

const ADDABLE_KINDS: { kind: NodeKindId; label: string }[] = [
  { kind: "shape", label: "Shape" },
  { kind: "text", label: "Text" },
  { kind: "group", label: "Group" },
];

const TOOLS: Tool[] = ["select", "text", "shape"];

/** Add node · group selection · undo/redo · tool select (Deliverable 09 §9.1). */
export function Toolbar() {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const canUndo = useEditorStore((s) => s.canUndo());
  const canRedo = useEditorStore((s) => s.canRedo());
  const tool = useEditorStore((s) => s.tool);
  const selection = useEditorStore((s) => s.selection);

  function handleAdd(kind: NodeKindId): void {
    const state = store.getState();
    state.apply(addNode(activeComp(state), registry, kind));
  }

  function handleGroup(): void {
    const state = store.getState();
    const op = groupNodes(activeComp(state), registry, selection);
    state.apply(op);
    // The group lands at `after.group`'s id, inserted at `after.at` — select it
    // so the InspectorPanel/gizmo immediately reflect the new group node.
    const after = op.after as unknown as { group: { id: Id }; at: number };
    state.select([after.group.id]);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderBottom: "1px solid #333" }}>
      {ADDABLE_KINDS.map(({ kind, label }) => (
        <button key={kind} onClick={() => handleAdd(kind)}>
          + {label}
        </button>
      ))}

      <button disabled={selection.length < 2} onClick={handleGroup}>
        Group Selection
      </button>

      <span style={{ flex: 1 }} />

      {TOOLS.map((t) => (
        <button key={t} aria-pressed={tool === t} onClick={() => store.getState().setTool(t)}>
          {t}
        </button>
      ))}

      <span style={{ flex: 1 }} />

      <button disabled={!canUndo} onClick={() => store.getState().undo()}>
        Undo
      </button>
      <button disabled={!canRedo} onClick={() => store.getState().redo()}>
        Redo
      </button>
    </div>
  );
}
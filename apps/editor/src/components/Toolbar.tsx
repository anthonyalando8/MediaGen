// apps/editor/src/components/Toolbar.tsx
import { Group, MousePointer2, Redo2, Sliders, Square, Trash2, Type, Undo2, Ungroup, Waves } from "lucide-react";
import type { Id, NodeKindId } from "core";
import { addNode, appendNodeOp } from "../commands/add-node";
import { setNodeProp } from "../commands/set-node-prop";
import { groupNodes } from "../commands/group-nodes";
import { ungroupNode } from "../commands/ungroup-node";
import { useRegistry } from "../bootstrap/registry-context";
import { deleteSelection } from "../store/delete-selection";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import type { Tool } from "../store/selection";

const ADDABLE_KINDS: { kind: NodeKindId; label: string; icon: typeof Square }[] = [
  { kind: "shape", label: "Shape", icon: Square },
  { kind: "text", label: "Text", icon: Type },
  { kind: "group", label: "Group", icon: Group },
  { kind: "null", label: "Null", icon: MousePointer2 },
];

const TOOLS: { tool: Tool; label: string; icon: typeof Square }[] = [
  { tool: "select", label: "Select", icon: MousePointer2 },
  { tool: "text", label: "Text", icon: Type },
  { tool: "shape", label: "Shape", icon: Square },
];

const ICON_SIZE = 15;

/** Add node · group selection · undo/redo · tool select (Deliverable 09 §9.1). */
export function Toolbar() {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const canUndo = useEditorStore((s) => s.canUndo());
  const canRedo = useEditorStore((s) => s.canRedo());
  const tool = useEditorStore((s) => s.tool);
  const selection = useEditorStore((s) => s.selection);
  const selectedKind = useEditorStore((s) => {
    if (s.selection.length !== 1) return undefined;
    return activeComp(s).root.find((n) => n.id === s.selection[0])?.kind;
  });

  function handleAdd(kind: NodeKindId): void {
    const state = store.getState();
    state.apply(addNode(activeComp(state), registry, kind));
  }

  function handleAddAdjustment(): void {
    const state = store.getState();
    state.apply(appendNodeOp(activeComp(state), registry, "shape", { isAdjustment: true, name: "Adjustment" }));
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

  function handleUngroup(): void {
    const state = store.getState();
    const op = ungroupNode(activeComp(state), selection[0]);
    state.apply(op);
    // `op.before.group.children` are the now-restored top-level nodes, in order.
    const before = op.before as unknown as { group: { children: { id: Id }[] }; at: number };
    state.select(before.group.children.map((c) => c.id));
  }

  function handleDelete(): void {
    deleteSelection(store);
  }

  return (
    <div className="toolbar">
      <div className="toolbar__brand">
        <Waves size={18} />
        <span className="toolbar__brand-name">SeaBytes</span>
      </div>

      <div className="btn-group">
        {ADDABLE_KINDS.map(({ kind, label, icon: Icon }) => (
          <button key={kind} className="btn" title={`Add ${label}`} onClick={() => handleAdd(kind)}>
            <Icon size={ICON_SIZE} />
            {label}
          </button>
        ))}
        <button className="btn" title="Add Adjustment Layer" onClick={handleAddAdjustment}>
          <Sliders size={ICON_SIZE} />
          Adj
        </button>
      </div>

      <button className="btn" disabled={selection.length < 2} onClick={handleGroup} title="Group the selected layers">
        <Group size={ICON_SIZE} />
        Group
      </button>

      <button className="btn" disabled={selectedKind !== "group"} onClick={handleUngroup} title="Ungroup the selected group">
        <Ungroup size={ICON_SIZE} />
        Ungroup
      </button>

      <button className="btn btn-icon" disabled={selection.length === 0} onClick={handleDelete} title="Delete the selected layer(s)">
        <Trash2 size={ICON_SIZE} />
      </button>

      <span className="toolbar__spacer" />

      <div className="btn-group">
        {TOOLS.map(({ tool: t, label, icon: Icon }) => (
          <button key={t} className="btn btn-icon" aria-pressed={tool === t} title={label} onClick={() => store.getState().setTool(t)}>
            <Icon size={ICON_SIZE} />
          </button>
        ))}
      </div>

      <span className="toolbar__spacer" />

      <div className="btn-group">
        <button className="btn btn-icon" disabled={!canUndo} onClick={() => store.getState().undo()} title="Undo">
          <Undo2 size={ICON_SIZE} />
        </button>
        <button className="btn btn-icon" disabled={!canRedo} onClick={() => store.getState().redo()} title="Redo">
          <Redo2 size={ICON_SIZE} />
        </button>
      </div>
    </div>
  );
}
// apps/editor/src/components/ParentPicker.tsx
//
// Phase 2 §4.4 — inspector control for node.parentId. Shows a dropdown of
// all OTHER top-level nodes the user can parent this node to, plus "None"
// to clear. Only shows when there are at least 2 nodes (nothing to parent
// to with only 1 layer). Scoped to top-level root, matching the existing
// Phase 1 command scope (find-node-index.ts).

import type { Node } from "core";
import { clearParentOp, setParentOp } from "../commands/set-parent";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { Section } from "./inspector-fields";

export function ParentPicker({ node, root }: { node: Node; root: Node[] }) {
  const store = useEditorStoreApi();

  // Only nodes other than this one are valid parents
  const candidates = root.filter((n) => n.id !== node.id);
  if (candidates.length === 0) return null;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const val = e.target.value;
    const state = store.getState();
    const comp = activeComp(state);
    if (val === "") {
      state.apply(clearParentOp(comp, node.id));
    } else {
      state.apply(setParentOp(comp, node.id, val as never));
    }
  }

  return (
    <Section title="Parent">
      <select className="inspector-select" value={(node.parentId as string | undefined) ?? ""} onChange={handleChange}>
        <option value="">None</option>
        {candidates.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </Section>
  );
}
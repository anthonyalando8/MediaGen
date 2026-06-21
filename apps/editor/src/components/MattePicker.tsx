// apps/editor/src/components/MattePicker.tsx
//
// Phase 2 §4.2 — track matte picker. A sibling node's alpha or luma channel
// stencils this node. Shows a source-node dropdown + mode selector when a
// matte is active, or just a "Set matte source…" dropdown when none.
//
// UI/UX redesign: collapsed by default. Logic unchanged.

import type { Node } from "core";
import { clearMatteOp, setMatteOp } from "../commands/set-matte";
import type { MatteMode } from "../commands/set-matte";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { Section } from "./inspector-fields";

const MATTE_MODES: { value: MatteMode; label: string }[] = [
  { value: "alpha", label: "Alpha" },
  { value: "alpha-inv", label: "Alpha Inverted" },
  { value: "luma", label: "Luma" },
  { value: "luma-inv", label: "Luma Inverted" },
];

export function MattePicker({ node, root }: { node: Node; root: Node[] }) {
  const store = useEditorStoreApi();
  const candidates = root.filter((n) => n.id !== node.id);
  if (candidates.length === 0) return null;

  const matte = node.matte as { sourceNodeId: string; type: MatteMode } | null | undefined;

  function handleSource(e: React.ChangeEvent<HTMLSelectElement>): void {
    const val = e.target.value;
    const state = store.getState();
    const comp = activeComp(state);
    if (!val) {
      state.apply(clearMatteOp(comp, node.id));
    } else {
      state.apply(setMatteOp(comp, node.id, val as never, matte?.type ?? "alpha"));
    }
  }

  function handleMode(e: React.ChangeEvent<HTMLSelectElement>): void {
    if (!matte) return;
    const state = store.getState();
    const comp = activeComp(state);
    state.apply(setMatteOp(comp, node.id, matte.sourceNodeId as never, e.target.value as MatteMode));
  }

  function handleClear(): void {
    const state = store.getState();
    state.apply(clearMatteOp(activeComp(state), node.id));
  }

  return (
    <Section title="Track Matte" defaultOpen={false}>
      <div className="matte-picker__row">
        <span className="field-row__label">Source</span>
        <select value={matte?.sourceNodeId ?? ""} onChange={handleSource}>
          <option value="">None</option>
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </div>
      {matte && (
        <div className="matte-picker__row">
          <span className="field-row__label">Mode</span>
          <select value={matte.type} onChange={handleMode}>
            {MATTE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button className="matte-picker__clear" onClick={handleClear} title="Remove matte">
            ×
          </button>
        </div>
      )}
    </Section>
  );
}

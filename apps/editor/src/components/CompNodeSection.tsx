// apps/editor/src/components/CompNodeSection.tsx
//
// Phase 2 §8 — inspector section for comp-kind nodes. Shows:
//   - Source composition name (read-only, with a link-style chip)
//   - Exposed prop overrides: each PropBinding declared on the source
//     Composition renders a labelled field that writes into
//     compNode.props[binding.key] via setNodeProp

import type { Json, Node } from "core";
import { setNodeProp } from "../commands/set-node-prop";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { Section } from "./inspector-fields";

export function CompNodeSection({ node }: { node: Node }) {
  const store = useEditorStoreApi();

  // Resolve the source composition from project.comps
  const compId = node.source?.compId;
  const sourceComp = useEditorStore((s) => {
    if (!compId) return undefined;
    return (s.document.project.comps as Record<string, import("core").Composition>)[compId as string];
  });

  if (!compId) {
    return (
      <Section title="Source" defaultOpen>
        <p className="panel__empty" style={{ fontSize: "11px" }}>No source composition set.</p>
      </Section>
    );
  }

  function handlePropChange(key: string, value: Json): void {
    const state = store.getState();
    state.apply(setNodeProp(activeComp(state), node.id, `props.${key}`, value));
  }

  const exposed = sourceComp?.exposed ?? [];

  return (
    <Section title="Source" defaultOpen>
      <div className="comp-node__source-row">
        <span className="field-row__label">Composition</span>
        <span className="comp-node__source-name">{sourceComp?.name ?? compId}</span>
      </div>
      {exposed.length > 0 && (
        <Section title="Overrides" defaultOpen>
          {exposed.map((binding) => {
            const currentValue = (node.props as Record<string, Json>)[binding.key];
            return (
              <label key={binding.key} className="field-row">
                <span className="field-row__label">{binding.label}</span>
                <input
                  type="text"
                  value={typeof currentValue === "string" || typeof currentValue === "number" ? String(currentValue) : ""}
                  placeholder={`Override ${binding.label}…`}
                  onChange={(e) => handlePropChange(binding.key, e.target.value)}
                />
              </label>
            );
          })}
        </Section>
      )}
    </Section>
  );
}
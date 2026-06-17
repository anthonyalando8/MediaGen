// apps/editor/src/components/EffectStackPanel.tsx
//
// Phase 2 §6's "the inspector is free" — renders one Section per
// `node.effects[]` entry, each entry's controls auto-generated from its
// EffectDef.schema.inspector (getEffectStackEntries, effect-fields.ts),
// reusing InspectorPanel's own FieldRow/FieldControl so a new effect's
// inspector fields render here with zero new UI code, exactly like a new
// NodeKind's fields render in InspectorPanel itself. Mounted inside
// InspectorPanel below the kind-specific section.

import type { Json, Node } from "core";
import { useEffectRegistry } from "../bootstrap/effect-registry-context";
import { addEffectOp, removeEffectOp } from "../commands/add-effect";
import { setNodeProp } from "../commands/set-node-prop";
import { getEffectStackEntries } from "../inspector/effect-fields";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { FieldRow } from "./inspector-fields";

export function EffectStackPanel({ node }: { node: Node }) {
  const store = useEditorStoreApi();
  const effectRegistry = useEffectRegistry();
  const entries = getEffectStackEntries(node, effectRegistry);
  const availableEffects = effectRegistry.list();

  function handleFieldChange(path: string, value: Json): void {
    const state = store.getState();
    state.apply(setNodeProp(activeComp(state), node.id, path, value));
  }

  function handleToggleEnabled(effectIndex: number, enabled: boolean): void {
    const state = store.getState();
    state.apply(setNodeProp(activeComp(state), node.id, `effects.${effectIndex}.enabled`, enabled));
  }

  function handleRemove(refId: string): void {
    const state = store.getState();
    state.apply(removeEffectOp(activeComp(state), node.id, refId as never));
  }

  function handleAdd(effectKey: string): void {
    if (!effectKey) return;
    const def = effectRegistry.tryGet(effectKey);
    if (!def) return;
    const state = store.getState();
    state.apply(addEffectOp(activeComp(state), node.id, def));
  }

  return (
    <div className="inspector-section effect-stack">
      <h4 className="inspector-section__title">Effects</h4>
      {entries.length === 0 && <p className="panel__empty effect-stack__empty">No effects applied.</p>}
      {entries.map((entry) => (
        <div key={entry.refId} className="effect-stack__entry">
          <div className="effect-stack__entry-header">
            <label className="effect-stack__enabled">
              <input type="checkbox" checked={entry.enabled} onChange={(e) => handleToggleEnabled(entry.effectIndex, e.target.checked)} />
              <span>{entry.displayName}</span>
            </label>
            <button type="button" className="effect-stack__remove" aria-label={`Remove ${entry.displayName}`} onClick={() => handleRemove(entry.refId)}>
              ×
            </button>
          </div>
          {entry.fields.map((field) => (
            <FieldRow key={field.path} field={field} onChange={(value) => handleFieldChange(field.path, value)} />
          ))}
        </div>
      ))}
      <label className="effect-stack__add">
        <span className="field-row__label">Add effect</span>
        <select value="" onChange={(e) => handleAdd(e.target.value)}>
          <option value="" disabled>
            Choose an effect…
          </option>
          {availableEffects.map((def) => (
            <option key={def.effect} value={def.effect}>
              {def.displayName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
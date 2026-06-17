// apps/editor/src/components/InspectorPanel.tsx
//
// Schema-driven from NodeKind.schema.inspector (Deliverable 09 §9.1, Week
// 8). Renders `getInspectorFields(node, registry)` — COMMON_INSPECTOR_FIELDS
// (name/opacity/blend/transform) plus the selected node's kind-specific
// fields — generically by `field.control`. Never branches on `node.kind`
// for FIELD DEFINITIONS: a new NodeKind's `schema.inspector` entries render
// here for free (gate 12.1's "6th NodeKind" property).
//
// `partitionFields` below groups the flat field list into "Appearance" /
// "Transform" / kind-specific sections purely by PATH PATTERN (not
// `node.kind`) — a UI-only grouping that any future kind's fields fall into
// automatically via the catch-all "Properties"-style section.
//
// Every control's onChange is `setNodeProp(comp, node.id, field.path,
// value)` -> `apply()` — one generic command for the whole panel.

import type { Json } from "core";
import { useRegistry } from "../bootstrap/registry-context";
import { setNodeProp } from "../commands/set-node-prop";
import { getInspectorFields } from "../inspector/fields";
import type { InspectorFieldValue } from "../inspector/fields";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { getKindIcon } from "./kind-icons";
import { EffectStackPanel } from "./EffectStackPanel";
import { FieldRow, Section } from "./inspector-fields";
export { FieldControl, FieldRow } from "./inspector-fields";

const TRANSFORM_PREFIX = "transform.";
const GENERAL_PATHS = new Set(["opacity", "blend"]);

/** Splits `fields` into name / general / transform / kind-specific groups, by PATH PATTERN — see module doc. */
function partitionFields(fields: InspectorFieldValue[]) {
  const general: InspectorFieldValue[] = [];
  const transform: InspectorFieldValue[] = [];
  const rest: InspectorFieldValue[] = [];
  let name: InspectorFieldValue | undefined;
  for (const field of fields) {
    if (field.path === "name") name = field;
    else if (GENERAL_PATHS.has(field.path)) general.push(field);
    else if (field.path.startsWith(TRANSFORM_PREFIX)) transform.push(field);
    else rest.push(field);
  }
  return { name, general, transform, rest };
}

export function InspectorPanel() {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const selection = useEditorStore((s) => s.selection);
  const root = useEditorStore((s) => activeComp(s).root);

  if (selection.length === 0) {
    return (
      <div className="panel panel--right">
        <p className="panel__empty">Nothing selected.</p>
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="panel panel--right">
        <p className="panel__empty">{selection.length} layers selected.</p>
      </div>
    );
  }

  const node = root.find((n) => n.id === selection[0]);
  if (!node) {
    return (
      <div className="panel panel--right">
        <p className="panel__empty">Nothing selected.</p>
      </div>
    );
  }

  function handleChange(path: string, value: Json): void {
    const state = store.getState();
    state.apply(setNodeProp(activeComp(state), node!.id, path, value));
  }

  const { name, general, transform, rest } = partitionFields(getInspectorFields(node, registry));
  const Icon = getKindIcon(node.kind);
  const kindTitle = node.kind.charAt(0).toUpperCase() + node.kind.slice(1);

  return (
    <div className="panel panel--right">
      <div className="inspector__header">
        <span className="inspector__icon">
          <Icon size={16} />
        </span>
        <div className="inspector__heading">
          {name ? (
            <input
              className="inspector__name-input"
              type="text"
              value={typeof name.value === "string" ? name.value : ""}
              onChange={(e) => handleChange(name.path, e.target.value)}
            />
          ) : (
            <div className="inspector__name-input">{node.name}</div>
          )}
          <div className="inspector__kind">{node.kind}</div>
        </div>
      </div>
      <div className="panel__body">
        {general.length > 0 && (
          <Section title="Appearance">
            {general.map((field) => (
              <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
            ))}
          </Section>
        )}
        {transform.length > 0 && (
          <Section title="Transform">
            {transform.map((field) => (
              <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
            ))}
          </Section>
        )}
        {rest.length > 0 && (
          <Section title={kindTitle}>
            {rest.map((field) => (
              <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
            ))}
          </Section>
        )}
        <EffectStackPanel node={node} />
      </div>
    </div>
  );
}
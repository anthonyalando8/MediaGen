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

import type { ChangeEvent, ReactNode } from "react";
import { oklchToHex } from "renderer-webgl";
import type { ColorOKLCH, Json } from "core";
import { useRegistry } from "../bootstrap/registry-context";
import { setNodeProp } from "../commands/set-node-prop";
import { getInspectorFields } from "../inspector/fields";
import type { InspectorFieldValue } from "../inspector/fields";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { getKindIcon } from "./kind-icons";

function ColorControl({ value, onChange }: { value: unknown; onChange: (value: Json) => void }) {
  const color: ColorOKLCH = value && typeof value === "object" ? (value as ColorOKLCH) : { l: 0, c: 0, h: 0 };
  const hex = `#${oklchToHex(color).toString(16).padStart(6, "0")}`;

  function setChannel(channel: "l" | "c" | "h", e: ChangeEvent<HTMLInputElement>): void {
    onChange({ ...color, [channel]: Number(e.target.value) } as unknown as Json);
  }

  return (
    <span className="color-control">
      <span className="color-swatch" style={{ background: hex }} />
      <input type="number" step={0.01} title="Lightness" value={color.l} onChange={(e) => setChannel("l", e)} />
      <input type="number" step={0.01} title="Chroma" value={color.c} onChange={(e) => setChannel("c", e)} />
      <input type="number" step={1} title="Hue" value={color.h} onChange={(e) => setChannel("h", e)} />
    </span>
  );
}

function FieldControl({ field, onChange }: { field: InspectorFieldValue; onChange: (value: Json) => void }) {
  switch (field.control) {
    case "text":
      return <input type="text" value={typeof field.value === "string" ? field.value : ""} onChange={(e) => onChange(e.target.value)} />;

    case "number":
      return <input type="number" value={typeof field.value === "number" ? field.value : 0} onChange={(e) => onChange(Number(e.target.value))} />;

    case "toggle":
      return <input type="checkbox" checked={Boolean(field.value)} onChange={(e) => onChange(e.target.checked)} />;

    case "select": {
      const options = field.options ?? [];
      const value = typeof field.value === "string" ? field.value : options[0] ?? "";
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    case "color":
      return <ColorControl value={field.value} onChange={onChange} />;

    case "asset":
      // P1: assets are attached at node-creation time via the add-media
      // palette (MediaPalette.tsx, Week 7) — no asset browser yet to
      // re-target an existing node, so this is read-only.
      return <span style={{ color: "var(--text-2)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{typeof field.value === "string" ? field.value.slice(0, 8) : "none"}</span>;

    default:
      return null;
  }
}

function FieldRow({ field, onChange }: { field: InspectorFieldValue; onChange: (value: Json) => void }) {
  return (
    <label className="field-row">
      <span className="field-row__label">{field.label}</span>
      <FieldControl field={field} onChange={onChange} />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="inspector-section">
      <h4 className="inspector-section__title">{title}</h4>
      {children}
    </div>
  );
}

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
      </div>
    </div>
  );
}
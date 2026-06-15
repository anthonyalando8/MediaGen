// apps/editor/src/components/InspectorPanel.tsx
//
// Schema-driven from NodeKind.schema.inspector (Deliverable 09 §9.1, Week
// 8). Renders `getInspectorFields(node, registry)` — COMMON_INSPECTOR_FIELDS
// (name/opacity/blend/transform) plus the selected node's kind-specific
// fields — generically by `field.control`. Never branches on `node.kind`:
// a new NodeKind's `schema.inspector` entries render here for free (gate
// 12.1's "6th NodeKind" property).
//
// Every control's onChange is `setNodeProp(comp, node.id, field.path,
// value)` -> `apply()` — one generic command for the whole panel.

import type { ChangeEvent } from "react";
import type { ColorOKLCH, Json } from "core";
import { useRegistry } from "../bootstrap/registry-context";
import { setNodeProp } from "../commands/set-node-prop";
import { getInspectorFields } from "../inspector/fields";
import type { InspectorFieldValue } from "../inspector/fields";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

const ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  margin: "4px 0",
  fontSize: 12,
} as const;

const NUMBER_INPUT_STYLE = { width: 64 };

function ColorControl({ value, onChange }: { value: unknown; onChange: (value: Json) => void }) {
  const color: ColorOKLCH = value && typeof value === "object" ? (value as ColorOKLCH) : { l: 0, c: 0, h: 0 };

  function setChannel(channel: "l" | "c" | "h", e: ChangeEvent<HTMLInputElement>): void {
    onChange({ ...color, [channel]: Number(e.target.value) } as unknown as Json);
  }

  return (
    <span style={{ display: "flex", gap: 4 }}>
      <input type="number" step={0.01} title="Lightness" style={{ width: 48 }} value={color.l} onChange={(e) => setChannel("l", e)} />
      <input type="number" step={0.01} title="Chroma" style={{ width: 48 }} value={color.c} onChange={(e) => setChannel("c", e)} />
      <input type="number" step={1} title="Hue" style={{ width: 48 }} value={color.h} onChange={(e) => setChannel("h", e)} />
    </span>
  );
}

function FieldControl({ field, onChange }: { field: InspectorFieldValue; onChange: (value: Json) => void }) {
  switch (field.control) {
    case "text":
      return (
        <input
          type="text"
          value={typeof field.value === "string" ? field.value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
      return (
        <input
          type="number"
          style={NUMBER_INPUT_STYLE}
          value={typeof field.value === "number" ? field.value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );

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
      return <span style={{ opacity: 0.6 }}>{typeof field.value === "string" ? field.value.slice(0, 8) : "none"}</span>;

    default:
      return null;
  }
}

export function InspectorPanel() {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const selection = useEditorStore((s) => s.selection);
  const root = useEditorStore((s) => activeComp(s).root);

  if (selection.length === 0) {
    return (
      <div style={{ borderLeft: "1px solid #333", padding: 8 }}>
        <p style={{ opacity: 0.6 }}>Nothing selected.</p>
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div style={{ borderLeft: "1px solid #333", padding: 8 }}>
        <p style={{ opacity: 0.6 }}>{selection.length} layers selected.</p>
      </div>
    );
  }

  const node = root.find((n) => n.id === selection[0]);
  if (!node) {
    return (
      <div style={{ borderLeft: "1px solid #333", padding: 8 }}>
        <p style={{ opacity: 0.6 }}>Nothing selected.</p>
      </div>
    );
  }

  function handleChange(path: string, value: Json): void {
    const state = store.getState();
    state.apply(setNodeProp(activeComp(state), node!.id, path, value));
  }

  return (
    <div style={{ borderLeft: "1px solid #333", padding: 8, overflowY: "auto" }}>
      <h3 style={{ marginTop: 0 }}>
        {node.name} <small style={{ opacity: 0.6 }}>({node.kind})</small>
      </h3>
      {getInspectorFields(node, registry).map((field) => (
        <label key={field.path} style={ROW_STYLE}>
          <span style={{ opacity: 0.8 }}>{field.label}</span>
          <FieldControl field={field} onChange={(value) => handleChange(field.path, value)} />
        </label>
      ))}
    </div>
  );
}
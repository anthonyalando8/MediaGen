// apps/editor/src/components/inspector-fields.tsx
//
// Schema-driven field rendering shared by InspectorPanel (a Node's own
// fields) and EffectStackPanel (an EffectRef's fields) — extracted out of
// InspectorPanel.tsx so the latter can import these without a circular
// dependency (EffectStackPanel is mounted BY InspectorPanel). Per Phase 2
// §6 ("the inspector is free"): both consumers resolve a flat
// `InspectorFieldValue[]` from a different schema source, then render it
// through this exact same generic switch-on-`field.control` — neither
// ever branches on `node.kind` or `EffectDef.effect` for field
// definitions (gate 12.1's "6th NodeKind"/new-effect property).

import type { ChangeEvent, ReactNode } from "react";
import { oklchToHex } from "renderer-webgl";
import type { ColorOKLCH, Json } from "core";
import type { InspectorFieldValue } from "../inspector/fields";

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

export function FieldControl({ field, onChange }: { field: InspectorFieldValue; onChange: (value: Json) => void }) {
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

export function FieldRow({ field, onChange }: { field: InspectorFieldValue; onChange: (value: Json) => void }) {
  return (
    <label className="field-row">
      <span className="field-row__label">{field.label}</span>
      <FieldControl field={field} onChange={onChange} />
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="inspector-section">
      <h4 className="inspector-section__title">{title}</h4>
      {children}
    </div>
  );
}
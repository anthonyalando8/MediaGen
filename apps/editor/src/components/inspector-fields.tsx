// apps/editor/src/components/inspector-fields.tsx
//
// Schema-driven field rendering shared by InspectorPanel (a Node's own
// fields) and EffectStackPanel (an EffectRef's fields). Per Phase 2 §6 ("the
// inspector is free"): both consumers resolve a flat `InspectorFieldValue[]`
// from a different schema source, then render it through this exact same
// generic switch-on-`field.control` — neither ever branches on `node.kind`
// or `EffectDef.effect` for field definitions (gate 12.1's "6th NodeKind").
//
// UI/UX redesign: `Section` is now a collapsible disclosure (chevron + click
// to toggle), with an optional `meta` slot for a right-aligned count badge
// and a `defaultOpen` flag so low-traffic sections (Transitions / Parent /
// Matte) can start collapsed. The open/closed flag is local UI state only —
// the field controls and their onChange→setNodeProp wiring are unchanged.

import type { ChangeEvent, ReactNode } from "react";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { hexStringToOklch, oklchToHex, rgbToOklch } from "renderer-webgl";
import type { ColorOKLCH, Json } from "core";
import type { InspectorFieldValue } from "../inspector/fields";

type ColorMode = "picker" | "hex" | "rgb";

function oklchToRgb(color: ColorOKLCH): [number, number, number] {
  const hex = oklchToHex(color);
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function ColorControl({ value, onChange }: { value: unknown; onChange: (value: Json) => void }) {
  const color: ColorOKLCH = value && typeof value === "object" ? (value as ColorOKLCH) : { l: 0, c: 0, h: 0 };
  const hexStr = `#${oklchToHex(color).toString(16).padStart(6, "0")}`;
  const [rgb] = [oklchToRgb(color)];
  const [mode, setMode] = useState<ColorMode>("picker");
  const [hexInput, setHexInput] = useState("");
  const [hexFocused, setHexFocused] = useState(false);

  const MODES: ColorMode[] = ["picker", "hex", "rgb"];
  const MODE_LABELS: Record<ColorMode, string> = { picker: "●", hex: "HEX", rgb: "RGB" };

  function cycleMode() {
    setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
  }

  return (
    <div className="color-control-v2">
      {/* Swatch + native picker always visible */}
      <label className="color-swatch-btn" title="Pick color">
        <span className="color-swatch" style={{ background: hexStr }} />
        <input
          type="color"
          value={hexStr}
          onChange={(e) => onChange(hexStringToOklch(e.target.value) as unknown as Json)}
        />
      </label>

      {/* Mode-specific input */}
      {mode === "picker" && (
        <span className="color-hex-display">{hexStr}</span>
      )}

      {mode === "hex" && (
        <input
          className="color-hex-input"
          type="text"
          value={hexFocused ? hexInput : hexStr}
          placeholder="#rrggbb"
          onFocus={() => { setHexFocused(true); setHexInput(hexStr); }}
          onBlur={() => { setHexFocused(false); }}
          onChange={(e) => {
            const v = e.target.value;
            setHexInput(v);
            if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
              onChange(hexStringToOklch(v) as unknown as Json);
            }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          spellCheck={false}
        />
      )}

      {mode === "rgb" && (
        <span className="color-rgb-inputs">
          {(["R", "G", "B"] as const).map((ch, i) => (
            <label key={ch} className="color-rgb-field">
              <span>{ch}</span>
              <input
                type="number"
                min={0} max={255} step={1}
                value={rgb[i]}
                onChange={(e) => {
                  const vals: [number, number, number] = [...rgb] as [number, number, number];
                  vals[i] = Math.min(255, Math.max(0, Number(e.target.value)));
                  onChange(rgbToOklch(...vals) as unknown as Json);
                }}
              />
            </label>
          ))}
        </span>
      )}

      {/* Mode toggle button */}
      <button type="button" className="color-mode-btn" title="Switch input mode" onClick={cycleMode}>
        {MODE_LABELS[mode]}
      </button>
    </div>
  );
}

export function FieldControl({ field, onChange }: { field: InspectorFieldValue; onChange: (value: Json) => void }) {
  switch (field.control) {
    case "text":
      return <input type="text" value={typeof field.value === "string" ? field.value : ""} onChange={(e) => onChange(e.target.value)} />;

    case "textarea":
      return (
        <textarea
          className="field-textarea"
          value={typeof field.value === "string" ? field.value : ""}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
        />
      );

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

export function Section({
  title,
  children,
  defaultOpen = true,
  meta,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  meta?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="insp-section">
      <button type="button" className="insp-section__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronRight className="insp-section__chev" data-open={open} size={13} />
        <span className="insp-section__title">{title}</span>
        {meta != null && <span className="insp-section__meta">{meta}</span>}
      </button>
      {open && <div className="insp-section__body">{children}</div>}
    </div>
  );
}
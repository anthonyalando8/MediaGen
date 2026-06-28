// apps/editor/src/components/RangeSlider.tsx
//
// Polished bounded numeric input for any property with a defined min+max.
// Layout:
//   [label] [━━━━●━━━━] [− value +] [unit]
//
// • Slider track fills proportionally between min and max
// • − / + buttons nudge by step
// • Click the value text to switch to a direct-entry input (blur or Enter commits)
// • Value is always clamped to [min, max]
// • Displays with smart precision (integers for step≥1, 2dp otherwise)

import { useCallback, useRef, useState } from "react";
import type { Json } from "core";

interface RangeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: Json) => void;
}

function fmt(v: number, step: number): string {
  if (step >= 1) return String(Math.round(v));
  if (step >= 0.1) return v.toFixed(1);
  return v.toFixed(2);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function RangeSlider({ label, value, min, max, step = 1, unit, onChange }: RangeSliderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const pct = ((clamp(value, min, max) - min) / (max - min)) * 100;

  function commit(raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(clamp(n, min, max));
    setEditing(false);
  }

  function nudge(dir: 1 | -1) {
    onChange(clamp(parseFloat((value + dir * step).toFixed(10)), min, max));
  }

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    const snapped = Math.round(raw / step) * step;
    onChange(clamp(parseFloat(snapped.toFixed(10)), min, max));
  }, [min, max, step, onChange]);

  const handleTrackDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();

    function update(ev: PointerEvent) {
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const raw = min + ratio * (max - min);
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(parseFloat(snapped.toFixed(10)), min, max));
    }
    function up() {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", up);
  }, [min, max, step, onChange]);

  return (
    <div className="range-slider">
      <span className="range-slider__label">{label}</span>

      {/* Track */}
      <div
        className="range-slider__track"
        onClick={handleTrackClick}
        onPointerDown={handleTrackDrag}
      >
        <div className="range-slider__fill" style={{ width: `${pct}%` }} />
        <div className="range-slider__thumb" style={{ left: `${pct}%` }} />
      </div>

      {/* − value + */}
      <div className="range-slider__controls">
        <button
          className="range-slider__nudge"
          onPointerDown={(e) => { e.preventDefault(); nudge(-1); }}
          tabIndex={-1}
        >−</button>

        {editing ? (
          <input
            ref={inputRef}
            className="range-slider__input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(draft);
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
          />
        ) : (
          <button
            className="range-slider__value"
            onClick={() => { setDraft(fmt(value, step)); setEditing(true); }}
            tabIndex={-1}
            title="Click to enter exact value"
          >
            {fmt(value, step)}{unit ? <span className="range-slider__unit">{unit}</span> : null}
          </button>
        )}

        <button
          className="range-slider__nudge"
          onPointerDown={(e) => { e.preventDefault(); nudge(1); }}
          tabIndex={-1}
        >+</button>
      </div>
    </div>
  );
}
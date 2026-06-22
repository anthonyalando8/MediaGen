// apps/editor/src/components/MotionPanel.tsx
//
// Two-step motion preset UI:
//   1. Click a preset name → its controls appear with defaults
//   2. Tweak values, click Apply → channels written to the node
//
// Each MotionPreset declares its own controls schema (MotionControl[]) so
// this panel renders them generically — no per-preset UI code.

import { useState } from "react";
import { kenBurnsPreset, parallaxPreset, popPreset, slamPunchPreset } from "motion";
import type { MotionControl, MotionPreset, MotionCtx } from "motion";
import { createId, createOp } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { Section } from "./inspector-fields";
import type { Node } from "core";

const PRESETS: MotionPreset[] = [kenBurnsPreset, popPreset, slamPunchPreset, parallaxPreset];

function defaultValues(controls: MotionControl[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const c of controls) out[c.key] = c.default;
  return out;
}

function ControlField({
  control,
  value,
  onChange,
}: {
  control: MotionControl;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  if (control.type === "number") {
    return (
      <label className="motion-panel__field">
        <span className="motion-panel__label">{control.label}</span>
        <div className="motion-panel__number-row">
          <input
            type="range"
            min={control.min}
            max={control.max}
            step={control.step}
            value={value as number}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="motion-panel__number-val">{(value as number).toFixed(2)}</span>
        </div>
      </label>
    );
  }
  return (
    <label className="motion-panel__field">
      <span className="motion-panel__label">{control.label}</span>
      <select value={value as string} onChange={(e) => onChange(e.target.value)}>
        {control.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function MotionPanel({ node }: { node: Node }) {
  const store = useEditorStoreApi();
  const comp = useEditorStore((s) => activeComp(s));

  const [activePreset, setActivePreset] = useState<MotionPreset | null>(null);
  const [options, setOptions] = useState<Record<string, number | string>>({});

  function handleSelectPreset(preset: MotionPreset): void {
    setActivePreset(preset);
    setOptions(defaultValues(preset.controls));
  }

  function handleOptionChange(key: string, value: number | string): void {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  function handleApply(): void {
    if (!activePreset) return;
    const ctx: MotionCtx = {
      nodeId: node.id,
      span: node.time,
      fps: comp.fps,
      size: comp.size,
      transform: node.transform,
    };

    // Build with current options — ensure all defaults are present
    const effectiveOptions = { ...defaultValues(activePreset.controls), ...options };
    const motion = activePreset.build(effectiveOptions);
    const channels = motion(ctx);
    if (channels.length === 0) return;

    const state = store.getState();
    const activeCompNow = activeComp(state);
    const nodeIndex = activeCompNow.root.findIndex((n) => n.id === node.id);
    if (nodeIndex === -1) return;

    // Replace channels on the same paths, keep unrelated ones
    const newPaths = new Set(channels.map((c) => c.path));
    const kept = activeCompNow.root[nodeIndex].channels.filter((c) => !newPaths.has(c.path));
    const merged = [...kept, ...channels];

    state.apply(createOp({
      type: "set",
      compId: activeCompNow.id,
      path: `/root/${nodeIndex}/channels`,
      before: activeCompNow.root[nodeIndex].channels as never,
      after: merged as never,
      txn: createId(),
    }));

    // Scrub to the clip's start frame and begin playing so the user
    // sees the animation immediately without having to manually press Play.
    store.getState().setPlayhead(node.time.start);
    store.getState().play();
  }

  return (
    <Section title="Motion" defaultOpen={true}>
      {/* Preset buttons */}
      <div className="motion-panel__presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`btn btn-sm${activePreset?.id === preset.id ? " btn-active" : ""}`}
            onClick={() => handleSelectPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Controls for the selected preset */}
      {activePreset && (
        <div className="motion-panel__controls">
          <div className="motion-panel__controls-header">{activePreset.label}</div>
          {activePreset.controls.map((control) => (
            <ControlField
              key={control.key}
              control={control}
              value={options[control.key] ?? control.default}
              onChange={(v) => handleOptionChange(control.key, v)}
            />
          ))}
          <div className="motion-panel__actions">
            <button className="btn btn-sm" onClick={() => setOptions(defaultValues(activePreset.controls))}>
              Reset
            </button>
            <button className="btn btn-sm btn-accent" onClick={handleApply}>
              Apply &amp; Play
            </button>
          </div>
        </div>
      )}

      {!activePreset && (
        <p className="motion-panel__hint">
          Select a preset to configure and apply.
        </p>
      )}
    </Section>
  );
}
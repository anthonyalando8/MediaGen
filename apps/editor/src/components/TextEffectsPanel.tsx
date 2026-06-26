// apps/editor/src/components/TextEffectsPanel.tsx
//
// Per-span text effects UI in the inspector's Text tab.
// Each span can have independently configured visual effects:
//   Stroke, Shadow/Glow, Highlight, Blur, Color Matrix
// All stored directly on TextSpan; rendered in the Pixi scene via GlyphRun.

import { useState, useSyncExternalStore } from "react";
import type { Node } from "core";
import type { TextSpan } from "core";
import type { ColorOKLCH } from "core";
import { createId, createOp } from "core";
import { useEditorStoreApi } from "../store/context";
import { getActiveSpanIndex, subscribeActiveSpan } from "../store/active-span-handle";
import { getActiveEditor } from "../store/editor-handle";
import { activeComp } from "../store/selectors";
import { hexStringToOklch, oklchToHex } from "renderer-webgl";
import { findNodeIndex } from "../commands/find-node-index";

// ── Helpers ───────────────────────────────────────────────────────────────

function colorToHex(c: ColorOKLCH): string {
  return `#${oklchToHex(c).toString(16).padStart(6, "0")}`;
}

function commitSpans(
  store: ReturnType<typeof useEditorStoreApi>,
  nodeId: import("core").Id,
  spans: TextSpan[]
) {
  const state = store.getState();
  const comp = activeComp(state);
  const idx = findNodeIndex(comp, nodeId);
  const node = comp.root[idx];
  const before = node.props as unknown as import("core").Json;
  const after = { ...(node.props as object), spans } as unknown as import("core").Json;
  state.apply(createOp({
    type: "set", compId: comp.id,
    path: `/root/${idx}/props`,
    before, after, txn: createId(),
  }));
}

function updateSpan(
  spans: TextSpan[],
  index: number,
  patch: Partial<TextSpan>
): TextSpan[] {
  return spans.map((s, i) => i === index ? { ...s, ...patch } : s);
}

// ── Colour swatch + picker ────────────────────────────────────────────────

function ColorPick({ value, onChange }: { value: ColorOKLCH; onChange: (c: ColorOKLCH) => void }) {
  return (
    <input
      type="color"
      className="text-fx-color"
      value={colorToHex(value)}
      onChange={(e) => onChange(hexStringToOklch(e.target.value))}
    />
  );
}

// ── Effect row toggle ─────────────────────────────────────────────────────

function EffectRow({
  label,
  active,
  onToggle,
  children,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`text-fx-row ${active ? "text-fx-row--active" : ""}`}>
      <label className="text-fx-row__header">
        <input type="checkbox" checked={active} onChange={onToggle} />
        <span className="text-fx-row__label">{label}</span>
      </label>
      {active && <div className="text-fx-row__body">{children}</div>}
    </div>
  );
}

function NumInput({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="text-fx-field">
      <span>{label}</span>
      <input type="number" className="insp-number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))} />
      {unit && <span className="text-fx-unit">{unit}</span>}
    </label>
  );
}

// ── Per-span effect editor ────────────────────────────────────────────────

function SpanEffectEditor({
  span, index, nodeId,
}: {
  span: TextSpan; index: number; nodeId: import("core").Id;
}) {
  const store = useEditorStoreApi();

  function patch(p: Partial<TextSpan>) {
    const state = store.getState();
    let comp = activeComp(state);
    const idx = findNodeIndex(comp, nodeId);
    let spans = (comp.root[idx].props.spans as unknown as TextSpan[]) ?? [];

    // If the editor is open and the current span has no ID, auto-create one
    // from the current selection so the effect binds to a real span.
    const editorSnap = getActiveEditor();
    if (editorSnap?.handle && !span.id) {
      editorSnap.handle.ensureSelectionIsSpan();
      // Re-read spans after potential auto-split
      comp = activeComp(store.getState());
      spans = (activeComp(store.getState()).root.find(n => n.id === nodeId)?.props.spans as unknown as TextSpan[]) ?? [];
    }

    commitSpans(store, nodeId, updateSpan(spans, index, p));
  }

  const WHITE: ColorOKLCH = { l: 1, c: 0, h: 0 };
  const BLACK: ColorOKLCH = { l: 0, c: 0, h: 0 };
  const ACCENT: ColorOKLCH = { l: 0.78, c: 0.15, h: 185 };

  const preview = span.text.replace(/\n/g, "↵").trim().slice(0, 18);

  return (
    <div className="text-fx-span">
      <div className="text-fx-span__header">
        <span className="text-fx-span__index">#{index + 1}</span>
        <span className="text-fx-span__text" title={span.text}>"{preview}"</span>
      </div>

      {/* ── Stroke ── */}
      <EffectRow
        label="Stroke"
        active={Boolean(span.stroke)}
        onToggle={() => patch({ stroke: span.stroke ? undefined : { color: BLACK, width: 2 } })}
      >
        {span.stroke && <>
          <label className="text-fx-field">
            <span>Color</span>
            <ColorPick value={span.stroke.color} onChange={(c) => patch({ stroke: { ...span.stroke!, color: c } })} />
          </label>
          <NumInput label="Width" value={span.stroke.width} min={0.5} max={20} step={0.5} unit="px"
            onChange={(v) => patch({ stroke: { ...span.stroke!, width: v } })} />
        </>}
      </EffectRow>

      {/* ── Shadow / Glow ── */}
      <EffectRow
        label="Shadow / Glow"
        active={Boolean(span.shadow)}
        onToggle={() => patch({ shadow: span.shadow ? undefined : { color: ACCENT, blur: 8, distance: 4, angle: Math.PI / 4, alpha: 0.8 } })}
      >
        {span.shadow && <>
          <label className="text-fx-field">
            <span>Color</span>
            <ColorPick value={span.shadow.color} onChange={(c) => patch({ shadow: { ...span.shadow!, color: c } })} />
          </label>
          <NumInput label="Blur" value={span.shadow.blur} min={0} max={40} step={1}
            onChange={(v) => patch({ shadow: { ...span.shadow!, blur: v } })} />
          <NumInput label="Distance" value={span.shadow.distance} min={0} max={40} step={1} unit="px"
            onChange={(v) => patch({ shadow: { ...span.shadow!, distance: v } })} />
          <NumInput label="Angle" value={Math.round(span.shadow.angle * 180 / Math.PI)} min={0} max={360} unit="°"
            onChange={(v) => patch({ shadow: { ...span.shadow!, angle: v * Math.PI / 180 } })} />
          <NumInput label="Alpha" value={span.shadow.alpha} min={0} max={1} step={0.05}
            onChange={(v) => patch({ shadow: { ...span.shadow!, alpha: v } })} />
          <p className="text-fx-tip">Set distance to 0 for neon glow</p>
        </>}
      </EffectRow>

      {/* ── Highlight ── */}
      <EffectRow
        label="Highlight"
        active={Boolean(span.highlight)}
        onToggle={() => patch({ highlight: span.highlight ? undefined : { color: { l: 0.9, c: 0.15, h: 60 }, padding: 4 } })}
      >
        {span.highlight && <>
          <label className="text-fx-field">
            <span>Color</span>
            <ColorPick value={span.highlight.color} onChange={(c) => patch({ highlight: { ...span.highlight!, color: c } })} />
          </label>
          <NumInput label="Padding" value={span.highlight.padding} min={0} max={20} step={1} unit="px"
            onChange={(v) => patch({ highlight: { ...span.highlight!, padding: v } })} />
        </>}
      </EffectRow>

      {/* ── Blur ── */}
      <EffectRow
        label="Blur"
        active={Boolean(span.blur)}
        onToggle={() => patch({ blur: span.blur ? undefined : 4 })}
      >
        {Boolean(span.blur) && (
          <NumInput label="Strength" value={span.blur ?? 4} min={0.5} max={20} step={0.5}
            onChange={(v) => patch({ blur: v })} />
        )}
      </EffectRow>

      {/* ── Color Matrix ── */}
      <EffectRow
        label="Color Adjust"
        active={Boolean(span.colorMatrix)}
        onToggle={() => patch({ colorMatrix: span.colorMatrix ? undefined : { brightness: 1, saturation: 1 } })}
      >
        {span.colorMatrix && <>
          <NumInput label="Brightness" value={span.colorMatrix.brightness ?? 1} min={0} max={3} step={0.05}
            onChange={(v) => patch({ colorMatrix: { ...span.colorMatrix!, brightness: v } })} />
          <NumInput label="Saturation" value={span.colorMatrix.saturation ?? 1} min={0} max={3} step={0.05}
            onChange={(v) => patch({ colorMatrix: { ...span.colorMatrix!, saturation: v } })} />
          <NumInput label="Hue" value={span.colorMatrix.hue ?? 0} min={0} max={360} unit="°"
            onChange={(v) => patch({ colorMatrix: { ...span.colorMatrix!, hue: v } })} />
          <NumInput label="Contrast" value={span.colorMatrix.contrast ?? 1} min={0} max={3} step={0.05}
            onChange={(v) => patch({ colorMatrix: { ...span.colorMatrix!, contrast: v } })} />
        </>}
      </EffectRow>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────

interface TextEffectsPanelProps {
  node: Node;
}

export function TextEffectsPanel({ node }: TextEffectsPanelProps) {
  const spans = (node.props.spans as unknown as TextSpan[] | undefined) ?? [];
  const [showAll, setShowAll] = useState(false);
  const activeSpanIndex = useSyncExternalStore(subscribeActiveSpan, getActiveSpanIndex);

  // Check if the text editor is currently open
  const editorIsOpen = getActiveEditor()?.handle !== null && getActiveEditor() !== null;

  // When editor is open: if a span is focused show only it; otherwise show
  // a prompt to select text. When editor is closed: show all spans or empty state.
  if (editorIsOpen && activeSpanIndex === null) {
    return (
      <div className="span-anim-empty">
        <p>Select a word in the text editor on the canvas, then effects will appear here for that word.</p>
        <p style={{ marginTop: 6, fontSize: 10, color: "var(--text-2)" }}>
          No need to split text first — selecting any word auto-creates a span for it.
        </p>
      </div>
    );
  }

  if (!editorIsOpen && spans.length === 0) {
    return (
      <div className="span-anim-empty">
        <p>Double-click the text on canvas, select a word, then effects for that word appear here.</p>
      </div>
    );
  }

  const focusedIndex = activeSpanIndex !== null && activeSpanIndex < spans.length ? activeSpanIndex : null;

  // When editor is open: show only focused span (or nothing — handled above).
  // When editor is closed: show all spans (for review/editing previously set effects).
  const visibleSpans = (editorIsOpen && focusedIndex !== null)
    ? [{ span: spans[focusedIndex], i: focusedIndex }]
    : (showAll || !editorIsOpen)
    ? spans.map((span, i) => ({ span, i }))
    : spans.map((span, i) => ({ span, i }));

  return (
    <div className="text-fx-panel">
      {editorIsOpen && focusedIndex !== null && (
        <div className="span-anim-focus-bar">
          <span>"{spans[focusedIndex].text.trim().slice(0, 24)}"</span>
        </div>
      )}
      {!editorIsOpen && spans.length > 1 && (
        <div className="span-anim-focus-bar">
          <span>{spans.length} spans with effects</span>
          <button className="btn btn-xs" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Collapse" : "Show all"}
          </button>
        </div>
      )}
      {visibleSpans.map(({ span, i }) => (
        <SpanEffectEditor key={span.id ?? i} span={span} index={i} nodeId={node.id} />
      ))}
    </div>
  );
}
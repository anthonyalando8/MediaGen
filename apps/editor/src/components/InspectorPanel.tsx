// apps/editor/src/components/InspectorPanel.tsx
//
// Schema-driven inspector (Deliverable 09 §9.1) — now organized into TABS
// instead of one long scrolling column (UI/UX redesign). The field system is
// unchanged: `getInspectorFields(node, registry)` still returns a flat
// `InspectorFieldValue[]` rendered generically by `field.control` via
// FieldRow — we never branch on `node.kind` for field DEFINITIONS. Tabs are a
// purely presentational routing layer on top of that flat list.
//
// Tabs (active tab lives in the store: `inspectorTab` / `setInspectorTab`):
//   • Properties — Transform + kind geometry (shape props, etc.) + the
//     low-traffic Parent / Matte / Layer settings (collapsed).
//   • Style — Appearance (opacity / blend) + Fill & Stroke (color fields) +
//     the Effects stack.
//   • Animate — Motion presets + Transitions.
//   • Text — ONLY for text nodes: typography (font / size / weight / line
//     height / color) + the per-character Format Selection bar, with a clear
//     "select text on canvas" instruction.
//
// Field → tab routing (`tabForField`) is by `field.control` + path PATTERN,
// so a future NodeKind's fields fall into a sensible tab automatically:
// color → Style (or Text, for text nodes); transform.* → Properties;
// everything else → the kind section (Properties for non-text, Text for
// text). Every control's onChange is still `setNodeProp(...)` → `apply()`.

import type { Json } from "core";
import { useRegistry } from "../bootstrap/registry-context";
import { setNodeProp } from "../commands/set-node-prop";
import { getInspectorFields } from "../inspector/fields";
import type { InspectorFieldValue } from "../inspector/fields";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import type { InspectorTab } from "../store/ui";
import { ADJUSTMENT_COLOR, getKindColor, getKindIcon } from "./kind-icons";
import { EffectStackPanel } from "./EffectStackPanel";
import { TransitionPanel } from "./TransitionPanel";
import { ParentPicker } from "./ParentPicker";
import { MattePicker } from "./MattePicker";
import { CompNodeSection } from "./CompNodeSection";
import { MotionPanel } from "./MotionPanel";
import { RichTextFormatBar } from "./RichTextFormatBar";
import { SpanAnimPanel } from "./SpanAnimPanel";
import { TextEffectsPanel } from "./TextEffectsPanel";
import { FieldRow, Section } from "./inspector-fields";
import { convertToPathOp } from "../commands/convert-to-path";
import { enterPathEditMode } from "../store/path-edit-handle";
export { FieldControl, FieldRow } from "./inspector-fields";

const TRANSFORM_PREFIX = "transform.";
const GENERAL_PATHS = new Set(["opacity", "blend"]);

/** Splits `fields` into name / general / transform / kind-specific groups, by PATH PATTERN. */
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

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "properties", label: "Properties" },
  { id: "style", label: "Style" },
  { id: "animate", label: "Animate" },
];

export function InspectorPanel() {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const selection = useEditorStore((s) => s.selection);
  const root = useEditorStore((s) => activeComp(s).root);
  const inspectorTab = useEditorStore((s) => s.inspectorTab);

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

  const isText = node.kind === "text";
  const { name, general, transform, rest } = partitionFields(getInspectorFields(node, registry));
  const Icon = getKindIcon(node.kind);
  const adjustment = Boolean(node.isAdjustment);
  const color = adjustment ? ADJUSTMENT_COLOR : getKindColor(node.kind);
  const kindTitle = node.kind.charAt(0).toUpperCase() + node.kind.slice(1);

  // For shape nodes, only show props relevant to the current shape type.
  const visibleRest = node.kind === "shape"
    ? rest.filter((f) => {
        const shape = node.props.shape as string;
        if (f.path === "props.sides")      return shape === "ngon";
        if (f.path === "props.points")     return shape === "star";
        if (f.path === "props.innerRatio") return shape === "star";
        if (f.path === "props.headRatio")  return shape === "arrow";
        if (f.path === "props.shaftRatio") return shape === "arrow";
        if (f.path === "props.radius")     return shape === "rect";
        return true;
      })
    : rest;

  // Route kind-specific fields. Color fields → Style (or Text, for text
  // nodes); the remaining kind fields are geometry (Properties) for non-text,
  // or typography (Text tab) for text nodes.
  const colorFields = visibleRest.filter((f) => f.control === "color");
  const nonColorRest = visibleRest.filter((f) => f.control !== "color");
  const geometryFields = isText ? [] : nonColorRest;     // Properties (non-text)
  const typographyFields = isText ? nonColorRest : [];   // Text tab
  const fillStrokeFields = isText ? [] : colorFields;    // Style (non-text)
  const textColorFields = isText ? colorFields : [];     // Text tab

  // The Text tab only exists for text nodes; fall back if it's stale.
  const tabs = isText ? [...TABS, { id: "text" as InspectorTab, label: "Text" }] : TABS;
  const activeTab: InspectorTab = inspectorTab === "text" && !isText ? "properties" : inspectorTab;

  const showConvertToPath =
    node.kind === "shape" && !["polygon", "line"].includes(node.props.shape as string);

  function handleConvertToPath(): void {
    const state = store.getState();
    const op = convertToPathOp(activeComp(state), node!.id);
    if (op) {
      state.apply(op);
      enterPathEditMode(String(node!.id));
    }
  }

  return (
    <div className="panel panel--right">
      {/* Header */}
      <div className="inspector__header">
        <span className="kind-chip kind-chip--lg" style={{ background: `${color}22`, border: `1px solid ${color}` }}>
          <Icon size={16} style={{ color }} />
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
          <div className="inspector__kind">{adjustment ? "Adjustment layer" : node.kind}</div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="insp-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="insp-tab"
            aria-selected={activeTab === t.id}
            onClick={() => store.getState().setInspectorTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel__body">
        {/* ── PROPERTIES ─────────────────────────────────────────────── */}
        {activeTab === "properties" && (
          <>
            {transform.length > 0 && (
              <Section title="Transform">
                {transform.map((field) => (
                  <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
                ))}
              </Section>
            )}
            {geometryFields.length > 0 && (
              <Section title={kindTitle}>
                {geometryFields.map((field) => (
                  <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
                ))}
                {showConvertToPath && (
                  <div style={{ paddingTop: "var(--space-2)" }}>
                    <button
                      className="btn btn-sm"
                      style={{ width: "100%" }}
                      title="Convert to editable bezier path"
                      onClick={handleConvertToPath}
                    >
                      Convert to path
                    </button>
                  </div>
                )}
              </Section>
            )}
            {node.kind === "comp" && <CompNodeSection node={node} />}
            <ParentPicker node={node} root={root} />
            <MattePicker node={node} root={root} />
            <Section title="Layer" defaultOpen={false}>
              <label className="inspector-checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(node.isAdjustment)}
                  onChange={(e) => handleChange("isAdjustment", e.target.checked)}
                />
                <span>
                  Adjustment layer
                  <span style={{ display: "block", color: "var(--text-2)", fontSize: "11px", marginTop: "1px" }}>
                    Effects apply to layers below
                  </span>
                </span>
              </label>
            </Section>
          </>
        )}

        {/* ── STYLE ──────────────────────────────────────────────────── */}
        {activeTab === "style" && (
          <>
            {general.length > 0 && (
              <Section title="Appearance">
                {general.map((field) => (
                  <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
                ))}
              </Section>
            )}
            {fillStrokeFields.length > 0 && (
              <Section title="Fill & Stroke">
                {fillStrokeFields.map((field) => (
                  <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
                ))}
              </Section>
            )}
            <EffectStackPanel node={node} />
          </>
        )}

        {/* ── ANIMATE ────────────────────────────────────────────────── */}
        {activeTab === "animate" && (
          <>
            <MotionPanel node={node} />
            <TransitionPanel node={node} root={root} />
          </>
        )}

        {/* ── TEXT (text nodes only) ─────────────────────────────────── */}
        {activeTab === "text" && isText && (
          <>
            {(typographyFields.length > 0 || textColorFields.length > 0) && (
              <Section title="Typography">
                {typographyFields.map((field) => (
                  <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
                ))}
                {textColorFields.map((field) => (
                  <FieldRow key={field.path} field={field} onChange={(value) => handleChange(field.path, value)} />
                ))}
              </Section>
            )}
            <RichTextFormatBar />
            <Section title="Span Animation" defaultOpen={false}>
              <SpanAnimPanel node={node} />
            </Section>
            <Section title="Text Effects" defaultOpen={false}>
              <TextEffectsPanel node={node} />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
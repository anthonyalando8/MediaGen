// apps/editor/src/components/EffectStackPanel.tsx
//
// Redesigned effect stack (Deliverables: visual cards, active stack with
// enable/disable + reorder + expand/collapse + delete, RangeSlider controls).
// Drop-in replacement for the original EffectStackPanel — same store/command
// surface:
//   • add     → addEffectOp(comp, node.id, def)        (via EffectsBrowser)
//   • remove  → removeEffectOp(comp, node.id, refId)
//   • enable  → setNodeProp(comp, node.id, "effects.i.enabled", bool)
//   • param   → setNodeProp(comp, node.id, field.path, value)  (field.path is
//               already "effects.i.props.key" from getEffectStackEntries)
//   • reorder → setNodeProp(comp, node.id, "effects", reorderedArray)  — the
//               generic command already understands the whole-array path; no
//               new command needed.
//
// Field RENDERING is still schema-driven: a numeric field with a bounded
// range (min+max) renders the polished RangeSlider; everything else falls
// back to the shared FieldRow/FieldControl (select, toggle, color, text).
// We never branch on the effect key for field definitions.

import { useMemo, useState } from "react";
import type { Json, Node } from "core";
import { useEffectRegistry } from "../bootstrap/effect-registry-context";
import { addEffectOp, removeEffectOp } from "../commands/add-effect";
import { setNodeProp } from "../commands/set-node-prop";
import { getEffectStackEntries } from "../inspector/effect-fields";
import type { InspectorFieldValue } from "../inspector/fields";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { categoryOf, categoryMeta } from "../inspector/effect-categories";
import { EffectsBrowser } from "./EffectsBrowser";
import { FieldRow, Section } from "./inspector-fields";
import { RangeSlider } from "./RangeSlider";
import { ChevronDown, Eye, EyeOff, GripVertical, Plus, Trash2 } from "lucide-react";

function isRangeField(f: InspectorFieldValue): boolean {
  return f.control === "number" && typeof f.min === "number" && typeof f.max === "number";
}

export function EffectStackPanel({ node }: { node: Node }) {
  const store = useEditorStoreApi();
  const effectRegistry = useEffectRegistry();
  const entries = getEffectStackEntries(node, effectRegistry);
  const availableEffects = effectRegistry.list();

  const [browserOpen, setBrowserOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(entries.slice(0, 1).map((e) => e.refId)));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const addedKeys = useMemo(() => new Set(entries.map((e) => e.effect)), [entries]);

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
    const def = effectRegistry.tryGet(effectKey);
    if (!def) return;
    const state = store.getState();
    state.apply(addEffectOp(activeComp(state), node.id, def));
  }

  function toggleExpand(refId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(refId) ? next.delete(refId) : next.add(refId);
      return next;
    });
  }

  function handleDrop(to: number): void {
    if (dragIndex === null || dragIndex === to) {
      setDragIndex(null);
      setDragOver(null);
      return;
    }
    const arr = [...(node.effects ?? [])];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(to, 0, moved);
    const state = store.getState();
    state.apply(setNodeProp(activeComp(state), node.id, "effects", arr as unknown as Json));
    setDragIndex(null);
    setDragOver(null);
  }

  return (
    <Section
      title="Effects"
      meta={
        <span className="fx-section__meta">
          <span className="insp-section__meta">{entries.length}</span>
          <button
            type="button"
            className={`fx-addbtn${browserOpen ? " fx-addbtn--active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setBrowserOpen((o) => !o);
            }}
          >
            <Plus size={13} className={browserOpen ? "fx-addbtn__icon fx-addbtn__icon--x" : "fx-addbtn__icon"} />
            {browserOpen ? "Done" : "Add"}
          </button>
        </span>
      }
    >
      {browserOpen && (
        <EffectsBrowser effects={availableEffects} addedKeys={addedKeys} onAdd={handleAdd} />
      )}

      {entries.length === 0 ? (
        <div className="fx-stack__empty">
          <div className="fx-stack__empty-title">No effects yet</div>
          <div className="fx-stack__empty-hint">
            Click <button type="button" className="fx-stack__empty-link" onClick={() => setBrowserOpen(true)}>+ Add</button> to browse the library.
          </div>
        </div>
      ) : (
        <div className="fx-stack">
          {entries.map((entry, i) => {
            const def = effectRegistry.tryGet(entry.effect);
            const meta = categoryMeta(def ? categoryOf(def) : "stylize");
            const open = expanded.has(entry.refId);
            const isOver = dragOver === i && dragIndex !== null && dragIndex !== i;
            return (
              <div
                key={entry.refId}
                className={`fx-entry${entry.enabled ? "" : " fx-entry--off"}${dragIndex === i ? " fx-entry--dragging" : ""}${isOver ? " fx-entry--over" : ""}`}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOver !== i) setDragOver(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(i);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDragOver(null);
                }}
              >
                <div className="fx-entry__head">
                  <span className="fx-entry__grip" aria-hidden="true"><GripVertical size={14} /></span>

                  <button
                    type="button"
                    className={`fx-entry__eye${entry.enabled ? " is-on" : ""}`}
                    title={entry.enabled ? "Disable effect" : "Enable effect"}
                    onClick={() => handleToggleEnabled(entry.effectIndex, !entry.enabled)}
                  >
                    {entry.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>

                  <span className="fx-entry__bar" style={{ background: meta.color }} />

                  <button type="button" className="fx-entry__title" onClick={() => toggleExpand(entry.refId)}>
                    <span className="fx-entry__name">{entry.displayName}</span>
                    <span className="fx-entry__badge" style={{ color: meta.color, background: `${meta.color}1f` }}>
                      {meta.label}
                    </span>
                  </button>

                  <ChevronDown
                    size={13}
                    className="fx-entry__chev"
                    data-open={open}
                    onClick={() => toggleExpand(entry.refId)}
                  />
                  <button type="button" className="fx-entry__del" title="Delete effect" onClick={() => handleRemove(entry.refId)}>
                    <Trash2 size={13} />
                  </button>
                </div>

                {open && (
                  <div className="fx-entry__body">
                    {entry.fields.map((field) =>
                      isRangeField(field) ? (
                        <RangeSlider
                          key={field.path}
                          label={field.label}
                          value={typeof field.value === "number" ? field.value : field.min ?? 0}
                          min={field.min as number}
                          max={field.max as number}
                          step={field.step}
                          unit={field.unit}
                          onChange={(v) => handleFieldChange(field.path, v)}
                        />
                      ) : (
                        <FieldRow key={field.path} field={field} onChange={(v) => handleFieldChange(field.path, v)} />
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// apps/editor/src/components/TransitionPanel.tsx
//
// Applies/removes a transition spanning the boundary with the PREVIOUS
// sibling (`node.transitionIn`) or the NEXT sibling (`node.transitionOut`)
// — Phase 2 §4.4/§5, blueprint §13 acceptance test 08 ("A transition
// between two clips renders via shader"). Mounted in InspectorPanel
// alongside EffectStackPanel — a transition is a per-node field exactly
// like `effects[]`, just one that needs to know about an adjacent
// sibling rather than only the node itself, which is why this takes
// `root`/`node` (not just `node`) — to look up and display the
// neighbor's name and to know whether a side even HAS a sibling to
// transition with (the first node in z-order has no "previous";
// the last has no "next").
//
// Per find-node-index.ts's documented Phase 1 scope ("only the flat root
// array... dragging into/out of a group's children is Week 8+"), this
// panel is the SAME top-level-only scope — applying a transition between
// two children of a nested group isn't exposed here yet, even though
// core/evaluator/transitions.ts's `applyTransitions` already resolves it
// correctly at any nesting level once authored (e.g. via a future scene
// importer or a Week 8+ nested-selection UI).

import type { Node } from "core";
import { useTransitionRegistry } from "../bootstrap/transition-registry-context";
import { removeTransitionOp, setTransitionDurationOp, setTransitionOp } from "../commands/set-transition";
import type { TransitionSide } from "../commands/set-transition";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { Section } from "./inspector-fields";

const DEFAULT_DURATION_FRAMES = 15;

function TransitionSideRow({ node, side, neighbor }: { node: Node; side: TransitionSide; neighbor: Node | undefined }) {
  const store = useEditorStoreApi();
  const transitionRegistry = useTransitionRegistry();
  const ref = node[side];
  const label = side === "transitionIn" ? "In (from previous)" : "Out (to next)";

  function handleApply(preset: string): void {
    if (!preset) return;
    const def = transitionRegistry.tryGet(preset);
    if (!def) return;
    const state = store.getState();
    state.apply(setTransitionOp(activeComp(state), node.id, side, def, DEFAULT_DURATION_FRAMES));
  }

  function handleDuration(durationF: number): void {
    if (!Number.isFinite(durationF) || durationF <= 0) return;
    const state = store.getState();
    state.apply(setTransitionDurationOp(activeComp(state), node.id, side, durationF));
  }

  function handleRemove(): void {
    const state = store.getState();
    state.apply(removeTransitionOp(activeComp(state), node.id, side));
  }

  if (!neighbor) {
    // First node has no previous sibling; last node has no next — nothing to transition with.
    return (
      <div className="transition-panel__row transition-panel__row--disabled">
        <span className="field-row__label">{label}</span>
        <span className="transition-panel__hint">No {side === "transitionIn" ? "previous" : "next"} layer</span>
      </div>
    );
  }

  return (
    <div className="transition-panel__row">
      <div className="transition-panel__row-header">
        <span className="field-row__label">{label}</span>
        <span className="transition-panel__neighbor">{neighbor.name}</span>
      </div>
      {ref ? (
        <div className="transition-panel__active">
          <select value={ref.preset} onChange={(e) => handleApply(e.target.value)}>
            {transitionRegistry.list().map((def) => (
              <option key={def.preset} value={def.preset}>
                {def.displayName}
              </option>
            ))}
          </select>
          <label className="transition-panel__duration">
            <span>Duration (frames)</span>
            <input type="number" min={1} value={ref.durationF} onChange={(e) => handleDuration(Number(e.target.value))} />
          </label>
          <button type="button" className="transition-panel__remove" aria-label={`Remove ${label} transition`} onClick={handleRemove}>
            ×
          </button>
        </div>
      ) : (
        <select value="" onChange={(e) => handleApply(e.target.value)}>
          <option value="" disabled>
            Apply a transition…
          </option>
          {transitionRegistry.list().map((def) => (
            <option key={def.preset} value={def.preset}>
              {def.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function TransitionPanel({ node, root }: { node: Node; root: Node[] }) {
  const index = root.findIndex((n) => n.id === node.id);
  const previous = index > 0 ? root[index - 1] : undefined;
  const next = index >= 0 && index < root.length - 1 ? root[index + 1] : undefined;

  return (
    <Section title="Transitions">
      <TransitionSideRow node={node} side="transitionIn" neighbor={previous} />
      <TransitionSideRow node={node} side="transitionOut" neighbor={next} />
    </Section>
  );
}
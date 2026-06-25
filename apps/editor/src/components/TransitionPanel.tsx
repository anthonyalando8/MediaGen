// apps/editor/src/components/TransitionPanel.tsx
//
// Applies/removes transitions between adjacent clips. Uses setTransitionOps()
// which automatically creates the clip overlap the evaluator requires.

import type { Node } from "core";
import { useTransitionRegistry } from "../bootstrap/transition-registry-context";
import { removeTransitionOp, setTransitionDurationOp, setTransitionOps } from "../commands/set-transition";
import type { TransitionSide } from "../commands/set-transition";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { Section } from "./inspector-fields";

const DEFAULT_DURATION_FRAMES = 15;

function TransitionSideRow({
  node, side, neighbor,
}: {
  node: Node;
  side: TransitionSide;
  neighbor: Node | undefined;
}) {
  const store = useEditorStoreApi();
  const transitionRegistry = useTransitionRegistry();
  const ref = node[side];
  const label = side === "transitionIn" ? "↓ In — from previous" : "↑ Out — to next";
  const noNeighborMsg = side === "transitionIn" ? "No previous layer" : "No next layer";

  function handleApply(preset: string): void {
    if (!preset) return;
    const def = transitionRegistry.tryGet(preset);
    if (!def) return;
    const state = store.getState();
    const ops = setTransitionOps(activeComp(state), node.id, side, def, DEFAULT_DURATION_FRAMES);
    for (const op of ops) state.apply(op);
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
    return (
      <div className="transition-row transition-row--disabled">
        <span className="transition-row__label">{label}</span>
        <span className="transition-row__hint">{noNeighborMsg}</span>
      </div>
    );
  }

  return (
    <div className="transition-row">
      <div className="transition-row__header">
        <span className="transition-row__label">{label}</span>
        <span className="transition-row__neighbor">↔ {neighbor.name}</span>
      </div>

      {ref ? (
        // Active transition
        <div className="transition-row__active">
          <div className="transition-row__active-badge">
            ✓ {transitionRegistry.tryGet(ref.preset)?.displayName ?? ref.preset}
          </div>
          <div className="transition-row__controls">
            <select
              value={ref.preset}
              onChange={(e) => handleApply(e.target.value)}
            >
              {transitionRegistry.list().map((def) => (
                <option key={def.preset} value={def.preset}>
                  {def.displayName}
                </option>
              ))}
            </select>
            <label className="transition-row__duration">
              <span>Frames</span>
              <input
                type="number"
                min={1}
                max={300}
                value={ref.durationF}
                onChange={(e) => handleDuration(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={handleRemove}
              title="Remove transition"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        // No transition yet
        <div className="transition-row__add">
          <select value="" onChange={(e) => handleApply(e.target.value)}>
            <option value="" disabled>Add transition…</option>
            {transitionRegistry.list().map((def) => (
              <option key={def.preset} value={def.preset}>
                {def.displayName}
              </option>
            ))}
          </select>
          <span className="transition-row__hint">
            {DEFAULT_DURATION_FRAMES}f overlap created automatically
          </span>
        </div>
      )}
    </div>
  );
}

export function TransitionPanel({ node, root }: { node: Node; root: Node[] }) {
  const index = root.findIndex((n) => n.id === node.id);
  const previous = index > 0 ? root[index - 1] : undefined;
  const next = index >= 0 && index < root.length - 1 ? root[index + 1] : undefined;

  return (
    <Section title="Transitions" defaultOpen={false}>
      <TransitionSideRow node={node} side="transitionIn" neighbor={previous} />
      <TransitionSideRow node={node} side="transitionOut" neighbor={next} />
    </Section>
  );
}
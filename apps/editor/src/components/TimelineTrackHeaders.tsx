// apps/editor/src/components/TimelineTrackHeaders.tsx
//
// Sticky left column — one header row per LANE (not per node).
// A lane with a single clip shows that clip's name + kind chip.
// A lane with multiple clips shows "Track N" with a stack of kind chips.

import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import type { Id } from "core";
import { buildLanes } from "../commands/move-lane";
import { ADJUSTMENT_COLOR, getKindColor } from "./kind-icons";
import { setNodeHidden, setNodeLocked } from "../commands/toggle-node-flag";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

export function TimelineTrackHeaders() {
  const store = useEditorStoreApi();
  const comp = useEditorStore((s) => activeComp(s));
  const selection = useEditorStore((s) => s.selection);

  const lanes = buildLanes(comp);

  function handleToggleHidden(e: React.MouseEvent, nodeId: Id, hidden: boolean): void {
    e.stopPropagation();
    const state = store.getState();
    state.apply(setNodeHidden(activeComp(state), nodeId, !hidden));
  }

  function handleToggleLocked(e: React.MouseEvent, nodeId: Id, locked: boolean): void {
    e.stopPropagation();
    const state = store.getState();
    state.apply(setNodeLocked(activeComp(state), nodeId, !locked));
  }

  return (
    <div className="track-headers">
      <div className="track-headers__top">Tracks</div>
      <div className="track-headers__list">
        {lanes.map((lane) => {
          const isSolo = lane.nodes.length === 1;
          const firstNode = lane.nodes[0].node;
          const anySelected = lane.nodes.some(({ node }) => selection.includes(node.id));
          const allHidden = lane.nodes.every(({ node }) => Boolean(node.hidden));
          const allLocked = lane.nodes.every(({ node }) => Boolean(node.locked));

          return (
            <div
              key={lane.laneId}
              className={`track-header ${anySelected ? "selected" : ""} ${allHidden ? "hidden-layer" : ""}`}
              onClick={() => {
                const ids = lane.nodes.map(({ node }) => node.id);
                store.getState().select(ids);
              }}
            >
              {/* Kind chip(s) */}
              <div className="track-header__chips">
                {isSolo ? (
                  <span
                    className="track-header__chip"
                    style={{ background: firstNode.isAdjustment ? ADJUSTMENT_COLOR : getKindColor(firstNode.kind) }}
                  />
                ) : (
                  lane.nodes.slice(0, 3).map(({ node }) => (
                    <span
                      key={node.id}
                      className="track-header__chip track-header__chip--stacked"
                      style={{ background: node.isAdjustment ? ADJUSTMENT_COLOR : getKindColor(node.kind) }}
                    />
                  ))
                )}
              </div>

              {/* Name */}
              <span className="track-header__name">
                {isSolo ? firstNode.name : lane.label}
              </span>

              {/* Actions — for solo lanes show hide/lock; multi-lane shows count */}
              <span className="track-header__flags">
                {isSolo ? (
                  <>
                    <button
                      className="layer-action"
                      title={firstNode.hidden ? "Show" : "Hide"}
                      onClick={(e) => handleToggleHidden(e, firstNode.id, Boolean(firstNode.hidden))}
                    >
                      {firstNode.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button
                      className="layer-action"
                      title={firstNode.locked ? "Unlock" : "Lock"}
                      onClick={(e) => handleToggleLocked(e, firstNode.id, Boolean(firstNode.locked))}
                    >
                      {firstNode.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                  </>
                ) : (
                  <span className="track-header__count">{lane.nodes.length}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
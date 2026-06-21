// apps/editor/src/components/TimelineTrackHeaders.tsx
//
// Sticky left column for the clip-arrangement timeline (UI/UX redesign).
// One header row per `comp.root` entry, in the SAME order and identity as
// TimelineTrack's lanes (and LayerPanel's rows) — a header here and a clip
// bar there are the same layer. Gives every lane a readable label + kind
// chip + at-a-glance hide/lock state, which the bars-only timeline lacked.
//
// Reuses the EXISTING commands (`select`, `setNodeHidden`, `setNodeLocked`)
// — no new behavior. Row height is shared with the lanes via the
// `--track-h` token so the two columns stay aligned.

import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import type { Id } from "core";
import { ADJUSTMENT_COLOR, getKindColor } from "./kind-icons";
import { setNodeHidden, setNodeLocked } from "../commands/toggle-node-flag";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

export function TimelineTrackHeaders() {
  const store = useEditorStoreApi();
  const root = useEditorStore((s) => activeComp(s).root);
  const selection = useEditorStore((s) => s.selection);

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
        {root.map((node) => {
          const hidden = Boolean(node.hidden);
          const locked = Boolean(node.locked);
          const selected = selection.includes(node.id);
          const color = node.isAdjustment ? ADJUSTMENT_COLOR : getKindColor(node.kind);
          const classes = ["track-header", selected && "selected", hidden && "hidden-layer"].filter(Boolean).join(" ");
          return (
            <div key={node.id} className={classes} onClick={() => store.getState().select([node.id])}>
              <span className="track-header__chip" style={{ background: color }} />
              <span className="track-header__name">{node.name}</span>
              <span className="track-header__flags">
                <button
                  className="layer-action"
                  title={hidden ? "Show layer" : "Hide layer"}
                  onClick={(e) => handleToggleHidden(e, node.id, hidden)}
                >
                  {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button
                  className="layer-action"
                  title={locked ? "Unlock layer" : "Lock layer"}
                  onClick={(e) => handleToggleLocked(e, node.id, locked)}
                >
                  {locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

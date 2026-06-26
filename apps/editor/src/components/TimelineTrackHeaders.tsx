// apps/editor/src/components/TimelineTrackHeaders.tsx
//
// Sticky left column — one header row per LANE (not per node), plus
// collapsible sub-lane header rows for text nodes with animated spans.

import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import type { Id } from "core";
import type { TextSpan } from "core";
import { buildLanes } from "../commands/move-lane";
import { ADJUSTMENT_COLOR, getKindColor } from "./kind-icons";
import { setNodeHidden, setNodeLocked } from "../commands/toggle-node-flag";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { useSpanLanes } from "./SpanLaneContext";

function SpanSubLaneHeaders({ spans, expanded }: { spans: TextSpan[]; expanded: boolean }) {
  if (!expanded) return null;
  const animated = spans.filter((s) => s.time);
  if (animated.length === 0) return null;

  return (
    <div className="span-sublane-headers">
      {spans.map((span, i) => {
        if (!span.time) return null;
        const label = span.text.replace(/\n/g, "↵").trim().slice(0, 16) || `Span ${i + 1}`;
        return (
          <div key={span.id ?? i} className="span-sublane-header">
            <span className="span-sublane-header__indent" />
            <span className="span-sublane-header__dot" />
            <span className="span-sublane-header__name" title={span.text}>{label}</span>
            <span className="span-sublane-header__time">{span.time.start}f</span>
          </div>
        );
      })}
    </div>
  );
}

export function TimelineTrackHeaders() {
  const store = useEditorStoreApi();
  const comp = useEditorStore((s) => activeComp(s));
  const selection = useEditorStore((s) => s.selection);
  const { expanded, toggle: toggleExpanded } = useSpanLanes();

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

          const spans = firstNode.kind === "text"
            ? (firstNode.props.spans as unknown as TextSpan[] | undefined) ?? []
            : [];
          const hasSpanSublanes = isSolo && spans.some((s) => s.time);
          const isExpanded = expanded.has(firstNode.id);

          return (
            <div key={lane.laneId}>
              <div
                className={`track-header ${anySelected ? "selected" : ""} ${allHidden ? "hidden-layer" : ""}`}
                onClick={() => store.getState().select(lane.nodes.map(({ node }) => node.id))}
              >
                {/* Expand toggle OR kind chips */}
                {hasSpanSublanes ? (
                  <button
                    className="track-header__expand"
                    title="Toggle span lanes"
                    onClick={(e) => { e.stopPropagation(); toggleExpanded(firstNode.id); }}
                  >
                    {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </button>
                ) : (
                  <div className="track-header__chips">
                    {isSolo ? (
                      <span className="track-header__chip" style={{ background: firstNode.isAdjustment ? ADJUSTMENT_COLOR : getKindColor(firstNode.kind) }} />
                    ) : (
                      lane.nodes.slice(0, 3).map(({ node }) => (
                        <span key={node.id} className="track-header__chip track-header__chip--stacked" style={{ background: node.isAdjustment ? ADJUSTMENT_COLOR : getKindColor(node.kind) }} />
                      ))
                    )}
                  </div>
                )}

                {/* Extra chip when expand arrow is showing */}
                {hasSpanSublanes && (
                  <span className="track-header__chip" style={{ background: getKindColor(firstNode.kind), flexShrink: 0 }} />
                )}

                <span className="track-header__name">{isSolo ? firstNode.name : lane.label}</span>

                <span className="track-header__flags">
                  {isSolo ? (
                    <>
                      <button className="layer-action" title={firstNode.hidden ? "Show" : "Hide"} onClick={(e) => handleToggleHidden(e, firstNode.id, Boolean(firstNode.hidden))}>
                        {firstNode.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <button className="layer-action" title={firstNode.locked ? "Unlock" : "Lock"} onClick={(e) => handleToggleLocked(e, firstNode.id, Boolean(firstNode.locked))}>
                        {firstNode.locked ? <Lock size={12} /> : <Unlock size={12} />}
                      </button>
                    </>
                  ) : (
                    <span className="track-header__count">{lane.nodes.length}</span>
                  )}
                </span>
              </div>

              {hasSpanSublanes && (
                <SpanSubLaneHeaders spans={spans} expanded={isExpanded} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
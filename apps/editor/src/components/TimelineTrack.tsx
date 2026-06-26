// apps/editor/src/components/TimelineTrack.tsx
//
// NLE-style clip timeline with proper lane/track support:
//
//  - Clips sharing a `node.lane` value render on the SAME horizontal row.
//  - Nodes without a lane each get their own row (legacy / solo behaviour).
//  - Vertical drag moves a clip to a different lane: drag up/down by one
//    track-height to jump lanes. A ghost row highlights the target lane.
//  - Clips on the same lane are independently draggable horizontally.
//  - Snap-to-grid (8px threshold) still applies on horizontal drags.
//  - Clicking empty lane area deselects.

import { useState, useContext as _useContext } from "react";
import React from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Frame, Id, Node } from "core";
import {
  moveClipOp, trimClipOp,
  calcCompDuration, setCompDurationOp,
} from "../commands/move-clip-time";
import { moveLaneOp, buildLanes } from "../commands/move-lane";
import type { LaneEntry } from "../commands/move-lane";
import { setSpanTimeOp } from "../commands/set-span-animation";
import type { TextSpan } from "core";
import { SpanLaneContext } from "./SpanLaneContext";
import { ADJUSTMENT_COLOR, getKindColor } from "./kind-icons";
import { useTimelineSnap } from "./TimelineSnapContext";
import { useTransitionRegistry } from "../bootstrap/transition-registry-context";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

const TRACK_H = 34; // matches --track-h CSS token

type DragKind = "move" | "trim-left" | "trim-right";

interface LivePreview {
  nodeId: Id;
  start: number;
  duration: number;
  /** Lane the clip is currently hovering over during a vertical drag. */
  hoverLaneId: string | null;
}

/**
 * TransitionBlock — rendered in the lane row BETWEEN two adjacent clips,
 * straddling their cut/overlap point. Sized to durationF frames wide,
 * centered on the cut point. Clicking selects both clips so the inspector
 * shows the TransitionPanel.
 */
function TransitionBlock({
  prevNode,
  nextNode,
  pixelsPerFrame,
  onSelect,
}: {
  prevNode: Node;
  nextNode: Node;
  pixelsPerFrame: number;
  onSelect: () => void;
}) {
  const transitionRegistry = useTransitionRegistry();

  // Use transitionIn from next node (preferred), fallback to transitionOut from prev
  const ref = nextNode.transitionIn ?? prevNode.transitionOut;
  if (!ref) return null;

  const prevEnd = (prevNode.time.start as number) + (prevNode.time.duration as number);
  const nextStart = nextNode.time.start as number;

  // Cut point — where the overlap begins or where the clips meet
  const cutPoint = Math.min(prevEnd, Math.max(nextStart, (prevEnd + nextStart) / 2));
  const durationF = ref.durationF as number;
  const halfW = (durationF * pixelsPerFrame) / 2;
  const left = cutPoint * pixelsPerFrame - halfW;
  const width = durationF * pixelsPerFrame;

  // Is the transition actually active (clips overlap)?
  const isActive = prevEnd > nextStart;

  const displayName = transitionRegistry.tryGet(ref.preset)?.displayName ?? ref.preset;

  return (
    <div
      className={`timeline-transition-block ${isActive ? "timeline-transition-block--active" : "timeline-transition-block--inactive"}`}
      style={{ left, width }}
      title={`${displayName} · ${durationF}f${isActive ? "" : " · no overlap"}`}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <svg className="timeline-transition-block__chevron" viewBox="0 0 100 28" preserveAspectRatio="none">
        <polygon points="0,0 90,0 100,14 90,28 0,28 10,14" />
      </svg>
      <span className="timeline-transition-block__label">{displayName}</span>
    </div>
  );
}

function ClipBar({
  node,
  laneIndex,
  lanes,
  pixelsPerFrame,
  selected,
  onSelect,
}: {
  node: Node;
  laneIndex: number;
  lanes: LaneEntry[];
  pixelsPerFrame: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const store = useEditorStoreApi();
  const { setLitFrame } = useTimelineSnap();
  const [preview, setPreview] = useState<LivePreview | null>(null);

  const start = preview?.nodeId === node.id ? preview.start : (node.time.start as number);
  const duration = preview?.nodeId === node.id ? preview.duration : (node.time.duration as number);

  function snapFrame(frame: number, snapPx: number): number {
    const candidates = [1, 2, 5, 10, 15, 30, 60, 90, 150, 300, 600];
    let interval = 600;
    for (const f of candidates) {
      if (f * pixelsPerFrame >= 48) { interval = f; break; }
    }
    const snapFrames = Math.max(1, Math.round(snapPx / pixelsPerFrame));
    const nearest = Math.round(frame / interval) * interval;
    return Math.abs(frame - nearest) <= snapFrames ? nearest : frame;
  }

  function laneAtDeltaY(dy: number): string | null {
    const rowDelta = Math.round(dy / TRACK_H);
    const targetIndex = laneIndex + rowDelta;
    if (targetIndex < 0 || targetIndex >= lanes.length) return null;
    return lanes[targetIndex].laneId;
  }

  function handleDrag(kind: DragKind, e: ReactPointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    (e.target as Element).setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const originStart = node.time.start as number;
    const originDuration = node.time.duration as number;
    const originLane = node.lane ?? null;
    let lastStart = originStart;
    let lastDuration = originDuration;
    let lastHoverLane: string | null = originLane;

    function onMove(ev: PointerEvent): void {
      const deltaFrames = Math.round((ev.clientX - startX) / pixelsPerFrame);
      const SNAP_PX = 8;

      if (kind === "move") {
        const raw = Math.max(0, originStart + deltaFrames);
        const snappedStart = snapFrame(raw, SNAP_PX);
        const snappedEnd = snapFrame(raw + originDuration, SNAP_PX);
        const startDiff = Math.abs(raw - snappedStart);
        const endDiff = Math.abs(raw + originDuration - snappedEnd);
        lastStart = startDiff <= endDiff ? snappedStart : snappedEnd - originDuration;
        lastDuration = originDuration;
        const litF = startDiff <= endDiff
          ? (snappedStart !== raw ? snappedStart : null)
          : (snappedEnd !== raw + originDuration ? snappedEnd : null);
        setLitFrame(litF);

        // Vertical: detect lane change
        const dy = ev.clientY - startY;
        if (Math.abs(dy) > TRACK_H * 0.4) {
          lastHoverLane = laneAtDeltaY(dy);
        } else {
          lastHoverLane = originLane;
        }
      } else if (kind === "trim-left") {
        const raw = Math.min(originStart + originDuration - 1, originStart + deltaFrames);
        const snapped = snapFrame(Math.max(0, raw), SNAP_PX);
        lastStart = snapped;
        lastDuration = originStart + originDuration - lastStart;
        setLitFrame(snapped !== raw ? snapped : null);
      } else {
        const rawEnd = originStart + Math.max(1, originDuration + deltaFrames);
        const snappedEnd = snapFrame(rawEnd, SNAP_PX);
        lastDuration = Math.max(1, snappedEnd - originStart);
        lastStart = originStart;
        setLitFrame(snappedEnd !== rawEnd ? snappedEnd : null);
      }

      setPreview({
        nodeId: node.id,
        start: lastStart,
        duration: lastDuration,
        hoverLaneId: lastHoverLane,
      });
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPreview(null);
      setLitFrame(null);

      const state = store.getState();
      const comp = activeComp(state);

      // Commit lane change first if it changed
      if (kind === "move" && lastHoverLane !== originLane) {
        state.apply(moveLaneOp(comp, node.id, lastHoverLane));
      }

      // Then commit time change
      const afterComp = activeComp(store.getState());
      if (lastStart !== originStart || lastDuration !== originDuration) {
        if (kind === "move") {
          state.apply(moveClipOp(afterComp, node.id, lastStart));
        } else {
          state.apply(trimClipOp(afterComp, node.id, lastStart, lastDuration));
        }
      }

      // Auto-extend comp duration
      const finalComp = activeComp(store.getState());
      const needed = calcCompDuration(finalComp);
      if (needed !== (finalComp.duration as number)) {
        state.apply(setCompDurationOp(finalComp, needed));
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const color = node.isAdjustment ? ADJUSTMENT_COLOR : getKindColor(node.kind);
  const isHovering = preview?.nodeId === node.id && preview.hoverLaneId !== (node.lane ?? null);

  return (
    <div
      className={`timeline-track__bar ${selected ? "timeline-track__bar--selected" : ""} ${isHovering ? "timeline-track__bar--lifting" : ""}`}
      style={{
        left: start * pixelsPerFrame,
        width: Math.max(8, duration * pixelsPerFrame),
        background: `linear-gradient(180deg, ${color}ee, ${color}b3)`,
        borderColor: selected ? "var(--accent)" : color,
      }}
      onPointerDown={(e) => handleDrag("move", e)}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <span className="timeline-track__bar-dot" />
      <span className="timeline-track__bar-label">{node.name}</span>
      <div
        className="timeline-track__handle timeline-track__handle--left"
        onPointerDown={(e) => handleDrag("trim-left", e)}
      />
      <div
        className="timeline-track__handle timeline-track__handle--right"
        onPointerDown={(e) => handleDrag("trim-right", e)}
      />
    </div>
  );
}

// ── Lane row ──────────────────────────────────────────────────────────────

function LaneRow({
  lane,
  laneIndex,
  lanes,
  pixelsPerFrame,
  selection,
  isDropTarget,
  isAlt,
}: {
  lane: LaneEntry;
  laneIndex: number;
  lanes: LaneEntry[];
  pixelsPerFrame: number;
  selection: Id[];
  isDropTarget: boolean;
  isAlt: boolean;
}) {
  const store = useEditorStoreApi();

  return (
    <div
      className={`timeline-track__row ${isAlt ? "timeline-track__row--alt" : ""} ${isDropTarget ? "timeline-track__row--drop-target" : ""}`}
      onClick={() => store.getState().select([])}
    >
      {lane.nodes.map(({ node }) => (
        <ClipBar
          key={node.id}
          node={node}
          laneIndex={laneIndex}
          lanes={lanes}
          pixelsPerFrame={pixelsPerFrame}
          selected={selection.includes(node.id)}
          onSelect={() => store.getState().select([node.id])}
        />
      ))}
      {/* Transition blocks — one per adjacent pair that has a transition declared */}
      {lane.nodes.slice(0, -1).map(({ node: prevNode }, i) => {
        const nextNode = lane.nodes[i + 1].node;
        const hasTransition = Boolean(nextNode.transitionIn) || Boolean(prevNode.transitionOut);
        if (!hasTransition) return null;
        return (
          <TransitionBlock
            key={`tx-${prevNode.id}-${nextNode.id}`}
            prevNode={prevNode}
            nextNode={nextNode}
            pixelsPerFrame={pixelsPerFrame}
            onSelect={() => store.getState().select([prevNode.id, nextNode.id])}
          />
        );
      })}
    </div>
  );
}

// ── Span sub-lanes ────────────────────────────────────────────────────────
// Shown below a text node's clip row when the node has any span with a
// time window. Each animated span appears as a small draggable clip bar
// on its own sub-row. Drag left/right changes span.time.start.

const SPAN_ROW_H = 22;

function SpanClip({
  span,
  spanIndex,
  nodeId,
  nodeStart,
  pixelsPerFrame,
}: {
  span: TextSpan;
  spanIndex: number;
  nodeId: Id;
  nodeStart: number;
  pixelsPerFrame: number;
}) {
  const store = useEditorStoreApi();
  if (!span.time) return null;

  const left  = (nodeStart + (span.time.start as number)) * pixelsPerFrame;
  const width = Math.max(8, (span.time.duration as number) * pixelsPerFrame);
  const label = span.text.replace(/\n/g, "↵").trim().slice(0, 20);

  function handleDrag(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const originStart = span.time!.start as number;
    const startX = e.clientX;

    function onMove(ev: PointerEvent) {
      const delta = Math.round((ev.clientX - startX) / pixelsPerFrame);
      const newStart = Math.max(0, originStart + delta) as Frame;
      const state = store.getState();
      const comp = activeComp(state);
      state.apply(setSpanTimeOp(comp, nodeId, spanIndex, newStart, span.time!.duration, span.time!.fillMode ?? "forwards"));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      className="span-sublane__clip"
      style={{ left, width }}
      onPointerDown={handleDrag}
      title={`"${label}" · start ${span.time.start}f · ${span.time.duration}f`}
    >
      <span className="span-sublane__label">{label}</span>
    </div>
  );
}

function SpanSubLanes({
  node,
  pixelsPerFrame,
}: {
  node: Node;
  pixelsPerFrame: number;
}) {
  const { expanded } = React.useContext(SpanLaneContext);
  if (!expanded.has(node.id)) return null;

  const spans = (node.props.spans as unknown as TextSpan[] | undefined) ?? [];
  const animated = spans.filter((s) => s.time);
  if (animated.length === 0) return null;

  const nodeStart = node.time.start as number;

  return (
    <div className="span-sublane-group">
      {spans.map((span, i) => {
        if (!span.time) return null;
        return (
          <div key={span.id ?? i} className="span-sublane__row">
            <SpanClip
              span={span}
              spanIndex={i}
              nodeId={node.id}
              nodeStart={nodeStart}
              pixelsPerFrame={pixelsPerFrame}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────

export function TimelineTrack({
  pixelsPerFrame,
  scrollContainerRef: _scrollContainerRef,
}: {
  pixelsPerFrame: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const comp = useEditorStore((s) => activeComp(s));
  const selection = useEditorStore((s) => s.selection);
  const playhead = useEditorStore((s) => s.playhead);

  const lanes = buildLanes(comp);

  // Determine which lane is the current drop target (from any ClipBar's hover preview)
  // We detect this from the preview state — since ClipBar is local state, we
  // read via the snap context's litFrame as a proxy. For now, the visual drop
  // target is handled by the lifting animation on the bar itself.

  return (
    <div className="timeline-track">
      {lanes.map((lane, laneIndex) => (
        <div key={lane.laneId}>
          <LaneRow
            lane={lane}
            laneIndex={laneIndex}
            lanes={lanes}
            pixelsPerFrame={pixelsPerFrame}
            selection={selection}
            isDropTarget={false}
            isAlt={laneIndex % 2 === 1}
          />
          {/* Span sub-lanes — only for text nodes with animated spans */}
          {lane.nodes
            .filter(({ node }) => node.kind === "text")
            .map(({ node }) => (
              <SpanSubLanes
                key={`spans-${node.id}`}
                node={node}
                pixelsPerFrame={pixelsPerFrame}
              />
            ))}
        </div>
      ))}
      <div
        className="timeline-track__playhead"
        style={{ left: (playhead as number) * pixelsPerFrame }}
      />
    </div>
  );
}
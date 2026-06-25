// apps/editor/src/components/TimelineTrack.tsx
//
// Clip-arrangement timeline. Production-grade improvements:
//  - Alternating row zebra-stripe backgrounds for readability.
//  - Click on empty area deselects.
//  - Drag minimum is 0 (clips can't go negative).
//  - scrollContainerRef accepted (future use for scroll-aware hit-testing).

import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Id, Node } from "core";
import { moveClipOp, trimClipOp, calcCompDuration, setCompDurationOp } from "../commands/move-clip-time";
import { ADJUSTMENT_COLOR, getKindColor } from "./kind-icons";
import { useTimelineSnap } from "./TimelineSnapContext";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

type DragKind = "move" | "trim-left" | "trim-right";

interface LivePreview {
  nodeId: Id;
  start: number;
  duration: number;
}

function TransitionMarker({ side, active }: { side: "left" | "right"; active: boolean }) {
  return (
    <div
      className={`timeline-track__transition-marker timeline-track__transition-marker--${side} ${active ? "timeline-track__transition-marker--active" : ""}`}
      title={active ? "Transition active" : "Transition set (no current overlap)"}
    />
  );
}

function ClipBar({
  node,
  index,
  pixelsPerFrame,
  previous,
  next,
  selected,
  onSelect,
}: {
  node: Node;
  index: number;
  pixelsPerFrame: number;
  previous: Node | undefined;
  next: Node | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const store = useEditorStoreApi();
  const { setLitFrame } = useTimelineSnap();
  const [preview, setPreview] = useState<LivePreview | null>(null);

  /** Snap `frame` to the nearest tick multiple if within snapPx screen pixels. */
  function snapFrame(frame: number, tickInterval: number, snapPx: number): number {
    const snapFrames = Math.max(1, Math.round(snapPx / pixelsPerFrame));
    const nearest = Math.round(frame / tickInterval) * tickInterval;
    return Math.abs(frame - nearest) <= snapFrames ? nearest : frame;
  }

  // Re-derive tick interval the same way the ruler does
  function getTickInterval(): number {
    const candidates = [1, 2, 5, 10, 15, 30, 60, 90, 150, 300, 600];
    const minPx = 48;
    for (const f of candidates) {
      if (f * pixelsPerFrame >= minPx) return f;
    }
    return 600;
  }

  const start = preview?.nodeId === node.id ? preview.start : (node.time.start as number);
  const duration = preview?.nodeId === node.id ? preview.duration : (node.time.duration as number);

  function overlaps(b: Node, aStart: number, aDuration: number): boolean {
    const aEnd = aStart + aDuration;
    const bStart = b.time.start as number;
    const bEnd = bStart + (b.time.duration as number);
    return aEnd > bStart && bEnd > aStart;
  }

  function handleDrag(kind: DragKind, e: ReactPointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    (e.target as Element).setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const originStart = node.time.start as number;
    const originDuration = node.time.duration as number;
    let lastStart = originStart;
    let lastDuration = originDuration;

    function onMove(ev: PointerEvent): void {
      const deltaFrames = Math.round((ev.clientX - startX) / pixelsPerFrame);
      const tickInterval = getTickInterval();
      const SNAP_PX = 8;

      if (kind === "move") {
        const raw = Math.max(0, originStart + deltaFrames);
        // Snap both the start edge and the end edge — whichever is closer
        const snappedStart = snapFrame(raw, tickInterval, SNAP_PX);
        const snappedEnd = snapFrame(raw + originDuration, tickInterval, SNAP_PX);
        const startDiff = Math.abs(raw - snappedStart);
        const endDiff = Math.abs(raw + originDuration - snappedEnd);
        lastStart = startDiff <= endDiff ? snappedStart : snappedEnd - originDuration;
        lastDuration = originDuration;
        // Light up the snapped frame
        const litF = startDiff <= endDiff
          ? (snappedStart !== raw ? snappedStart : null)
          : (snappedEnd !== raw + originDuration ? snappedEnd : null);
        setLitFrame(litF);
      } else if (kind === "trim-left") {
        const raw = Math.min(originStart + originDuration - 1, originStart + deltaFrames);
        const snapped = snapFrame(Math.max(0, raw), tickInterval, SNAP_PX);
        lastStart = snapped;
        lastDuration = originStart + originDuration - lastStart;
        setLitFrame(snapped !== raw ? snapped : null);
      } else {
        const rawEnd = originStart + Math.max(1, originDuration + deltaFrames);
        const snappedEnd = snapFrame(rawEnd, tickInterval, SNAP_PX);
        lastDuration = Math.max(1, snappedEnd - originStart);
        lastStart = originStart;
        setLitFrame(snappedEnd !== rawEnd ? snappedEnd : null);
      }
      setPreview({ nodeId: node.id, start: lastStart, duration: lastDuration });
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPreview(null);
      setLitFrame(null);
      if (lastStart === originStart && lastDuration === originDuration) return;
      const state = store.getState();
      const comp = activeComp(state);
      if (kind === "move") {
        state.apply(moveClipOp(comp, node.id, lastStart));
      } else {
        state.apply(trimClipOp(comp, node.id, lastStart, lastDuration));
      }
      const afterComp = activeComp(store.getState());
      const needed = calcCompDuration(afterComp);
      if (needed !== (afterComp.duration as number)) {
        store.getState().apply(setCompDurationOp(afterComp, needed));
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const color = node.isAdjustment ? ADJUSTMENT_COLOR : getKindColor(node.kind);
  const leftMarkerActive = Boolean(node.transitionIn) && previous !== undefined && overlaps(previous, start, duration);
  const rightMarkerActive = Boolean(node.transitionOut) && next !== undefined && overlaps(next, start, duration);

  return (
    <div
      className={`timeline-track__row ${selected ? "timeline-track__row--selected" : ""} ${index % 2 === 1 ? "timeline-track__row--alt" : ""}`}
    >
      <div
        className={`timeline-track__bar ${selected ? "timeline-track__bar--selected" : ""}`}
        style={{
          left: start * pixelsPerFrame,
          width: Math.max(8, duration * pixelsPerFrame),
          background: `linear-gradient(180deg, ${color}ee, ${color}b3)`,
          borderColor: selected ? "var(--accent)" : color,
        }}
        onPointerDown={(e) => handleDrag("move", e)}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        {node.transitionIn && <TransitionMarker side="left" active={leftMarkerActive} />}
        <span className="timeline-track__bar-dot" />
        <span className="timeline-track__bar-label">{node.name}</span>
        {node.transitionOut && <TransitionMarker side="right" active={rightMarkerActive} />}
        <div className="timeline-track__handle timeline-track__handle--left" onPointerDown={(e) => handleDrag("trim-left", e)} />
        <div className="timeline-track__handle timeline-track__handle--right" onPointerDown={(e) => handleDrag("trim-right", e)} />
      </div>
    </div>
  );
}

export function TimelineTrack({
  pixelsPerFrame,
  scrollContainerRef: _scrollContainerRef,
}: {
  pixelsPerFrame: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const store = useEditorStoreApi();
  const root = useEditorStore((s) => activeComp(s).root);
  const selection = useEditorStore((s) => s.selection);
  const playhead = useEditorStore((s) => s.playhead);

  return (
    <div
      className="timeline-track"
      onClick={() => store.getState().select([])}
    >
      {root.map((node, index) => (
        <ClipBar
          key={node.id}
          node={node}
          index={index}
          pixelsPerFrame={pixelsPerFrame}
          previous={index > 0 ? root[index - 1] : undefined}
          next={index < root.length - 1 ? root[index + 1] : undefined}
          selected={selection.includes(node.id)}
          onSelect={() => store.getState().select([node.id])}
        />
      ))}
      <div
        className="timeline-track__playhead"
        style={{ left: (playhead as number) * pixelsPerFrame }}
      />
    </div>
  );
}
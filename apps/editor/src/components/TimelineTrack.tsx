// apps/editor/src/components/TimelineTrack.tsx
//
// Clip-arrangement timeline — NEW SCOPE, not in the Phase 2 blueprint.
// The blueprint's only timeline-adjacent spec (§9.2) is a keyframe/graph
// editor for animating ONE node's channel values over time; it says
// nothing about arranging multiple layers' TimeSpans relative to each
// other, trimming them, or seeing/creating the overlap a transition
// needs (Node.transitionIn/transitionOut span the OVERLAP between two
// z-order-adjacent siblings' TimeSpans — core/evaluator/transitions.ts's
// doc). This was added because exit criterion 08 ("a transition between
// two clips renders via shader") had no way to be exercised by hand at
// all — only via raw store mutation through the browser console, which
// is how the actual A-B-vs-B-C pairing bug (transitions.ts, fixed
// separately) was found.
//
// One row per `comp.root` entry (same order/identity as LayerPanel — a
// row here and a row there are the SAME layer, just two different views
// of it), each rendering one draggable/trimmable bar positioned at
// `time.start`, sized to `time.duration`, at a shared `pixelsPerFrame`
// scale with TimelineRuler. Mirrors TransformGizmo.tsx's drag pattern
// exactly: `setPointerCapture` + a window-level pointermove/pointerup
// pair installed on pointer-down, LOCAL React state for the live visual
// preview during the drag (no store writes mid-drag — these are plain
// DOM elements, not canvas content, so there's no need for
// Viewport.tsx's render-loop-splicing mechanism), one committed
// `moveClipOp`/`trimClipOp` on pointer-up only if something actually
// changed.

import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Id, Node } from "core";
import { moveClipOp, trimClipOp, calcCompDuration, setCompDurationOp } from "../commands/move-clip-time";
import { getKindIcon } from "./kind-icons";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

type DragKind = "move" | "trim-left" | "trim-right";

interface LivePreview {
  nodeId: Id;
  start: number;
  duration: number;
}

/** A small marker at a bar's left/right edge showing a transition is set on that boundary — filled (accent color) when an overlap window with the neighbor actually exists right now (so it'll really render), hollow when declared but currently non-overlapping (a no-op until the clips are moved closer — see transitions.ts's "declared but not active" case). */
function TransitionMarker({ side, active }: { side: "left" | "right"; active: boolean }) {
  return <div className={`timeline-track__transition-marker timeline-track__transition-marker--${side} ${active ? "timeline-track__transition-marker--active" : ""}`} title={active ? "Transition active" : "Transition set (no current overlap)"} />;
}

function ClipBar({
  node,
  pixelsPerFrame,
  previous,
  next,
  selected,
  onSelect,
}: {
  node: Node;
  pixelsPerFrame: number;
  previous: Node | undefined;
  next: Node | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const store = useEditorStoreApi();
  const [preview, setPreview] = useState<LivePreview | null>(null);

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
      if (kind === "move") {
        lastStart = originStart + deltaFrames;
        lastDuration = originDuration;
      } else if (kind === "trim-left") {
        const newStart = Math.min(originStart + originDuration - 1, originStart + deltaFrames);
        lastStart = newStart;
        lastDuration = originStart + originDuration - newStart;
      } else {
        lastDuration = Math.max(1, originDuration + deltaFrames);
        lastStart = originStart;
      }
      setPreview({ nodeId: node.id, start: lastStart, duration: lastDuration });
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPreview(null);
      if (lastStart === originStart && lastDuration === originDuration) return;
      const state = store.getState();
      const comp = activeComp(state);
      if (kind === "move") {
        state.apply(moveClipOp(comp, node.id, lastStart));
      } else {
        state.apply(trimClipOp(comp, node.id, lastStart, lastDuration));
      }
      // Auto-extend or shrink comp.duration to cover all clip ends.
      const afterComp = activeComp(store.getState());
      const needed = calcCompDuration(afterComp);
      if (needed !== (afterComp.duration as number)) {
        store.getState().apply(setCompDurationOp(afterComp, needed));
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const Icon = getKindIcon(node.kind);
  const leftMarkerActive = Boolean(node.transitionIn) && previous !== undefined && overlaps(previous, start, duration);
  const rightMarkerActive = Boolean(node.transitionOut) && next !== undefined && overlaps(next, start, duration);

  return (
    <div className={`timeline-track__row ${selected ? "timeline-track__row--selected" : ""}`}>
      <div
        className={`timeline-track__bar ${selected ? "timeline-track__bar--selected" : ""}`}
        style={{ left: start * pixelsPerFrame, width: Math.max(2, duration * pixelsPerFrame) }}
        onPointerDown={(e) => handleDrag("move", e)}
      >
        {node.transitionIn && <TransitionMarker side="left" active={leftMarkerActive} />}
        <span className="timeline-track__bar-icon">
          <Icon size={11} />
        </span>
        <span className="timeline-track__bar-label">{node.name}</span>
        {node.transitionOut && <TransitionMarker side="right" active={rightMarkerActive} />}
        <div className="timeline-track__handle timeline-track__handle--left" onPointerDown={(e) => handleDrag("trim-left", e)} />
        <div className="timeline-track__handle timeline-track__handle--right" onPointerDown={(e) => handleDrag("trim-right", e)} />
      </div>
    </div>
  );
}

export function TimelineTrack({ pixelsPerFrame }: { pixelsPerFrame: number }) {
  const store = useEditorStoreApi();
  const root = useEditorStore((s) => activeComp(s).root);
  const selection = useEditorStore((s) => s.selection);

  return (
    <div className="timeline-track">
      {root.map((node, index) => (
        <ClipBar
          key={node.id}
          node={node}
          pixelsPerFrame={pixelsPerFrame}
          previous={index > 0 ? root[index - 1] : undefined}
          next={index < root.length - 1 ? root[index + 1] : undefined}
          selected={selection.includes(node.id)}
          onSelect={() => store.getState().select([node.id])}
        />
      ))}
    </div>
  );
}
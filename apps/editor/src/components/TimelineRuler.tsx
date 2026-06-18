// apps/editor/src/components/TimelineRuler.tsx
//
// Frame ruler + playhead for TimelineTrack's clip-arrangement timeline
// (new scope — see TimelineTrack.tsx's module doc). Replaces the old
// single global `<input type="range">` scrub slider (TimelinePlaceholder)
// with click/drag-anywhere-to-scrub directly on a real frame scale,
// shared 1:1 with each track row's `pixelsPerFrame` so a clip's visual
// position always lines up with the time it actually represents.

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toFrame } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

/** Frames between each tick mark — every 30 frames (1s at the common 30fps default) keeps the ruler legible without crowding at the default pixelsPerFrame scale. Not fps-aware on purpose (Phase 1 doesn't expose mixed frame rates per comp yet); revisit if/when that's ever true. */
const TICK_INTERVAL_FRAMES = 30;

export function TimelineRuler({ pixelsPerFrame }: { pixelsPerFrame: number }) {
  const store = useEditorStoreApi();
  const playhead = useEditorStore((s) => s.playhead);
  const duration = useEditorStore((s) => activeComp(s).duration);
  const rulerRef = useRef<HTMLDivElement>(null);

  function frameAtClientX(clientX: number): number {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const px = clientX - rect.left;
    const frame = Math.round(px / pixelsPerFrame);
    return Math.min(Math.max(0, frame), Math.max(0, duration - 1));
  }

  function handlePointerDown(e: ReactPointerEvent): void {
    (e.target as Element).setPointerCapture(e.pointerId);
    store.getState().setPlayhead(toFrame(frameAtClientX(e.clientX)));

    function onMove(ev: PointerEvent): void {
      store.getState().setPlayhead(toFrame(frameAtClientX(ev.clientX)));
    }
    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const ticks: number[] = [];
  for (let f = 0; f <= duration; f += TICK_INTERVAL_FRAMES) ticks.push(f);

  return (
    <div ref={rulerRef} className="timeline-ruler" style={{ width: duration * pixelsPerFrame }} onPointerDown={handlePointerDown}>
      {ticks.map((f) => (
        <div key={f} className="timeline-ruler__tick" style={{ left: f * pixelsPerFrame }}>
          <span className="timeline-ruler__tick-label">{f}</span>
        </div>
      ))}
      <div className="timeline-ruler__playhead" style={{ left: playhead * pixelsPerFrame }} />
    </div>
  );
}
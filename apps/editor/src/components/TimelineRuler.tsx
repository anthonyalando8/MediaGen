// apps/editor/src/components/TimelineRuler.tsx
//
// Frame ruler + playhead for TimelineTrack's clip-arrangement timeline.
// Click/drag-anywhere-to-scrub directly on a real frame scale, shared 1:1
// with each track row's `pixelsPerFrame` so a clip's visual position always
// lines up with the time it actually represents.
//
// UI/UX redesign: the ruler is sticky to the top of the scroll area and the
// playhead reads as a small triangle "head" (the full-height line is drawn
// across the lanes by TimelineTrack). All scrub/tick logic is unchanged;
// labels stay frame-numbered (the ruler is intentionally not fps-aware —
// Phase 1 doesn't expose mixed frame rates per comp).

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toFrame } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

/** Frames between each tick mark — every 30 frames (1s at the common 30fps default) keeps the ruler legible without crowding at the default pixelsPerFrame scale. */
const TICK_INTERVAL_FRAMES = 30;

export function TimelineRuler({ pixelsPerFrame }: { pixelsPerFrame: number }) {
  const store = useEditorStoreApi();
  const playhead = useEditorStore((s) => s.playhead);
  const duration = useEditorStore((s) => activeComp(s).duration);
  const visibleDuration = useEditorStore((s) => {
    const comp = activeComp(s);
    const maxEnd = comp.root.reduce(
      (max, n) => Math.max(max, (n.time.start as number) + (n.time.duration as number)),
      comp.duration as number
    );
    return Math.max(comp.duration as number, maxEnd);
  });
  const rulerRef = useRef<HTMLDivElement>(null);

  function frameAtClientX(clientX: number): number {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const px = clientX - rect.left;
    const frame = Math.round(px / pixelsPerFrame);
    return Math.min(Math.max(0, frame), Math.max(0, visibleDuration - 1));
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
  for (let f = 0; f <= visibleDuration; f += TICK_INTERVAL_FRAMES) ticks.push(f);

  return (
    <div ref={rulerRef} className="timeline-ruler" style={{ width: visibleDuration * pixelsPerFrame }} onPointerDown={handlePointerDown}>
      {ticks.map((f) => (
        <div key={f} className="timeline-ruler__tick" style={{ left: f * pixelsPerFrame }}>
          <span className="timeline-ruler__tick-label">{f}</span>
        </div>
      ))}
      {/* comp.duration end marker — shows the playback loop boundary, which may be shorter than the visible ruler when clips extend past it before auto-extending on pointer-up */}
      <div className="timeline-ruler__end-marker" style={{ left: (duration as number) * pixelsPerFrame }} />
      <div className="timeline-ruler__playhead-head" style={{ left: (playhead as number) * pixelsPerFrame }} />
    </div>
  );
}

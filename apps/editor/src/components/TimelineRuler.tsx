// apps/editor/src/components/TimelineRuler.tsx
//
// Frame ruler + playhead. Improvements:
//  - Adaptive tick interval based on pixelsPerFrame so ticks never crowd or
//    vanish at any zoom level.
//  - Labels show MM:SS format at coarser intervals, frame number at finer ones.
//  - Exposes a `scrollRef` so the parent can scroll the playhead into view.

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toFrame } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

/** Pick the smallest tick interval (in frames) that keeps ticks ≥ minPx apart. */
function pickTickInterval(pixelsPerFrame: number, fps: number): number {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 90, 150, 300, 600];
  const minPx = 48;
  for (const f of candidates) {
    if (f * pixelsPerFrame >= minPx) return f;
  }
  return 600;
}

function formatLabel(frame: number, fps: number, interval: number): string {
  const safeFps = fps > 0 ? fps : 30;
  if (interval >= safeFps) {
    // Coarse — show MM:SS
    const totalSecs = Math.floor(frame / safeFps);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return String(frame);
}

interface TimelineRulerProps {
  pixelsPerFrame: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  litFrame?: number | null;
  tickInterval?: number;
}

export function TimelineRuler({ pixelsPerFrame, scrollContainerRef, litFrame, tickInterval: tickIntervalProp }: TimelineRulerProps) {
  const store = useEditorStoreApi();
  const playhead = useEditorStore((s) => s.playhead);
  const duration = useEditorStore((s) => activeComp(s).duration);
  const fps = useEditorStore((s) => activeComp(s).fps);
  const visibleDuration = useEditorStore((s) => {
    const comp = activeComp(s);
    const maxEnd = comp.root.reduce(
      (max, n) => Math.max(max, (n.time.start as number) + (n.time.duration as number)),
      comp.duration as number
    );
    return Math.max(comp.duration as number, maxEnd) + 30; // small lookahead buffer
  });

  const rulerRef = useRef<HTMLDivElement>(null);

  function frameAtClientX(clientX: number): number {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    // Account for scroll offset inside the container
    const scrollLeft = scrollContainerRef.current?.scrollLeft ?? 0;
    const px = clientX - rect.left + scrollLeft;
    const frame = Math.round(px / pixelsPerFrame);
    return Math.min(Math.max(0, frame), Math.max(0, (visibleDuration as number) - 1));
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

  const interval = tickIntervalProp ?? pickTickInterval(pixelsPerFrame, fps as number);
  const totalWidth = (visibleDuration as number) * pixelsPerFrame;
  const ticks: number[] = [];
  for (let f = 0; f <= (visibleDuration as number); f += interval) ticks.push(f);

  const playheadPx = (playhead as number) * pixelsPerFrame;

  return (
    <div
      ref={rulerRef}
      className="timeline-ruler"
      style={{ width: totalWidth, minWidth: "100%" }}
      onPointerDown={handlePointerDown}
    >
      {ticks.map((f) => {
        const isLit = f === litFrame;
        return (
          <div
            key={f}
            className={`timeline-ruler__tick${isLit ? " timeline-ruler__tick--lit" : ""}`}
            style={{ left: f * pixelsPerFrame }}
          >
            <span className="timeline-ruler__tick-label">
              {formatLabel(f, fps as number, interval)}
            </span>
          </div>
        );
      })}
      <div
        className="timeline-ruler__end-marker"
        style={{ left: (duration as number) * pixelsPerFrame }}
        title={`End: frame ${duration}`}
      />
      <div
        className="timeline-ruler__playhead-head"
        style={{ left: playheadPx }}
      />
    </div>
  );
}
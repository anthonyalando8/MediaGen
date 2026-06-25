// apps/editor/src/components/TimelineGrid.tsx
//
// Vertical grid lines drawn behind the track rows, aligned 1:1 with the
// ruler ticks. A "lit" frame (set by TimelineTrack during a drag snap)
// highlights one line with the accent colour — this is the visual snap guide.
//
// Rendered as a single <svg> stretched to fill the full scroll content area
// so lines span all rows without any per-row overhead.

import { useId } from "react";

interface TimelineGridProps {
  pixelsPerFrame: number;
  trackCount: number;
  totalFrames: number;
  litFrame: number | null;
  tickInterval: number;
}

export function TimelineGrid({
  pixelsPerFrame,
  trackCount,
  totalFrames,
  litFrame,
  tickInterval,
}: TimelineGridProps) {
  const uid = useId().replace(/:/g, "");
  const TRACK_H = 34;
  const height = Math.max(TRACK_H, trackCount * TRACK_H);
  const width = Math.max(1, totalFrames * pixelsPerFrame);
  const halfInterval = Math.max(1, tickInterval / 2);

  const lines: number[] = [];
  for (let f = 0; f <= totalFrames; f += tickInterval) lines.push(f);

  return (
    <svg
      className="timeline-grid"
      width={width}
      height={height}
      style={{ width, height, minWidth: "100%" }}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={`tg-minor-${uid}`}
          x="0" y="0"
          width={halfInterval * pixelsPerFrame}
          height={TRACK_H}
          patternUnits="userSpaceOnUse"
        >
          <line
            x1={Math.round(halfInterval * pixelsPerFrame)}
            y1="0"
            x2={Math.round(halfInterval * pixelsPerFrame)}
            y2={TRACK_H}
            stroke="rgba(255,255,255,0.035)"
            strokeWidth="1"
          />
        </pattern>
      </defs>

      {/* Minor subdivision lines */}
      <rect width={width} height={height} fill={`url(#tg-minor-${uid})`} />

      {/* Horizontal row dividers */}
      {Array.from({ length: trackCount }, (_, i) => (
        <line
          key={`h${i}`}
          x1={0} y1={(i + 1) * TRACK_H}
          x2={width} y2={(i + 1) * TRACK_H}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="1"
        />
      ))}

      {/* Major tick lines — drawn last so they appear on top */}
      {lines.map((f) => {
        const x = Math.round(f * pixelsPerFrame);
        const isLit = litFrame !== null && f === litFrame;
        return (
          <line
            key={f}
            x1={x} y1={0}
            x2={x} y2={height}
            stroke={isLit ? "var(--accent)" : "rgba(255,255,255,0.08)"}
            strokeWidth={isLit ? 2 : 1}
          />
        );
      })}

      {/* Snap flash — a bright overlay line rendered only when lit */}
      {litFrame !== null && (() => {
        const x = Math.round(litFrame * pixelsPerFrame);
        const isOnTick = lines.includes(litFrame);
        if (!isOnTick) return null;
        return (
          <line
            key="snap-flash"
            x1={x} y1={0}
            x2={x} y2={height}
            stroke="var(--accent)"
            strokeWidth="2"
            opacity="0.9"
            style={{ filter: "drop-shadow(0 0 4px var(--accent))" }}
          />
        );
      })()}
    </svg>
  );
}
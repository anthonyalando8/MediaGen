// apps/editor/src/components/TimelineGrid.tsx
//
// Vertical grid lines drawn behind the track rows, aligned 1:1 with the
// ruler ticks. A "lit" frame (set by TimelineTrack during a drag snap)
// highlights one line with the accent colour — this is the visual snap guide.
//
// Rendered as a single <svg> stretched to fill the full scroll content area
// so lines span all rows without any per-row overhead.

interface TimelineGridProps {
  pixelsPerFrame: number;
  trackCount: number;
  totalFrames: number;
  litFrame: number | null; // frame that is currently snapped-to; null = none
  tickInterval: number;    // same interval as the ruler so grid lines match ticks 1:1
}

export function TimelineGrid({
  pixelsPerFrame,
  trackCount,
  totalFrames,
  litFrame,
  tickInterval,
}: TimelineGridProps) {
  const TRACK_H = 34; // mirrors --track-h CSS token
  const height = trackCount * TRACK_H;
  const width = totalFrames * pixelsPerFrame;

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
        <pattern id="tg-minor" x="0" y="0" width={tickInterval * pixelsPerFrame} height={TRACK_H} patternUnits="userSpaceOnUse">
          {/* Minor grid — half-interval subdivision */}
          <line
            x1={Math.round(tickInterval * pixelsPerFrame * 0.5)}
            y1="0"
            x2={Math.round(tickInterval * pixelsPerFrame * 0.5)}
            y2={TRACK_H}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
          />
        </pattern>
      </defs>

      {/* Minor subdivision lines via pattern */}
      <rect width={width} height={height} fill="url(#tg-minor)" />

      {/* Major tick lines */}
      {lines.map((f) => {
        const x = Math.round(f * pixelsPerFrame);
        const isLit = f === litFrame;
        return (
          <line
            key={f}
            x1={x} y1={0}
            x2={x} y2={height}
            stroke={isLit ? "var(--accent)" : "rgba(255,255,255,0.07)"}
            strokeWidth={isLit ? 1.5 : 1}
            opacity={isLit ? 0.85 : 1}
          >
            {isLit && (
              <animate attributeName="opacity" values="1;0.5;1" dur="0.4s" repeatCount="2" />
            )}
          </line>
        );
      })}

      {/* Horizontal row dividers — faint lines between tracks */}
      {Array.from({ length: trackCount }, (_, i) => (
        <line
          key={`h${i}`}
          x1={0} y1={(i + 1) * TRACK_H}
          x2={width} y2={(i + 1) * TRACK_H}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}
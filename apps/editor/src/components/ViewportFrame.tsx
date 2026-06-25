// apps/editor/src/components/ViewportFrame.tsx
//
// Visual chrome around the composition boundary:
//   1. Dark overlay panels outside the comp rect — makes the working area
//      visually distinct. Content outside is clipped by the WebGL stage mask
//      (canvas-host.ts), so this overlay purely communicates the boundary.
//   2. Thin accent border around the comp rect.
//   3. Resolution label above the top-left corner.

import type { FitTransform, Size } from "../viewport/geometry";

interface ViewportFrameProps {
  compSize: Size;
  canvasSize: Size;
  fit: FitTransform;
}

export function ViewportFrame({ compSize, canvasSize, fit }: ViewportFrameProps) {
  const cx = fit.x;
  const cy = fit.y;
  const cw = compSize.width * fit.scale;
  const ch = compSize.height * fit.scale;
  const W = canvasSize.width;
  const H = canvasSize.height;

  // Four dark overlay rects surrounding the comp rect (top, bottom, left, right).
  // Using clipPath would be cleaner but four rects is simpler and avoids
  // SVG clipPath browser quirks.
  const overlayOpacity = 0.55;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* Dark overlay outside comp — top */}
      {cy > 0 && <rect x={0} y={0} width={W} height={cy} fill={`rgba(0,0,0,${overlayOpacity})`} />}
      {/* Dark overlay outside comp — bottom */}
      {cy + ch < H && <rect x={0} y={cy + ch} width={W} height={H - (cy + ch)} fill={`rgba(0,0,0,${overlayOpacity})`} />}
      {/* Dark overlay outside comp — left */}
      {cx > 0 && <rect x={0} y={cy} width={cx} height={ch} fill={`rgba(0,0,0,${overlayOpacity})`} />}
      {/* Dark overlay outside comp — right */}
      {cx + cw < W && <rect x={cx + cw} y={cy} width={W - (cx + cw)} height={ch} fill={`rgba(0,0,0,${overlayOpacity})`} />}

      {/* Comp boundary border */}
      <rect
        x={cx} y={cy} width={cw} height={ch}
        fill="none"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={1}
      />

      {/* Resolution label */}
      <text
        x={cx}
        y={cy - 7}
        fill="rgba(255,255,255,0.35)"
        fontSize={11}
        fontFamily="var(--font-mono, monospace)"
      >
        {Math.round(compSize.width)} × {Math.round(compSize.height)}
      </text>
    </svg>
  );
}
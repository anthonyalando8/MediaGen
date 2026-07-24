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

  // Four overlay rects surrounding the comp rect (top, bottom, left, right),
  // dimming the working area outside it. Using clipPath would be cleaner but
  // four rects is simpler and avoids SVG clipPath browser quirks.
  //
  // Color comes from `--vp-frame-*` (theme.css) via `style`, not a `fill`/
  // `stroke` attribute — attribute values don't reliably resolve var(), but
  // the `style` prop is real CSS and does.
  const overlayFill = { fill: "var(--vp-frame-overlay)" };

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* Overlay outside comp — top */}
      {cy > 0 && <rect x={0} y={0} width={W} height={cy} style={overlayFill} />}
      {/* Overlay outside comp — bottom */}
      {cy + ch < H && <rect x={0} y={cy + ch} width={W} height={H - (cy + ch)} style={overlayFill} />}
      {/* Overlay outside comp — left */}
      {cx > 0 && <rect x={0} y={cy} width={cx} height={ch} style={overlayFill} />}
      {/* Overlay outside comp — right */}
      {cx + cw < W && <rect x={cx + cw} y={cy} width={W - (cx + cw)} height={ch} style={overlayFill} />}

      {/* Comp boundary border */}
      <rect
        x={cx} y={cy} width={cw} height={ch}
        fill="none"
        style={{ stroke: "var(--vp-frame-border)" }}
        strokeWidth={1}
      />

      {/* Resolution label */}
      <text
        x={cx}
        y={cy - 7}
        style={{ fill: "var(--vp-frame-label)" }}
        fontSize={11}
        fontFamily="var(--font-mono, monospace)"
      >
        {Math.round(compSize.width)} × {Math.round(compSize.height)}
      </text>
    </svg>
  );
}
// apps/editor/src/components/ViewportFrame.tsx
//
// A thin border around the composition's frame — the actual "working
// area" designs render within — so it's visually distinct from the empty
// space around it in the viewport. Previously the only visual cue was the
// composition's own background fill (often white), which is easy to
// mistake for "the whole canvas is the working area" with no boundary at
// all once the surrounding chrome is also light, or impossible to spot
// once the background itself is transparent/dark.
//
// Purely decorative — computed from `fit` (the same comp-space ->
// screen-space mapping <TransformGizmo> uses, viewport/geometry.ts) and
// rendered in its own non-interactive `<svg>` overlay, NOT the WebGL
// canvas — no render-loop/renderer changes needed. Sits BELOW
// <TransformGizmo> in paint order (Viewport.tsx) so selection handles
// always stay on top.

import type { FitTransform, Size } from "../viewport/geometry";

interface ViewportFrameProps {
  compSize: Size;
  canvasSize: Size;
  fit: FitTransform;
}

export function ViewportFrame({ compSize, canvasSize, fit }: ViewportFrameProps) {
  const x = fit.x;
  const y = fit.y;
  const width = compSize.width * fit.scale;
  const height = compSize.height * fit.scale;

  return (
    <svg
      width={canvasSize.width}
      height={canvasSize.height}
      viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <rect x={x} y={y} width={width} height={height} fill="none" stroke="var(--viewport-frame-border, #3a3f47)" strokeWidth={1} />
      <text x={x} y={y - 8} fill="var(--viewport-frame-label, #6b7280)" fontSize={11} fontFamily="var(--font-mono, monospace)">
        {Math.round(compSize.width)} × {Math.round(compSize.height)}
      </text>
    </svg>
  );
}
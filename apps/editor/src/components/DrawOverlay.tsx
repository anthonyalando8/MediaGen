// apps/editor/src/components/DrawOverlay.tsx
//
// Freehand drawing overlay — active when tool === "draw".
// Pointer-down starts a stroke, pointer-move accumulates comp-space points,
// pointer-up runs RDP simplification + Catmull-Rom → bezier, then commits
// a new polygon shape node via drawStrokeOp.
//
// A live SVG preview shows the raw stroke while drawing.
// After commit, switches back to "select" and selects the new node.

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { drawStrokeOp } from "../commands/draw-stroke";
import type { DrawStrokeOptions } from "../commands/draw-stroke";
import { getDrawOptions } from "./DrawOptionsBar";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import type { FitTransform } from "../viewport/geometry";
import { screenToComp } from "../viewport/geometry";
import { hexStringToOklch } from "renderer-webgl";

interface DrawOverlayProps {
  fit: FitTransform;
  canvasSize: { width: number; height: number };
}

export function DrawOverlay({ fit, canvasSize }: DrawOverlayProps) {
  const store   = useEditorStoreApi();
  const svgRef  = useRef<SVGSVGElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [previewPts, setPreviewPts] = useState<{ x: number; y: number }[]>([]);

  function svgXY(e: PointerEvent | ReactPointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    e.preventDefault();
    (e.target as SVGElement).setPointerCapture(e.pointerId);
    const sc = svgXY(e);
    const cp = screenToComp(sc, fit);
    setDrawing(true);
    setPreviewPts([cp]);

    const rawPts: { x: number; y: number }[] = [cp];

    function onMove(ev: PointerEvent) {
      const s = { x: ev.clientX - (svgRef.current?.getBoundingClientRect().left ?? 0), y: ev.clientY - (svgRef.current?.getBoundingClientRect().top ?? 0) };
      const c = screenToComp(s, fit);
      rawPts.push(c);
      // Throttle preview update — every 3 points to avoid too many re-renders
      if (rawPts.length % 3 === 0) setPreviewPts([...rawPts]);
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrawing(false);
      setPreviewPts([]);

      if (rawPts.length < 3) return;

      const state = store.getState();
      const comp  = activeComp(state);
      const drawOpts = getDrawOptions();
      const opts: DrawStrokeOptions = {
        epsilon:     (drawOpts.epsilon) / fit.scale,
        tension:     drawOpts.tension,
        strokeColor: hexStringToOklch(drawOpts.strokeHex),
        strokeWidth: drawOpts.strokeWidth / fit.scale,
        closed:      false,
        fill:        undefined,
      };

      const op = drawStrokeOp(comp, rawPts, opts);
      if (!op) return;
      state.apply(op);

      // Select the new node and switch back to select tool
      const afterComp = activeComp(store.getState());
      const newNode   = afterComp.root[afterComp.root.length - 1];
      if (newNode) store.getState().select([newNode.id]);
      store.getState().setTool("select");
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Build SVG path string from preview points
  function previewPath(): string {
    if (previewPts.length < 2) return "";
    const toSc = (p: { x: number; y: number }) => {
      const sx = p.x * fit.scale + fit.x;
      const sy = p.y * fit.scale + fit.y;
      return `${sx},${sy}`;
    };
    return `M ${toSc(previewPts[0])} ` + previewPts.slice(1).map((p) => `L ${toSc(p)}`).join(" ");
  }

  return (
    <svg
      ref={svgRef}
      style={{
        position: "absolute", inset: 0,
        cursor: "crosshair",
        pointerEvents: "all",
        touchAction: "none",
      }}
      width={canvasSize.width}
      height={canvasSize.height}
      onPointerDown={handlePointerDown}
    >
      {/* Live stroke preview */}
      {drawing && previewPts.length > 1 && (
        <path
          d={previewPath()}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
      )}
    </svg>
  );
}
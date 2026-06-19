// apps/editor/src/components/MaskPenOverlay.tsx
//
// Phase 2 §4.2 / WK 5-6 — mask pen tool. Intercepts pointer events in the
// viewport when tool === "mask", draws an SVG overlay showing the
// in-progress bezier path, and commits BezierPoints to the selected node's
// active Mask via mask-ops.ts commands.
//
// Interaction model (consistent with AE/Figma pen tool conventions):
//   click        → add a corner point (no handles)
//   drag         → add a smooth point (sets in/out handles symmetrically)
//   click first  → close the mask (when within CLOSE_RADIUS of the first point)
//   Escape/Enter → commit the current open path as-is (without closing)
//   double-click → commit and close
//
// The overlay lives in the same positioned container as <TransformGizmo>,
// so comp-space coords require the same comp-to-canvas transform (the `fit`
// object from Viewport.tsx). Points are stored in COMP SPACE (not canvas
// pixels) so they're resolution-independent and correctly animatable via
// the channel system later.

import { useEffect, useRef, useState, useCallback } from "react";
import type { Id, Mat3 } from "core";
import type { BezierPoint } from "core";
import type { Vec2 } from "core";
import type { FitTransform } from "../viewport/geometry";
import { compToScreen, screenToComp, invertMat3, applyMat3 } from "../viewport/geometry";
import { addMaskOp, appendMaskPointOp, closeMaskOp } from "../commands/mask-ops";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

const POINT_RADIUS = 5;
const HANDLE_RADIUS = 3.5;
const CLOSE_RADIUS = 12; // pixels — snap-to-close threshold

interface PenState {
  nodeId: Id;
  maskId: Id;
  /** Already-committed points in comp space */
  points: BezierPoint[];
  /** Live handle being dragged for the latest point (null = corner point) */
  dragHandle: Vec2 | null;
}

function pointPath(points: BezierPoint[], closing = false): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].point.x} ${points[0].point.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cp1 = prev.outHandle ? { x: prev.point.x + prev.outHandle.x, y: prev.point.y + prev.outHandle.y } : prev.point;
    const cp2 = curr.inHandle ? { x: curr.point.x + curr.inHandle.x, y: curr.point.y + curr.inHandle.y } : curr.point;
    d += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${curr.point.x} ${curr.point.y}`;
  }
  if (closing && points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];
    const cp1 = last.outHandle ? { x: last.point.x + last.outHandle.x, y: last.point.y + last.outHandle.y } : last.point;
    const cp2 = first.inHandle ? { x: first.point.x + first.inHandle.x, y: first.point.y + first.inHandle.y } : first.point;
    d += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${first.point.x} ${first.point.y} Z`;
  }
  return d;
}

export function MaskPenOverlay({
  nodeId,
  fit,
  canvasSize,
  nodeMatrix,
}: {
  nodeId: Id;
  fit: FitTransform;
  canvasSize: { width: number; height: number };
  /** The selected node's world matrix from the live RenderTree — used to convert screen coords to node LOCAL space, where mask paths must live (masks are in the node's own coordinate space, not comp space, so they scale/rotate with the node). */
  nodeMatrix: Mat3;
}) {
  const store = useEditorStoreApi();
  const [pen, setPen] = useState<PenState | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Commit the current open path and exit mask mode
  const commitAndExit = useCallback((close: boolean) => {
    if (pen && pen.points.length >= 1) {
      if (close && pen.points.length >= 3) {
        store.getState().apply(closeMaskOp(activeComp(store.getState()), pen.nodeId, pen.maskId));
      }
    }
    setPen(null);
    store.getState().setTool("select");
  }, [pen, store]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") commitAndExit(false);
      if (e.key === "Enter") commitAndExit(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commitAndExit]);

  // Reset pen state when the selected node changes
  useEffect(() => {
    setPen(null);
  }, [nodeId]);

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.preventDefault();
    e.stopPropagation();

    const rect = svgRef.current!.getBoundingClientRect();
    const canvasPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const compPt = screenToComp(canvasPt, fit);
    // Mask paths live in node LOCAL space (before the node's own world
    // transform) — exactly like AE masks. Convert comp-space coords to
    // local by applying the inverse of the node's world matrix.
    let localPt: Vec2;
    try {
      localPt = applyMat3(invertMat3(nodeMatrix), compPt);
    } catch {
      localPt = compPt; // singular matrix — fallback to comp space
    }

    // Start a new mask if none is in progress
    if (!pen) {
      const state = store.getState();
      const comp = activeComp(state);
      const { op, maskId } = addMaskOp(comp, nodeId);
      state.apply(op);
      const newState = store.getState();
      const newComp = activeComp(newState);
      newState.apply(appendMaskPointOp(newComp, nodeId, maskId, { point: localPt }));
      setPen({ nodeId, maskId, points: [{ point: localPt }], dragHandle: null });
      return;
    }

    // Check snap-to-close against the first point (in screen space)
    if (pen.points.length >= 3) {
      const firstComp = applyMat3(nodeMatrix, pen.points[0].point);
      const firstCanvas = compToScreen(firstComp, fit);
      const dist = Math.hypot(canvasPt.x - firstCanvas.x, canvasPt.y - firstCanvas.y);
      if (dist <= CLOSE_RADIUS) {
        commitAndExit(true);
        return;
      }
    }

    // Double-click → close
    if (e.detail >= 2) {
      commitAndExit(true);
      return;
    }

    // Append a new point in local space
    const newPoint: BezierPoint = { point: localPt };
    const state = store.getState();
    const comp = activeComp(state);
    state.apply(appendMaskPointOp(comp, pen.nodeId, pen.maskId, newPoint));
    setPen((prev) => prev ? { ...prev, points: [...prev.points, newPoint], dragHandle: null } : null);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handlePointerLeave() {
    setCursor(null);
  }

  // Transform: local → comp (via nodeMatrix) → screen (via fit)
  const canvasPoints: BezierPoint[] = (pen?.points ?? []).map((bp) => ({
    point: compToScreen(applyMat3(nodeMatrix, bp.point), fit),
    inHandle: bp.inHandle ? (() => {
      const h = applyMat3(nodeMatrix, { x: bp.point.x + bp.inHandle!.x, y: bp.point.y + bp.inHandle!.y });
      const base = compToScreen(applyMat3(nodeMatrix, bp.point), fit);
      const hs = compToScreen(h, fit);
      return { x: hs.x - base.x, y: hs.y - base.y };
    })() : undefined,
    outHandle: bp.outHandle ? (() => {
      const h = applyMat3(nodeMatrix, { x: bp.point.x + bp.outHandle!.x, y: bp.point.y + bp.outHandle!.y });
      const base = compToScreen(applyMat3(nodeMatrix, bp.point), fit);
      const hs = compToScreen(h, fit);
      return { x: hs.x - base.x, y: hs.y - base.y };
    })() : undefined,
  }));

  const isNearFirst = pen && pen.points.length >= 3 && cursor
    ? (() => {
        const firstComp = applyMat3(nodeMatrix, pen.points[0].point);
        const firstCanvas = compToScreen(firstComp, fit);
        return Math.hypot(cursor.x - firstCanvas.x, cursor.y - firstCanvas.y) <= CLOSE_RADIUS;
      })()
    : false;

  const previewPath = pen && cursor
    ? (() => {
        const last = canvasPoints[canvasPoints.length - 1];
        if (!last) return "";
        return `M ${last.point.x} ${last.point.y} L ${cursor.x} ${cursor.y}`;
      })()
    : "";

  return (
    <svg
      ref={svgRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: isNearFirst ? "cell" : "crosshair", touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* Committed path */}
      {canvasPoints.length > 0 && (
        <path d={pointPath(canvasPoints)} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 2" />
      )}

      {/* Preview line to cursor */}
      {previewPath && (
        <path d={previewPath} fill="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
      )}

      {/* Point anchors */}
      {canvasPoints.map((bp, i) => (
        <circle
          key={i}
          cx={bp.point.x}
          cy={bp.point.y}
          r={i === 0 && pen && pen.points.length >= 3 ? POINT_RADIUS + 2 : POINT_RADIUS}
          fill={i === 0 ? "var(--accent)" : "var(--surface-1)"}
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
      ))}

      {/* Handle lines for smooth points */}
      {canvasPoints.map((bp, i) => (
        <g key={`h${i}`}>
          {bp.outHandle && (
            <>
              <line x1={bp.point.x} y1={bp.point.y} x2={bp.point.x + bp.outHandle.x} y2={bp.point.y + bp.outHandle.y} stroke="var(--accent)" strokeWidth={1} opacity={0.5} />
              <circle cx={bp.point.x + bp.outHandle.x} cy={bp.point.y + bp.outHandle.y} r={HANDLE_RADIUS} fill="var(--accent)" opacity={0.8} />
            </>
          )}
          {bp.inHandle && (
            <>
              <line x1={bp.point.x} y1={bp.point.y} x2={bp.point.x + bp.inHandle.x} y2={bp.point.y + bp.inHandle.y} stroke="var(--accent)" strokeWidth={1} opacity={0.5} />
              <circle cx={bp.point.x + bp.inHandle.x} cy={bp.point.y + bp.inHandle.y} r={HANDLE_RADIUS} fill="var(--accent)" opacity={0.8} />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
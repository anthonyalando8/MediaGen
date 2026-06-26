// apps/editor/src/components/PathEditOverlay.tsx
//
// Bezier path editor. Two modes:
//   "select" — drag anchors/handles, multi-select, delete.
//   "pen"    — each click/drag APPENDS a point to livePoints immediately
//              (committed to store on pointer-up). There is no separate
//              penPoints buffer — new points join the live path directly.
//              Preview line runs from last livePoint to cursor.
//              Snap-to-first closes the path.
//
// COORDINATE SPACES (same as MaskPenOverlay):
//   local → comp  : applyMat3(nodeMatrix, pt)
//   comp → screen : compToScreen(pt, fit)
//   screen → comp : screenToComp(pt, fit)
//   comp → local  : applyMat3(invertMat3(nodeMatrix), pt)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Mat3, Node } from "core";
import { createId, createOp } from "core";
import { compToScreen, screenToComp, invertMat3, applyMat3 } from "../viewport/geometry";
import type { FitTransform } from "../viewport/geometry";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

// ── Types ─────────────────────────────────────────────────────────────────

interface BPoint {
  point: { x: number; y: number };
  inHandle?:  { x: number; y: number };
  outHandle?: { x: number; y: number };
}

type EditMode   = "select" | "pen";
type DragTarget = { kind: "anchor" | "in" | "out"; index: number };

const ANCHOR_R = 5;
const HANDLE_R = 3.5;
const CLOSE_R  = 14; // px — snap-to-close threshold

// ── Helpers ───────────────────────────────────────────────────────────────

function clonePoints(pts: BPoint[]): BPoint[] {
  return pts.map((p) => ({
    point:     { ...p.point },
    inHandle:  p.inHandle  ? { ...p.inHandle  } : undefined,
    outHandle: p.outHandle ? { ...p.outHandle } : undefined,
  }));
}

function buildSvgPath(
  pts: BPoint[],
  closed: boolean,
  toScreen: (p: { x: number; y: number }) => { x: number; y: number }
): string {
  if (pts.length < 2) return "";
  const xy = (p: { x: number; y: number }) => { const s = toScreen(p); return `${s.x},${s.y}`; };
  const s0 = toScreen(pts[0].point);
  let d = `M ${s0.x},${s0.y}`;
  for (let i = 0; i < pts.length; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % pts.length];
    if (i === pts.length - 1 && !closed) break;
    const cp1 = curr.outHandle ? { x: curr.point.x + curr.outHandle.x, y: curr.point.y + curr.outHandle.y } : curr.point;
    const cp2 = next.inHandle  ? { x: next.point.x + next.inHandle.x,  y: next.point.y + next.inHandle.y  } : next.point;
    d += ` C ${xy(cp1)} ${xy(cp2)} ${xy(next.point)}`;
  }
  if (closed) d += " Z";
  return d;
}

// ── Component ─────────────────────────────────────────────────────────────

interface Props {
  node:       Node;
  fit:        FitTransform;
  canvasSize: { width: number; height: number };
  nodeMatrix: Mat3;
  onDismiss:  () => void;
}

export function PathEditOverlay({ node, fit, canvasSize, nodeMatrix, onDismiss }: Props) {
  const store  = useEditorStoreApi();
  const svgRef = useRef<SVGSVGElement>(null);
  // Ignore the very first pointer-down on the overlay — it's the same
  // double-click/pointer-down that triggered the overlay to open, so we
  // must not add a spurious point from it.
  const justOpenedRef = useRef(true);

  const rawPts    = (node.props.pathPoints as unknown as BPoint[]  | undefined) ?? [];
  const rawClosed = (node.props.pathClosed as unknown as boolean   | undefined) ?? true;

  const [livePoints, setLivePoints] = useState<BPoint[]>(rawPts);
  const [closed,     setClosed]     = useState<boolean>(rawClosed);
  const [selected,   setSelected]   = useState<Set<number>>(new Set());
  const [mode,       setMode]       = useState<EditMode>("select");

  // Pen preview state — no separate penPoints buffer; just cursor position
  const [penCursor,     setPenCursor]     = useState<{ x: number; y: number } | null>(null);
  const [penDragHandle, setPenDragHandle] = useState<{ x: number; y: number } | null>(null);

  // Sync from store on undo/redo
  useLayoutEffect(() => {
    setLivePoints((node.props.pathPoints as unknown as BPoint[] | undefined) ?? []);
    setClosed((node.props.pathClosed    as unknown as boolean   | undefined) ?? true);
  }, [node.props.pathPoints, node.props.pathClosed]);

  // ── Coordinate helpers ──────────────────────────────────────────────────

  function localToScreen(lp: { x: number; y: number }) {
    return compToScreen(applyMat3(nodeMatrix, lp), fit);
  }

  function screenToLocal(sx: number, sy: number) {
    const cp = screenToComp({ x: sx, y: sy }, fit);
    try { return applyMat3(invertMat3(nodeMatrix), cp); } catch { return cp; }
  }

  function svgXY(e: React.PointerEvent | PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ── Commit ──────────────────────────────────────────────────────────────

  const commit = useCallback((pts: BPoint[], isClosed: boolean) => {
    const state = store.getState();
    const comp  = activeComp(state);
    const idx   = comp.root.findIndex((n) => n.id === node.id);
    if (idx === -1) return;
    // Read the CURRENT node props from the store — not the stale `node` prop
    // (Viewport doesn't re-render on prop changes, so node.props would be stale
    //  after the first commit, causing each subsequent commit to overwrite
    //  the previous one with the original props as `before`).
    const currentProps = comp.root[idx].props;
    const before = currentProps as unknown as import("core").Json;
    const after  = { ...(currentProps as object), pathPoints: pts, pathClosed: isClosed } as unknown as import("core").Json;
    state.apply(createOp({ type: "set", compId: comp.id, path: `/root/${idx}/props`, before, after, txn: createId() }));
  }, [store, node.id]);

  // ── Keyboard ────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Escape" || e.key === "Enter") { onDismiss(); return; }

      if ((e.key === "Delete" || e.key === "Backspace") && mode === "select" && selected.size > 0) {
        e.preventDefault();
        const pts = clonePoints(livePoints);
        Array.from(selected).sort((a, b) => b - a).forEach((i) => pts.splice(i, 1));
        setLivePoints(pts);
        setSelected(new Set());
        commit(pts, closed);
        return;
      }
      if (e.key === "c" || e.key === "C") { const nc = !closed; setClosed(nc); commit(livePoints, nc); }
      if (e.key === "p" || e.key === "P") { setMode((m) => m === "pen" ? "select" : "pen"); }
      if (e.key === "a" || e.key === "A") { setSelected(new Set(livePoints.map((_, i) => i))); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selected, livePoints, closed, commit, onDismiss]);

  // ── SELECT — drag anchor or handle ─────────────────────────────────────

  function handleAnchorDown(target: DragTarget, e: React.PointerEvent) {
    if (mode !== "select") return;
    if (justOpenedRef.current) { justOpenedRef.current = false; return; }
    e.stopPropagation(); e.preventDefault();
    (e.target as SVGElement).setPointerCapture(e.pointerId);

    if (!e.shiftKey) setSelected(new Set([target.index]));
    else setSelected((s) => { const n = new Set(s); n.has(target.index) ? n.delete(target.index) : n.add(target.index); return n; });

    const origin  = clonePoints(livePoints);
    const startSc = { x: e.clientX, y: e.clientY };
    const originSc = localToScreen(origin[target.index].point);
    let working = clonePoints(livePoints);

    function onMove(ev: PointerEvent) {
      working = clonePoints(origin);
      const p = working[target.index];
      if (!p) return;
      if (target.kind === "anchor") {
        p.point = screenToLocal(
          originSc.x + (ev.clientX - startSc.x),
          originSc.y + (ev.clientY - startSc.y),
        );
      } else {
        // Handle: delta in screen → scale by inverse of nodeMatrix scale
        const dx = (ev.clientX - startSc.x) / fit.scale;
        const dy = (ev.clientY - startSc.y) / fit.scale;
        const sx = nodeMatrix[0] || 1, sy = nodeMatrix[4] || 1;
        if (target.kind === "in"  && origin[target.index].inHandle)
          p.inHandle  = { x: origin[target.index].inHandle!.x  + dx / sx, y: origin[target.index].inHandle!.y  + dy / sy };
        if (target.kind === "out" && origin[target.index].outHandle)
          p.outHandle = { x: origin[target.index].outHandle!.x + dx / sx, y: origin[target.index].outHandle!.y + dy / sy };
      }
      setLivePoints(working);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      commit(working, closed);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ── PEN — each click appends one point directly to livePoints ──────────

  function handlePenDown(e: React.PointerEvent<SVGSVGElement>) {
    if (mode !== "pen") return;
    // Skip the very first pointer-down — it's the double-click that opened us
    if (justOpenedRef.current) { justOpenedRef.current = false; return; }
    e.preventDefault(); e.stopPropagation();

    const sc = svgXY(e);
    const lp = screenToLocal(sc.x, sc.y);

    // Snap-to-close: click near the FIRST livePoint when ≥3 points exist
    if (livePoints.length >= 3) {
      const firstSc = localToScreen(livePoints[0].point);
      if (Math.hypot(sc.x - firstSc.x, sc.y - firstSc.y) <= CLOSE_R) {
        setClosed(true);
        commit(livePoints, true);
        setMode("select");
        return;
      }
    }

    // Double-click → finish (stay in current closed state, switch to select)
    if (e.detail >= 2) {
      commit(livePoints, closed);
      setMode("select");
      return;
    }

    // Drag to pull bezier handles
    const svgRect = svgRef.current!.getBoundingClientRect();
    const newPoint: BPoint = { point: lp };
    let dragH: { x: number; y: number } | null = null;

    function onMove(ev: PointerEvent) {
      const mvSc = { x: ev.clientX - svgRect.left, y: ev.clientY - svgRect.top };
      const mvLp = screenToLocal(mvSc.x, mvSc.y);
      dragH = { x: mvLp.x - lp.x, y: mvLp.y - lp.y };
      newPoint.outHandle = { ...dragH };
      newPoint.inHandle  = { x: -dragH.x, y: -dragH.y };
      setPenDragHandle(localToScreen({ x: lp.x + dragH.x, y: lp.y + dragH.y }));
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPenDragHandle(null);
      // Append directly to livePoints and commit
      const newPts = [...livePoints, { ...newPoint }];
      setLivePoints(newPts);
      commit(newPts, closed);
    }

    (e.target as SVGElement).setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ── Snap-to-close indicator ─────────────────────────────────────────────

  const nearFirst = mode === "pen" && livePoints.length >= 3 && penCursor !== null
    ? (() => {
        const fSc = localToScreen(livePoints[0].point);
        return Math.hypot(penCursor.x - fSc.x, penCursor.y - fSc.y) <= CLOSE_R;
      })()
    : false;

  const lastPt = livePoints.length > 0 ? localToScreen(livePoints[livePoints.length - 1].point) : null;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Toolbar */}
      <div className="path-edit-toolbar">
        <button className={`btn btn-sm${mode === "select" ? " btn-active" : ""}`} onClick={() => setMode("select")}>↖ Select</button>
        <button className={`btn btn-sm${mode === "pen"    ? " btn-active" : ""}`} onClick={() => setMode((m) => { if (m !== "pen") justOpenedRef.current = false; return m === "pen" ? "select" : "pen"; })}>✦ Pen</button>
        <button className="btn btn-sm" onClick={() => { const nc = !closed; setClosed(nc); commit(livePoints, nc); }}>{closed ? "⌀ Open" : "● Close"}</button>
        <span className="path-edit-toolbar__hint">
          {mode === "pen"
            ? "Click to add · drag for curves · near start to close · Dbl-click to finish"
            : "Drag points/handles · Shift+click multi-select · Delete removes · A selects all · Esc to exit"}
        </span>
      </div>

      {/* SVG overlay */}
      <svg
        ref={svgRef}
        className="path-edit-overlay"
        width={canvasSize.width}
        height={canvasSize.height}
        style={{
          position: "absolute", inset: 0,
          cursor: mode === "pen" ? (nearFirst ? "cell" : "crosshair") : "default",
          pointerEvents: mode === "pen" ? "all" : "none",
          touchAction: "none",
        }}
        onPointerDown={mode === "pen" ? handlePenDown : undefined}
        onPointerMove={(e) => { if (mode === "pen") setPenCursor(svgXY(e)); }}
        onPointerLeave={() => setPenCursor(null)}
      >
        {/* Path outline */}
        <path d={buildSvgPath(livePoints, closed, localToScreen)} fill="none" stroke="var(--accent)" strokeWidth={1} opacity={0.45} style={{ pointerEvents: "none" }} />

        {/* Pen preview line: last point → cursor */}
        {mode === "pen" && lastPt && penCursor && !nearFirst && (
          <line x1={lastPt.x} y1={lastPt.y} x2={penCursor.x} y2={penCursor.y}
            stroke="var(--accent)" strokeWidth={1} opacity={0.45} strokeDasharray="3 3"
            style={{ pointerEvents: "none" }} />
        )}

        {/* Snap-to-close ring on first anchor when hovering near it in pen mode */}
        {nearFirst && livePoints.length > 0 && (() => {
          const fSc = localToScreen(livePoints[0].point);
          return <circle cx={fSc.x} cy={fSc.y} r={ANCHOR_R + 5} fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.7} style={{ pointerEvents: "none" }} />;
        })()}

        {/* All anchors + handles */}
        {livePoints.map((bp, i) => {
          const sp    = localToScreen(bp.point);
          const isSel = selected.has(i);
          const inAbsLp  = bp.inHandle  ? { x: bp.point.x + bp.inHandle.x,  y: bp.point.y + bp.inHandle.y  } : null;
          const outAbsLp = bp.outHandle ? { x: bp.point.x + bp.outHandle.x, y: bp.point.y + bp.outHandle.y } : null;
          const inSc  = inAbsLp  ? localToScreen(inAbsLp)  : null;
          const outSc = outAbsLp ? localToScreen(outAbsLp) : null;

          return (
            <g key={i}>
              {inSc && <>
                <line x1={sp.x} y1={sp.y} x2={inSc.x} y2={inSc.y} stroke="var(--accent)" strokeWidth={1} opacity={0.4} style={{ pointerEvents: "none" }} />
                <rect x={inSc.x - HANDLE_R} y={inSc.y - HANDLE_R} width={HANDLE_R * 2} height={HANDLE_R * 2}
                  fill="var(--surface-1)" stroke="var(--accent)" strokeWidth={1.5}
                  transform={`rotate(45,${inSc.x},${inSc.y})`}
                  style={{ pointerEvents: mode === "select" ? "all" : "none", cursor: "move" }}
                  onPointerDown={(e) => handleAnchorDown({ kind: "in", index: i }, e)} />
              </>}
              {outSc && <>
                <line x1={sp.x} y1={sp.y} x2={outSc.x} y2={outSc.y} stroke="var(--accent)" strokeWidth={1} opacity={0.4} style={{ pointerEvents: "none" }} />
                <rect x={outSc.x - HANDLE_R} y={outSc.y - HANDLE_R} width={HANDLE_R * 2} height={HANDLE_R * 2}
                  fill="var(--surface-1)" stroke="var(--accent)" strokeWidth={1.5}
                  transform={`rotate(45,${outSc.x},${outSc.y})`}
                  style={{ pointerEvents: mode === "select" ? "all" : "none", cursor: "move" }}
                  onPointerDown={(e) => handleAnchorDown({ kind: "out", index: i }, e)} />
              </>}
              <circle cx={sp.x} cy={sp.y} r={ANCHOR_R}
                fill={isSel ? "var(--accent)" : i === 0 && mode === "pen" && livePoints.length >= 3 ? "#66eedd" : "#fff"}
                stroke="var(--accent)" strokeWidth={1.5}
                style={{ pointerEvents: mode === "select" ? "all" : "none", cursor: "move" }}
                onPointerDown={(e) => handleAnchorDown({ kind: "anchor", index: i }, e)} />
            </g>
          );
        })}

        {/* Pen drag handle preview */}
        {penDragHandle && lastPt && (
          <>
            <line x1={lastPt.x} y1={lastPt.y} x2={penDragHandle.x} y2={penDragHandle.y}
              stroke="var(--accent)" strokeWidth={1} opacity={0.6} />
            <circle cx={penDragHandle.x} cy={penDragHandle.y} r={HANDLE_R}
              fill="var(--accent)" opacity={0.85} />
          </>
        )}
      </svg>
    </>
  );
}
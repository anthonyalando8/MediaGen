// apps/editor/src/components/TransformGizmo.tsx
//
// On-canvas move/scale/rotate gizmos -> commands -> ops (Deliverable 09
// §9.1, Week 7). Renders an SVG overlay for the single selected node:
//  - the bounding-box outline doubles as the MOVE handle (drag the body)
//  - 8 handles (4 corners + 4 edge midpoints, geometry.ts's
//    `getScaleHandles`) SCALE around the opposite corner/edge — corners
//    resize both axes, edge midpoints resize one axis only
//  - 1 handle above the top edge ROTATES around the bbox center
//
// Positions are recomputed every animation frame from `treeRef.current`
// (written by <Viewport>'s RAF loop — avoids a second evaluateComposition
// per frame) via direct DOM attribute writes, NOT React state/re-renders —
// consistent with "the render loop stays out of React" (Week 6).
//
// During a drag, `onPreview` is called with a `DragPreview` (nodeId + a
// comp-space world matrix) on every pointermove for live visual feedback —
// <Viewport> splices this into the RenderTree before calling
// `renderer.render()`. The actual Op (moveNode/scaleNode/rotateNode) is
// applied ONCE, on pointer-up, with the gesture's total delta — "coalesce
// drags into one txn" (Deliverable 09 §9.2) via "one op per drag" rather
// than literal txn-coalescing of many ops. scaleNode/rotateNode are called
// with a `pivot` (the handle's opposite corner/edge, or the bbox center for
// rotation) so `transform.position` is solved to keep that point fixed —
// matching the live preview and avoiding a post-release "jump".
//
// GROUPS: a "group" RenderNode is skipped by `reconcile()` (no visual of
// its own — evaluate-node.ts's flat-array doc), so previewing just its own
// matrix has no visible effect. When `nodeId` is a group, `descendantIds`
// (this node's Tier1 descendant ids, store/node-tree.ts) is included in the
// preview — <Viewport> re-derives each descendant's matrix relative to the
// PREVIEW matrix, cascading the group's live transform to its children. The
// bounding box itself is also group-aware: `getGroupBounds` (geometry.ts)
// unions the descendants' bounds instead of `getRenderNodeBounds`'s
// DEFAULT_BOUNDS fallback for "group".
//
// COORDINATE SPACES: `PointerEvent.clientX/Y` are PAGE coordinates, but
// `fit`/`compToScreen`/`screenToComp` (viewport/geometry.ts) operate on
// coordinates LOCAL to this <svg> overlay (which is flush with the canvas,
// but the canvas itself is offset within the page by the surrounding
// layout — LayerPanel/Toolbar). MOVE uses a pointer-position DELTA, which
// is offset-invariant, but SCALE/ROTATE need an absolute comp-space
// position — `clientToLocal` (geometry.ts) subtracts the <svg>'s own
// `getBoundingClientRect()` origin before any `fit`-based conversion.

import { useEffect, useMemo, useRef } from "react";
import type { Mat3, Rect, RenderTree } from "contract";
import type { Id, Node } from "core";
import { moveNode, rotateNode, scaleNode } from "../commands/transform-node";
import {
  applyMat3,
  clientToLocal,
  compToScreen,
  type FitTransform,
  getGroupBounds,
  getOrientedCorners,
  getRectCenter,
  getRenderNodeBounds,
  getScaleHandles,
  rotationMat3,
  scaleMat3,
  screenDeltaToComp,
  screenToComp,
  type ScaleHandle,
  type Size,
  transformAroundPivot,
  translationMat3,
  type Vec2,
} from "../viewport/geometry";
import { collectDescendantIds } from "../store/node-tree";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

export interface DragPreview {
  nodeId: Id;
  /** A comp-space world matrix to substitute for this node's RenderTree.matrix while the drag is live. */
  matrix: Mat3;
  /** For "group" nodes: Tier1 descendant ids (store/node-tree.ts) whose RenderTree matrices <Viewport> should re-derive relative to `matrix` — see module doc "GROUPS". */
  descendantIds?: Set<Id>;
}

const HANDLE_RADIUS = 5;
const ROTATE_HANDLE_OFFSET = 24; // screen px above the top edge

// Gizmo stroke/handle colors match styles/theme.css's --accent/--surface-0
// (SVG can't reference CSS custom properties from a JS-built `<svg>`'s
// attribute strings here, so these are the same hex values inlined).

/** Cursor per handle, in `getScaleHandles`'s fixed order: TL, TR, BR, BL, TOP, RIGHT, BOTTOM, LEFT. */
const HANDLE_CURSORS = ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize", "ns-resize", "ew-resize", "ns-resize", "ew-resize"];

interface TransformGizmoProps {
  nodeId: Id;
  /** The selected node's Tier1 record — used only to derive `descendantIds` for "group" nodes (collectDescendantIds, store/node-tree.ts). */
  selectedNode: Node;
  fit: FitTransform;
  canvasSize: Size;
  treeRef: React.RefObject<RenderTree | null>;
  onPreview: (preview: DragPreview | null) => void;
}

export function TransformGizmo({ nodeId, selectedNode, fit, canvasSize, treeRef, onPreview }: TransformGizmoProps) {
  const store = useEditorStoreApi();
  const svgRef = useRef<SVGSVGElement>(null);
  const polygonRef = useRef<SVGPolygonElement>(null);
  const handleRefs = useRef<(SVGCircleElement | null)[]>(new Array(8).fill(null));
  const rotateLineRef = useRef<SVGLineElement>(null);
  const rotateHandleRef = useRef<SVGCircleElement>(null);

  // Tier1 descendant ids for "group" selections (store/node-tree.ts) —
  // recomputed only when the selected node's record changes.
  const descendantIds = useMemo(() => collectDescendantIds(selectedNode), [selectedNode]);

  // Latest local-space bounds + world matrix, written by the RAF loop and
  // read by pointer handlers at drag-start.
  const boundsRef = useRef<Rect | null>(null);
  const matrixRef = useRef<Mat3 | null>(null);
  const isGroupRef = useRef(false);

  // Keeps pointer handlers (closed over `fit` at drag-start) correct across re-renders.
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    let raf = 0;

    const tick = (): void => {
      const tree = treeRef.current;
      const renderNode = tree?.nodes.find((n) => n.id === nodeId);
      if (renderNode && tree) {
        const isGroup = renderNode.t === "group";
        isGroupRef.current = isGroup;
        const bounds = isGroup
          ? getGroupBounds(renderNode.matrix, tree.nodes.filter((n) => descendantIds.has(n.id as unknown as Id)))
          : getRenderNodeBounds(renderNode);
        boundsRef.current = bounds;
        matrixRef.current = renderNode.matrix;

        const cornersScreen = getOrientedCorners(bounds, renderNode.matrix).map((c) => compToScreen(c, fit));
        polygonRef.current?.setAttribute("points", cornersScreen.map((c) => `${c.x},${c.y}`).join(" "));

        const handleScreen = getScaleHandles(bounds).map((h) => compToScreen(applyMat3(renderNode.matrix, h.local), fit));
        handleScreen.forEach((c, i) => {
          handleRefs.current[i]?.setAttribute("cx", String(c.x));
          handleRefs.current[i]?.setAttribute("cy", String(c.y));
        });

        // Rotate handle: above the midpoint of the top edge (corners[0]-corners[1]),
        // offset outward along the box's "up" direction (top-left minus bottom-left).
        const [tl, tr, , bl] = cornersScreen;
        const topMid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
        const upX = tl.x - bl.x;
        const upY = tl.y - bl.y;
        const upLen = Math.hypot(upX, upY) || 1;
        const handle = {
          x: topMid.x + (upX / upLen) * ROTATE_HANDLE_OFFSET,
          y: topMid.y + (upY / upLen) * ROTATE_HANDLE_OFFSET,
        };
        rotateLineRef.current?.setAttribute("x1", String(topMid.x));
        rotateLineRef.current?.setAttribute("y1", String(topMid.y));
        rotateLineRef.current?.setAttribute("x2", String(handle.x));
        rotateLineRef.current?.setAttribute("y2", String(handle.y));
        rotateHandleRef.current?.setAttribute("cx", String(handle.x));
        rotateHandleRef.current?.setAttribute("cy", String(handle.y));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nodeId, fit, treeRef, descendantIds]);

  function handleMovePointerDown(e: React.PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const startMatrix = matrixRef.current;
    if (!startMatrix) return;
    const start: Vec2 = { x: e.clientX, y: e.clientY };
    let lastDelta: Vec2 = { x: 0, y: 0 };

    function onMove(ev: PointerEvent): void {
      const screenDelta = { x: ev.clientX - start.x, y: ev.clientY - start.y };
      lastDelta = screenDeltaToComp(screenDelta, fitRef.current);
      const matrix = transformAroundPivot(startMatrix!, { x: 0, y: 0 }, translationMat3(lastDelta.x, lastDelta.y));
      onPreview({ nodeId, matrix, descendantIds: isGroupRef.current ? descendantIds : undefined });
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onPreview(null);
      if (lastDelta.x !== 0 || lastDelta.y !== 0) {
        const state = store.getState();
        state.apply(moveNode(activeComp(state), nodeId, lastDelta.x, lastDelta.y));
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleScalePointerDown(e: React.PointerEvent, handle: ScaleHandle): void {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const startMatrix = matrixRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!startMatrix || !rect) return;
    const localRect = rect; // re-bind so nested closures see the narrowed (non-undefined) type

    // The pivot (opposite corner/edge) stays fixed — both during the live
    // preview (transformAroundPivot below) and after commit
    // (scaleNode's `pivot` param repositions transform.position to match).
    const pivotWorld = applyMat3(startMatrix, handle.pivotLocal);
    const handleWorld0 = applyMat3(startMatrix, handle.local);
    const v0 = { x: handleWorld0.x - pivotWorld.x, y: handleWorld0.y - pivotWorld.y };
    let lastFactors: Vec2 = { x: 1, y: 1 };

    function onMove(ev: PointerEvent): void {
      const newPoint = screenToComp(clientToLocal(localRect, ev.clientX, ev.clientY), fitRef.current);
      const v1 = { x: newPoint.x - pivotWorld.x, y: newPoint.y - pivotWorld.y };
      const sx = handle.axes.x ? (Math.abs(v0.x) < 1e-6 ? 1 : v1.x / v0.x) : 1;
      const sy = handle.axes.y ? (Math.abs(v0.y) < 1e-6 ? 1 : v1.y / v0.y) : 1;
      lastFactors = { x: sx, y: sy };
      const matrix = transformAroundPivot(startMatrix!, pivotWorld, scaleMat3(sx, sy));
      onPreview({ nodeId, matrix, descendantIds: isGroupRef.current ? descendantIds : undefined });
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onPreview(null);
      if (lastFactors.x !== 1 || lastFactors.y !== 1) {
        const state = store.getState();
        state.apply(scaleNode(activeComp(state), nodeId, lastFactors.x, lastFactors.y, { local: handle.pivotLocal, world: pivotWorld }));
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleRotatePointerDown(e: React.PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const startMatrix = matrixRef.current;
    const bounds = boundsRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!startMatrix || !bounds || !rect) return;
    const localRect = rect; // re-bind so nested closures see the narrowed (non-undefined) type

    const centerLocal = getRectCenter(bounds);
    const centerWorld = applyMat3(startMatrix, centerLocal);
    const centerScreen = compToScreen(centerWorld, fitRef.current);

    function angleTo(clientX: number, clientY: number): number {
      const local = clientToLocal(localRect, clientX, clientY);
      return Math.atan2(local.y - centerScreen.y, local.x - centerScreen.x);
    }

    const startAngle = angleTo(e.clientX, e.clientY);
    let lastDelta = 0;

    function onMove(ev: PointerEvent): void {
      lastDelta = ((angleTo(ev.clientX, ev.clientY) - startAngle) * 180) / Math.PI;
      const matrix = transformAroundPivot(startMatrix!, centerWorld, rotationMat3(lastDelta));
      onPreview({ nodeId, matrix, descendantIds: isGroupRef.current ? descendantIds : undefined });
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onPreview(null);
      if (lastDelta !== 0) {
        const state = store.getState();
        state.apply(rotateNode(activeComp(state), nodeId, lastDelta, { local: centerLocal, world: centerWorld }));
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <svg
      ref={svgRef}
      width={canvasSize.width}
      height={canvasSize.height}
      viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <polygon
        ref={polygonRef}
        fill="transparent"
        stroke="#35d6c1"
        strokeWidth={1.5}
        style={{ pointerEvents: "all", cursor: "move" }}
        onPointerDown={handleMovePointerDown}
      />
      <line ref={rotateLineRef} stroke="#35d6c1" strokeWidth={1.5} />
      <circle
        ref={rotateHandleRef}
        r={HANDLE_RADIUS}
        fill="#0a0c0f"
        stroke="#35d6c1"
        strokeWidth={1.5}
        style={{ pointerEvents: "all", cursor: "grab" }}
        onPointerDown={handleRotatePointerDown}
      />
      {HANDLE_CURSORS.map((cursor, i) => (
        <circle
          key={i}
          ref={(el) => {
            handleRefs.current[i] = el;
          }}
          r={HANDLE_RADIUS}
          fill="#0a0c0f"
          stroke="#35d6c1"
          strokeWidth={1.5}
          style={{ pointerEvents: "all", cursor }}
          onPointerDown={(e) => {
            const bounds = boundsRef.current;
            if (bounds) handleScalePointerDown(e, getScaleHandles(bounds)[i]);
          }}
        />
      ))}
    </svg>
  );
}
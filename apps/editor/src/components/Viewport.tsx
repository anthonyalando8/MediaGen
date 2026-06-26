// apps/editor/src/components/Viewport.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { mul, toFrame } from "core";
import type { Id, NodeKindRegistry } from "core";
import { createWebGLRenderer } from "renderer-webgl";
import type { MediaService, Renderer } from "renderer-webgl";
import type { MediaAssetRef } from "media";
import type { RenderTree } from "contract";
import { CanvasHost } from "ui";
import { appendNodeOp } from "../commands/add-node";
import { useRegistry } from "../bootstrap/registry-context";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import type { EditorState, EditorStore } from "../store";
import { activeComp, renderTreeAt } from "../store/selectors";
import { clientToLocal, computeFitTransform, type FitTransform, hitTestTree, invertMat3, screenToComp, type Size, type Vec2 } from "../viewport/geometry";
import { TransformGizmo } from "./TransformGizmo";
import type { DragPreview } from "./TransformGizmo";
import { ViewportFrame } from "./ViewportFrame";
import { MaskPenOverlay } from "./MaskPenOverlay";
import { RichTextEditor } from "./RichTextEditor";
import type { RichTextEditorHandle } from "./RichTextEditor";
import { PathEditOverlay } from "./PathEditOverlay";
import { DrawOverlay } from "./DrawOverlay";
import { DrawOptionsBar } from "./DrawOptionsBar";
import { registerPathEditHandler } from "../store/path-edit-handle";
import { setActiveEditor } from "../store/editor-handle";

/**
 * Builds the `MediaService` `createWebGLRenderer` needs (Deliverable 08:
 * `createWebGLRenderer(canvas, media: MediaService)`) from `project.assets`
 * (core's `AssetRef`) — exit criterion 02 ("User adds an image from
 * upload; it appears in canvas"). `resolveAsset` reads `store.getState()`
 * directly (not a prop/closure snapshot), so newly-uploaded assets resolve
 * correctly even though `createRenderer` (passed to <CanvasHost>, which
 * mounts the renderer once) only runs on initial mount.
 *
 * `media`'s `MediaAssetRef.kind` is `"image" | "video" | "audio"` — a
 * narrower set than core's `AssetRef.kind` (which also covers
 * font/lottie/rig/glb/svg). `TextureManager.get` is only ever called for
 * image/video `TexRef`s (the only kinds `addMediaNode`, add-media.ts,
 * turns into nodes), so the cast below is safe in practice.
 */
function createMediaService(store: EditorStore): MediaService {
  return {
    resolveAsset(assetId) {
      const asset = store.getState().document.project.assets.find((a) => a.id === assetId);
      if (!asset) return undefined;
      return { id: asset.id, kind: asset.kind as MediaAssetRef["kind"], url: asset.proxy ?? asset.master };
    },
  };
}

const ZERO_SIZE: Size = { width: 0, height: 0 };

/**
 * Splices a live `<TransformGizmo>` drag preview into `nodes`.
 *
 * For a non-group `preview.nodeId`, this just substitutes its matrix. For a
 * "group" (where `preview.descendantIds` is set — TransformGizmo.tsx's
 * "GROUPS" doc), the group's own RenderNode is invisible (evaluate-node.ts's
 * flat-array doc), so each DESCENDANT's matrix is also re-derived: factor
 * out the group's CURRENT matrix to get the child's matrix relative to the
 * group, then re-apply the PREVIEW matrix — `child' = preview * (inverse(current) * child)`.
 * Falls back to leaving descendants unchanged if `current` is singular
 * (e.g. a 0-scale group mid-drag — shouldn't normally occur, but a bad
 * frame here must not crash the render loop, see the RAF `catch` below).
 */
function applyDragPreview(nodes: RenderTree["nodes"], preview: DragPreview): RenderTree["nodes"] {
  const current = nodes.find((n) => n.id === preview.nodeId);
  if (!current) return nodes;

  let toLocal: ((m: RenderTree["nodes"][number]["matrix"]) => RenderTree["nodes"][number]["matrix"]) | null = null;
  if (preview.descendantIds) {
    try {
      const inv = invertMat3(current.matrix);
      toLocal = (m) => mul(inv, m);
    } catch {
      toLocal = null; // singular current matrix — leave descendants as-is
    }
  }

  return nodes.map((n) => {
    if (n.id === preview.nodeId) return { ...n, matrix: preview.matrix };
    if (toLocal && preview.descendantIds?.has(n.id as unknown as Id)) {
      return { ...n, matrix: mul(preview.matrix, toLocal(n.matrix)) };
    }
    return n;
  });
}

/**
 * Click-to-select / click-to-place — the Toolbar's Select/Text/Shape tool
 * row (store/selection.ts's `tool`) previously had no effect on the canvas
 * at all: clicking a tool button only changed which button looked pressed.
 *
 * - "select": hit-tests `point` (via `hitTestTree`, in z-order — topmost
 *   wins) against `tree.nodes` and selects that node, or clears the
 *   selection if nothing was hit (clicking empty canvas to deselect).
 * - "text" / "shape": creates a new node of that kind at `point`, then
 *   switches back to "select" with the new node selected — matching the
 *   click-to-place convention of most design tools, and complementing the
 *   Toolbar's existing "Shape"/"Text" buttons (which always add at a fixed
 *   default position with no placement step).
 *
 * Click position: `position` is the node's TOP-LEFT in local space
 * (getRenderNodeBounds's convention — shape/text content is laid out from
 * `(0,0)`), so a "shape" is offset by half its default size to center it
 * under the click; "text" is left at the click point directly —
 * `text.ts`'s GlyphRuns are also top-left anchored, so this matches a
 * text-tool's usual "click = insertion point" behavior rather than needing
 * to evaluate the (not-yet-existing) node to find its center.
 *
 * Extracted as a standalone function (rather than inlined in the
 * `handleCanvasClick` callback below) so it's testable without a real DOM —
 * `point` is already in comp space; the only DOM-dependent part
 * (`clientToLocal`/`getBoundingClientRect`) stays in the React callback.
 */
export function handleViewportClick(state: EditorState, registry: NodeKindRegistry, tree: RenderTree | null, point: Vec2): void {
  if (state.tool === "select") {
    const hit = tree ? hitTestTree(point, tree.nodes) : undefined;
    state.select(hit ? [hit.id as unknown as Id] : []);
    return;
  }

  const comp = activeComp(state);
  const kind = state.tool; // "text" | "shape" — narrowed by the check above
  const position =
    kind === "shape"
      ? { x: point.x - 100, y: point.y - 100, z: 0 } // center a default 200x200 shape (shape.ts's defaults) under the click
      : { x: point.x, y: point.y, z: 0 };
  const op = appendNodeOp(comp, registry, kind, { transform: { position, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } } });
  state.apply(op);
  const node = op.after as unknown as { id: Id };
  state.select([node.id]);
  state.setTool("select");
}

/**
 * Hosts the injected Renderer + transform gizmos (Deliverable 09 §9.1).
 *
 * "THE RENDER LOOP STAYS OUT OF REACT": a single RAF loop reads
 * (document, playhead) directly from the store via `store.getState()`,
 * advances the playhead when `playing`, computes `renderTreeAt(frame)` via
 * the Evaluator, splices in any live `<TransformGizmo>` drag preview, and
 * calls `renderer.render(tree)` + `renderer.setViewport(...)`. React only
 * re-renders this component on selection/zoom/canvas-size changes — never
 * per frame.
 */
export function Viewport() {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const rendererRef = useRef<Renderer | null>(null);
  const lastFpsRef = useRef<number | null>(null);
  const lastCompSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastViewportRef = useRef<FitTransform | null>(null);
  const treeRef = useRef<RenderTree | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const clickLayerRef = useRef<HTMLDivElement>(null);

  const [canvasSize, setCanvasSize] = useState<Size>(ZERO_SIZE);

  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const compSize = useEditorStore((s) => activeComp(s).size);
  const selectedNode = useEditorStore((s) => {
    if (s.selection.length !== 1) return undefined;
    return activeComp(s).root.find((n) => n.id === s.selection[0]);
  });

  const fit = computeFitTransform(compSize, canvasSize, zoom, 32, panX, panY);

  const createRenderer = useCallback((canvas: HTMLCanvasElement): Renderer => {
    const renderer = createWebGLRenderer(canvas, createMediaService(store));
    rendererRef.current = renderer;
    return renderer;
  }, [store]);

  const handleResize = useCallback((size: Size) => {
    setCanvasSize(size);
  }, []);

  const handlePreview = useCallback((preview: DragPreview | null) => {
    dragPreviewRef.current = preview;
  }, []);

  const lastClickRef = useRef<{ nodeId: string; time: number } | null>(null);

  const MAX_ZOOM_LIMIT = 8;
  const MIN_ZOOM_LIMIT = 0.1;

  /** Wheel handler — scroll to pan in any direction, Ctrl/Cmd+wheel to zoom toward cursor. */
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const state = store.getState();

      if (e.ctrlKey || e.metaKey) {
        // Zoom toward cursor so the point under the cursor stays fixed
        const rect = clickLayerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        const oldZoom = state.zoom;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(MAX_ZOOM_LIMIT, Math.max(MIN_ZOOM_LIMIT, oldZoom * delta));
        const zoomRatio = newZoom / oldZoom;

        const currentFit = computeFitTransform(
          activeComp(state).size, canvasSize, oldZoom, 32, state.panX, state.panY
        );
        const newScale = currentFit.scale * zoomRatio;
        const compX = (cursorX - currentFit.x) / currentFit.scale;
        const compY = (cursorY - currentFit.y) / currentFit.scale;
        const centerX = (canvasSize.width - activeComp(state).size.width * newScale) / 2;
        const centerY = (canvasSize.height - activeComp(state).size.height * newScale) / 2;
        const newPanX = cursorX - compX * newScale - centerX;
        const newPanY = cursorY - compY * newScale - centerY;

        state.setZoom(newZoom);
        state.setPan(newPanX, newPanY);
      } else {
        // Pan — any direction. deltaMode=1 (LINE) uses fixed 32px step.
        const multiplier = e.deltaMode === 1 ? 32 : 1;
        state.setPan(state.panX - e.deltaX * multiplier, state.panY - e.deltaY * multiplier);
      }
    },
    [store, canvasSize]
  );

  // Non-passive so preventDefault works (prevents browser page scroll).
  useEffect(() => {
    const el = clickLayerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // F key = fit/reset view; V/T/R/B = tool shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === "f" || e.key === "F") store.getState().resetView();
      if (e.key === "v" || e.key === "V") store.getState().setTool("select");
      if (e.key === "t" || e.key === "T") store.getState().setTool("text");
      if (e.key === "r" || e.key === "R") store.getState().setTool("shape");
      if (e.key === "b" || e.key === "B") store.getState().setTool("draw");
      if (e.key === "Escape" && store.getState().tool === "draw") store.getState().setTool("select");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const handleCanvasClick = useCallback(
    (e: React.PointerEvent) => {
      // If editor is open, any click on the canvas dismisses it
      if (editingNodeIdRef.current) {
        setEditing(null);
        return;
      }
      const rect = clickLayerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = screenToComp(clientToLocal(rect, e.clientX, e.clientY), fit);
      handleViewportClick(store.getState(), registry, treeRef.current, point);
    },
    [store, registry, fit]
  );

  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    let fractional = 0; // sub-frame accumulator — elapsed is fractional at 60fps (~0.5 frames/tick at 30fps); discarding it every tick via Math.trunc meant the playhead never advanced past 0 until a GC pause caused a single long tick.

    const tick = (now: number): void => {
      const comp = activeComp(store.getState());

      if (store.getState().playing) {
        if (last !== null) {
          const elapsed = ((now - last) / 1000) * comp.fps;
          fractional += elapsed;
          const advance = Math.trunc(fractional);
          if (advance >= 1) {
            fractional -= advance;
            const next = store.getState().playhead + advance;
            store.getState().setPlayhead(toFrame(next >= comp.duration ? 0 : next));
          }
        }
        last = now;
      } else {
        last = null;
        fractional = 0;
      }

      const renderer = rendererRef.current;
      if (renderer) {
        try {
          if (lastFpsRef.current !== comp.fps) {
            renderer.setFps(comp.fps);
            lastFpsRef.current = comp.fps;
          }

          // Update clip mask whenever comp dimensions change
          const lastSize = lastCompSizeRef.current;
          if (!lastSize || lastSize.width !== comp.size.width || lastSize.height !== comp.size.height) {
            renderer.setCompSize(comp.size.width, comp.size.height);
            lastCompSizeRef.current = comp.size;
          }

          const currentFit = computeFitTransform(comp.size, canvasSize, store.getState().zoom, 32, store.getState().panX, store.getState().panY);
          const lastFit = lastViewportRef.current;
          if (!lastFit || lastFit.scale !== currentFit.scale || lastFit.x !== currentFit.x || lastFit.y !== currentFit.y) {
            renderer.setViewport(currentFit.scale, currentFit.x, currentFit.y);
            lastViewportRef.current = currentFit;
          }

          const state = store.getState();
          let tree = renderTreeAt(state, state.playhead, registry);

          const preview = dragPreviewRef.current;
          if (preview) {
            tree = { ...tree, nodes: applyDragPreview(tree.nodes, preview) };
          }

          // Hide the node being edited — the RichTextEditor overlay replaces
          // it visually, so the underlying Pixi text must not also render.
          const editingId = editingNodeIdRef.current;
          if (editingId) {
            tree = {
              ...tree,
              nodes: tree.nodes.map((n) =>
                n.id === editingId ? { ...n, opacity: 0 } : n
              ),
            };
          }

          treeRef.current = tree;
          renderer.render(tree, state.playing);
        } catch (err) {
          // A single bad frame (e.g. a transiently-invalid composition
          // mid-edit) must not silently kill this RAF loop — without this,
          // `raf = requestAnimationFrame(tick)` below would never run again
          // and the canvas would stay frozen on whatever it last rendered,
          // while LayerPanel/InspectorPanel (plain React state reads, not
          // this loop) keep working — exactly "layer names exist but the
          // object isn't visible". Logging surfaces the actual cause; the
          // loop retries next frame once state settles.
          console.error("Viewport render error:", err);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [store, registry, canvasSize]);

  const tool = useEditorStore((s) => s.tool);
  const editingNodeIdRef = useRef<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [pathEditNodeId, setPathEditNodeId] = useState<string | null>(null);

  // Register so InspectorPanel's "Convert to path" button can open the overlay
  useEffect(() => {
    registerPathEditHandler((id) => setPathEditNodeId(id));
  }, []);
  // Dismiss path edit if the edited node is deselected
  const selectedIds = useEditorStore((s) => s.selection);
  useEffect(() => {
    if (pathEditNodeId && !selectedIds.includes(pathEditNodeId as never)) {
      setPathEditNodeId(null);
    }
  }, [selectedIds, pathEditNodeId]);
  const editorHandleRef = useRef<RichTextEditorHandle | null>(null);

  // Notify the module singleton after the RichTextEditor has mounted and
  // populated editorHandleRef — the ref is set synchronously during render
  // of RichTextEditor, so by the time this effect fires it's populated.
  useEffect(() => {
    if (editingNodeId) setActiveEditor(editingNodeId, editorHandleRef.current);
    else setActiveEditor(null, null);
  }, [editingNodeId]);

  function setEditing(id: string | null) {
    editingNodeIdRef.current = id;
    setEditingNodeId(id);
  }

  // Double-click a selected text node to enter inline editing mode



  return (
    <>
      <CanvasHost createRenderer={createRenderer} onResize={handleResize} />
      <ViewportFrame compSize={compSize} canvasSize={canvasSize} fit={fit} />
      <div
        ref={clickLayerRef}
        onPointerDown={handleCanvasClick}
        style={{
          position: "absolute",
          inset: 0,
          cursor: tool === "select" ? "default" : "crosshair",
        }}
      />
      {pathEditNodeId && (() => {
        const pNode = activeComp(store.getState()).root.find((n) => n.id === pathEditNodeId);
        if (!pNode || pNode.kind !== "shape") return null;
        const renderNode = treeRef.current?.nodes.find((n) => n.id === pathEditNodeId);
        const nodeMatrix = renderNode?.matrix ?? [1,0,0,0,1,0,0,0,1] as import("contract").Mat3;
        return (
          <PathEditOverlay
            node={pNode}
            fit={fit}
            canvasSize={canvasSize}
            nodeMatrix={nodeMatrix}
            onDismiss={() => setPathEditNodeId(null)}
          />
        );
      })()}
      {editingNodeId && (() => {
        const node = activeComp(store.getState()).root.find((n) => n.id === editingNodeId);
        if (!node || node.kind !== "text") return null;
        return (
          <RichTextEditor
            node={node}
            fit={fit}
            onDismiss={() => setEditing(null)}
            editorHandle={editorHandleRef}
          />
        );
      })()}
      {tool === "draw" && (
        <>
          <DrawOptionsBar />
          <DrawOverlay fit={fit} canvasSize={canvasSize} />
        </>
      )}
      {selectedNode && !selectedNode.locked && tool !== "mask" && !pathEditNodeId && (
        <TransformGizmo
          nodeId={selectedNode.id}
          selectedNode={selectedNode}
          fit={fit}
          canvasSize={canvasSize}
          treeRef={treeRef}
          onPreview={handlePreview}
          onDoubleClick={
            selectedNode.kind === "text"
              ? () => setEditing(String(selectedNode.id))
              : selectedNode.kind === "shape" &&
                (selectedNode.props.shape as string) === "polygon" &&
                Array.isArray(selectedNode.props.pathPoints) &&
                (selectedNode.props.pathPoints as unknown[]).length > 0
              ? () => setPathEditNodeId(String(selectedNode.id))
              : undefined
          }
        />
      )}
      {tool === "mask" && selectedNode && (() => {
        const tree = treeRef.current;
        const renderNode = tree?.nodes.find((n) => n.id === selectedNode.id);
        const nodeMatrix = renderNode?.matrix ?? [1,0,0,0,1,0,0,0,1] as import("contract").Mat3;
        return (
          <MaskPenOverlay
            nodeId={selectedNode.id}
            fit={fit}
            canvasSize={canvasSize}
            nodeMatrix={nodeMatrix}
          />
        );
      })()}
    </>
  );
}
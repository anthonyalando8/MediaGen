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
  const lastViewportRef = useRef<FitTransform | null>(null);
  const treeRef = useRef<RenderTree | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const clickLayerRef = useRef<HTMLDivElement>(null);

  const [canvasSize, setCanvasSize] = useState<Size>(ZERO_SIZE);

  const zoom = useEditorStore((s) => s.zoom);
  const compSize = useEditorStore((s) => activeComp(s).size);
  const selectedNode = useEditorStore((s) => {
    if (s.selection.length !== 1) return undefined;
    return activeComp(s).root.find((n) => n.id === s.selection[0]);
  });

  const fit = computeFitTransform(compSize, canvasSize, zoom);

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

  /** Thin DOM-coordinate wrapper around `handleViewportClick` (see its doc above). */
  const handleCanvasClick = useCallback(
    (e: React.PointerEvent) => {
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

    const tick = (now: number): void => {
      const comp = activeComp(store.getState());

      if (store.getState().playing) {
        if (last !== null) {
          const elapsed = ((now - last) / 1000) * comp.fps;
          const next = store.getState().playhead + elapsed;
          store.getState().setPlayhead(toFrame(next >= comp.duration ? 0 : next));
        }
        last = now;
      } else {
        last = null;
      }

      const renderer = rendererRef.current;
      if (renderer) {
        try {
          if (lastFpsRef.current !== comp.fps) {
            renderer.setFps(comp.fps);
            lastFpsRef.current = comp.fps;
          }

          const currentFit = computeFitTransform(comp.size, canvasSize, store.getState().zoom);
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

          treeRef.current = tree;
          renderer.render(tree);
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
      {selectedNode && !selectedNode.locked && (
        <TransformGizmo
          nodeId={selectedNode.id}
          selectedNode={selectedNode}
          fit={fit}
          canvasSize={canvasSize}
          treeRef={treeRef}
          onPreview={handlePreview}
        />
      )}
    </>
  );
}
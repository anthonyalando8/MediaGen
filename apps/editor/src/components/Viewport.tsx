// apps/editor/src/components/Viewport.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { mul, toFrame } from "core";
import type { Id } from "core";
import { createWebGLRenderer } from "renderer-webgl";
import type { MediaService, Renderer } from "renderer-webgl";
import type { RenderTree } from "contract";
import { CanvasHost } from "ui";
import { useRegistry } from "../bootstrap/registry-context";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp, renderTreeAt } from "../store/selectors";
import { computeFitTransform, type FitTransform, invertMat3, type Size } from "../viewport/geometry";
import { TransformGizmo } from "./TransformGizmo";
import type { DragPreview } from "./TransformGizmo";

/**
 * P1: no asset library UI yet — image/video nodes resolve to no texture
 * (TextureManager falls back to Texture.EMPTY). The add-media palette
 * (MediaPalette.tsx, Week 7) only lists `project.assets`, which stays empty
 * until upload/import lands. Replace with a MediaService built from
 * `project.assets` once that does.
 */
const NO_ASSETS: MediaService = {
  resolveAsset: () => undefined,
};

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

  const [canvasSize, setCanvasSize] = useState<Size>(ZERO_SIZE);

  const zoom = useEditorStore((s) => s.zoom);
  const compSize = useEditorStore((s) => activeComp(s).size);
  const selectedNode = useEditorStore((s) => {
    if (s.selection.length !== 1) return undefined;
    return activeComp(s).root.find((n) => n.id === s.selection[0]);
  });

  const fit = computeFitTransform(compSize, canvasSize, zoom);

  const createRenderer = useCallback((canvas: HTMLCanvasElement): Renderer => {
    const renderer = createWebGLRenderer(canvas, NO_ASSETS);
    rendererRef.current = renderer;
    return renderer;
  }, []);

  const handleResize = useCallback((size: Size) => {
    setCanvasSize(size);
  }, []);

  const handlePreview = useCallback((preview: DragPreview | null) => {
    dragPreviewRef.current = preview;
  }, []);

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

  return (
    <>
      <CanvasHost createRenderer={createRenderer} onResize={handleResize} />
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
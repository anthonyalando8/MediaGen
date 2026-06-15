// apps/editor/src/components/Viewport.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { toFrame } from "core";
import { createWebGLRenderer } from "renderer-webgl";
import type { MediaService, Renderer } from "renderer-webgl";
import type { RenderTree } from "contract";
import { CanvasHost } from "ui";
import { useRegistry } from "../bootstrap/registry-context";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp, renderTreeAt } from "../store/selectors";
import { computeFitTransform, type FitTransform, type Size } from "../viewport/geometry";
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
          tree = {
            ...tree,
            nodes: tree.nodes.map((n) => (n.id === preview.nodeId ? { ...n, matrix: preview.matrix } : n)),
          };
        }

        treeRef.current = tree;
        renderer.render(tree);
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
          selectedNode={selectedNode}
          nodeId={selectedNode.id}
          fit={fit}
          canvasSize={canvasSize}
          treeRef={treeRef}
          onPreview={handlePreview}
        />
      )}
    </>
  );
}
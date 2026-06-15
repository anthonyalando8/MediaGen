// packages/ui/src/canvas-host/CanvasHost.tsx
//
// "React wrapper, injects a Renderer" (Deliverable 04 folder tree).
// Owns the <canvas> element and its container's ResizeObserver — NOT the
// render loop. <Viewport> (apps/editor) drives `renderer.render(tree)` in a
// RAF loop, outside React (Deliverable 09: "the render loop stays out of
// React"); this component only handles mount/resize/teardown of the
// Renderer itself.

import { useEffect, useRef } from "react";
import type { Renderer } from "./renderer";

export interface CanvasHostProps {
  className?: string;
  /** Constructs the Renderer once the <canvas> element exists (e.g. `(canvas) => createWebGLRenderer(canvas, media)`). */
  createRenderer: (canvas: HTMLCanvasElement) => Renderer;
  /** Called once, immediately after `createRenderer` — e.g. to stash the instance for a RAF loop. */
  onReady?: (renderer: Renderer) => void;
  /** Called on every container resize, after `renderer.resize()` — e.g. so `<Viewport>` can recompute its fit transform for `<TransformGizmo>` (Week 7). */
  onResize?: (size: { width: number; height: number }) => void;
}

export function CanvasHost({ className, createRenderer, onReady, onResize }: CanvasHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // createRenderer/onReady/onResize are expected to be stable for the
  // component's lifetime (wrap in useCallback at the call site) — read via
  // refs so this effect's dependency array can stay empty without lint
  // complaints, and so a parent re-render never tears down/recreates the GPU
  // context.
  const createRendererRef = useRef(createRenderer);
  createRendererRef.current = createRenderer;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = createRendererRef.current(canvas);
    onReadyRef.current?.(renderer);

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        renderer.resize(w, h, dpr);
        onResizeRef.current?.({ width: w, height: h });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      renderer.destroy();
    };
  }, []);

  return (
    <div ref={containerRef} className={className} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
// packages/ui/src/canvas-host/CanvasHost.tsx
//
// "React wrapper, injects a Renderer" (Deliverable 04 folder tree).
// Owns the <canvas> element and its container's ResizeObserver — NOT the
// render loop. <Viewport> (apps/editor) drives `renderer.render(tree)` in a
// RAF loop, outside React (Deliverable 09: "the render loop stays out of
// React"); this component only handles mount/resize/teardown of the
// Renderer itself.
//
// CONTEXT LOSS RECOVERY
// ----------------------
// A WebGL context can be lost at any time — a genuine GPU driver crash
// (observed: Windows DXGI_ERROR_DEVICE_REMOVED under sustained load from a
// client-side export on weaker/integrated GPUs), the browser reclaiming
// memory under pressure, or a user switching GPUs. Before this, nothing
// here listened for it: once lost, the RAF loop in Viewport.tsx kept
// calling `render()` against a dead context forever, producing a stream of
// null-reference crashes deep in Pixi's internals (BatcherPipe,
// FilterSystem, etc.) with no way to recover short of a full page reload.
//
// `webglcontextlost`/`webglcontextrestored` are the browser's own recovery
// protocol for this — used here ONLY for a genuine, ORGANIC loss (the
// browser/driver killing the context out from under us). This is
// deliberately NOT used to service the `active`/pause mechanism below —
// see that section for why.
//
// `active` (PAUSE DURING EXPORT) — WHY THIS UNMOUNTS THE CANVAS, NOT JUST
// THE RENDERER
// -------------------------------------------------------------------------
// A first version of this tried to free GPU memory during export by
// calling `renderer.destroy()` on the SAME persistent <canvas> element and
// later calling `createRenderer(canvas)` again on it to "resume". This is
// fundamentally broken: per the HTML Canvas spec, once a context of a given
// type has been bound to a canvas element, EVERY future `getContext()` call
// on that SAME element returns that SAME context object — even after it's
// been explicitly lost via `WEBGL_lose_context.loseContext()` (which is
// exactly what Pixi's `destroy()` does internally). There is no way to get
// a genuinely fresh, working context back on that element short of the
// browser's own `webglcontextrestored` firing — and that's only reliable
// for an ORGANIC loss the browser itself decided to trigger, not one the
// page requested on purpose. Worse, calling `destroy()` ourselves ALSO
// fires a real `webglcontextlost` DOM event on that canvas, which the
// GENUINE crash-recovery listener above also reacts to — so pausing for
// export was ALSO triggering a second, competing "crash recovery" rebuild
// attempt at the same time, racing our own resume logic. Net effect: the
// viewport never came back after an export, and the page could hang.
//
// The fix: `active` controls whether the <canvas> element exists in the
// DOM AT ALL (conditional render below), not whether an existing canvas's
// renderer is destroyed in place. Going from `active=true` to `false`
// unmounts the canvas — a normal React unmount, which runs this effect's
// cleanup (destroys the renderer, frees the GPU context) via the ordinary
// dependency-array mechanism, no manual bookkeeping needed. Going back to
// `active=true` mounts a BRAND NEW <canvas> DOM element that has never had
// any context bound to it — so `createRenderer` gets a completely fresh,
// uncorrupted context, sidestepping the same-element trap entirely.

import { useEffect, useRef } from "react";
import type { Renderer } from "./renderer";

export interface CanvasHostProps {
  className?: string;
  /** Constructs the Renderer once the <canvas> element exists (e.g. `(canvas) => createWebGLRenderer(canvas, media)`). Called again automatically on context-loss recovery and whenever `active` remounts a fresh canvas. */
  createRenderer: (canvas: HTMLCanvasElement) => Renderer;
  /** Called after `createRenderer` — on initial mount, after a context-loss recovery rebuild, and after `active` remounts a fresh canvas — so the caller can update whatever reference it holds to the Renderer instance. */
  onReady?: (renderer: Renderer) => void;
  /** Called on every container resize, after `renderer.resize()` — e.g. so `<Viewport>` can recompute its fit transform for `<TransformGizmo>` (Week 7). */
  onResize?: (size: { width: number; height: number }) => void;
  /** Called when the WebGL context is lost (a genuine organic loss — see this file's module doc), before the automatic in-place rebuild starts. Not fired by `active` transitions. */
  onContextLost?: () => void;
  /** Called once a rebuild completes and rendering can resume — fires both after organic context-loss recovery AND after `active` remounts a fresh canvas. */
  onContextRestored?: () => void;
  /**
   * When false, unmounts the <canvas> element entirely, freeing its GPU
   * context and every cached texture. Set this false during a client
   * export (see this file's module doc) to avoid two live WebGL contexts
   * competing for GPU memory at once. Default true.
   */
  active?: boolean;
}

export function CanvasHost({ className, createRenderer, onReady, onResize, onContextLost, onContextRestored, active = true }: CanvasHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // createRenderer/onReady/onResize are expected to be stable for the
  // component's lifetime (wrap in useCallback at the call site) — read via
  // refs so this effect's dependency array can stay free of them without
  // lint complaints, and so a parent re-render never tears down/recreates
  // the GPU context on its own.
  const createRendererRef = useRef(createRenderer);
  createRendererRef.current = createRenderer;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onContextLostRef = useRef(onContextLost);
  onContextLostRef.current = onContextLost;
  const onContextRestoredRef = useRef(onContextRestored);
  onContextRestoredRef.current = onContextRestored;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    // `active === false` means the conditional render below didn't mount a
    // <canvas> at all this cycle — nothing to do; the PREVIOUS cycle's
    // cleanup (below) already destroyed whatever renderer existed before.
    if (!canvas || !container) return;

    // Mutable, not a plain const: rebuilt in place on a genuine organic
    // context-loss recovery, so the resize observer below (registered
    // once per mount) always resizes whichever renderer instance is
    // CURRENTLY alive.
    let renderer: Renderer | null = createRendererRef.current(canvas);
    onReadyRef.current?.(renderer);

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    function currentSize(): { width: number; height: number } {
      const rect = container!.getBoundingClientRect();
      return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        renderer?.resize(w, h, dpr);
        onResizeRef.current?.({ width: w, height: h });
      }
    });
    observer.observe(container);

    function destroyCurrent(): void {
      if (!renderer) return;
      try {
        renderer.destroy();
      } catch {
        // Context may already be dead (e.g. mid context-loss) — destroy()
        // can itself throw trying to talk to it. Nothing more to do.
      }
      renderer = null;
    }

    // GENUINE ORGANIC CONTEXT LOSS ONLY (see module doc — `active`
    // transitions are handled entirely by conditional mounting below, not
    // through this path). `preventDefault()` is REQUIRED for the browser to
    // even attempt to later fire "webglcontextrestored" at all.
    //
    // FALLBACK: "webglcontextrestored" is only reliably fired for an
    // ordinary reclaimed context. A genuine GPU *process* crash (observed:
    // Windows DXGI_ERROR_DEVICE_REMOVED) can leave the browser never firing
    // it at all, even once the GPU process itself has recovered — so this
    // also just tries rebuilding unconditionally after a short delay if
    // restore hasn't already happened by then.
    let restored = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    function attemptRebuild(): void {
      if (restored) return;
      restored = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      renderer = createRendererRef.current(canvas!);
      onReadyRef.current?.(renderer);
      const { width, height } = currentSize();
      renderer.resize(width, height, dpr);
      onContextRestoredRef.current?.();
    }

    function handleContextLost(e: Event): void {
      e.preventDefault();
      restored = false;
      onContextLostRef.current?.();
      destroyCurrent();
      fallbackTimer = setTimeout(attemptRebuild, 3000);
    }

    function handleContextRestored(): void {
      attemptRebuild();
    }

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    return () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      observer.disconnect();
      destroyCurrent();
    };
    // Re-runs whenever `active` toggles: false -> the conditional render
    // below unmounts <canvas>, so `canvasRef.current` is null and this
    // effect's cleanup already ran, destroying the renderer. true -> a
    // FRESH <canvas> DOM element mounts (never previously bound to any
    // context), and this effect creates a brand new renderer on it.
  }, [active]);

  return (
    <div ref={containerRef} className={className} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {active && <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />}
    </div>
  );
}
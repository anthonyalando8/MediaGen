// packages/renderer-webgl/src/host/canvas-host.ts
//
// "Create/destroy Pixi Application, attach to a canvas, handle DPR + resize"
// (Deliverable 08).
//
// Pixi v8's `Application.init()` is async, while Deliverable 08's
// `createWebGLRenderer(canvas, media): Renderer` is a synchronous factory.
// `createCanvasHost` reconciles the two: `app.stage` (a plain Container) is
// available the instant this function returns — the SceneGraphAdapter can
// start reconciling into it immediately, even before the GPU context exists
// — while `resize()` calls made before `init()` resolves are queued and
// applied once it does. This is a deliberate Phase 1 deviation worth an ADR
// entry: the literal Deliverable 08 signature predates Pixi v8's async init.

import { Application, Container, Graphics } from "pixi.js";
import type { Renderer } from "pixi.js";

export interface CanvasHostOptions {
  width: number;
  height: number;
  /** Device pixel ratio at creation time. */
  dpr?: number;
  backgroundAlpha?: number;
  /** Composition size — used to set up the initial clip mask. */
  compWidth?: number;
  compHeight?: number;
}

export interface CanvasHost {
  /** Available immediately — add the scene graph's root container to this. */
  readonly stage: Container;
  /**
   * The real Pixi `Renderer` — `undefined` until `ready` resolves (Pixi
   * v8's async `Application.init()`, see this module's doc), `Renderer`
   * thereafter. Needed for "transitionGroup"'s two-texture mechanism
   * (scene-graph.ts's `renderToTexture`): a transition genuinely needs to
   * call `renderer.render({container, target})` to rasterize each side
   * independently before compositing, which a plain `Container` (the
   * `stage` field) can't do on its own — only the renderer itself can
   * execute a render pass. Before `ready` resolves, a transitionGroup
   * simply doesn't render that frame (same "degrade gracefully, never
   * throw" pattern `getIdentityProgram`/`getEffectProgram`
   * (pass-resolver.ts) already use for their own GL-context-dependent
   * construction).
   */
  readonly renderer: Renderer | undefined;
  /** Resolves once the GPU context is ready and the first resize has been applied. */
  readonly ready: Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  /** Sets the canvas clear color (RenderTree.background, packed 0xRRGGBB) and alpha. */
  setBackground(color: number, alpha: number): void;
  /**
   * Scales/positions `stage` so comp-space coordinates (Deliverable 09 §9.1,
   * Week 7: "<Viewport> ... transform gizmos") map to canvas pixels — the
   * same "contain, centered, zoom-scaled" transform `<TransformGizmo>`
   * computes for its own overlay (apps/editor/src/viewport/geometry.ts).
   * `stage` is a plain Container available immediately (Pixi v8 async-init
   * note above), so unlike resize/setBackground this never needs queueing.
   */
  setViewport(scale: number, x: number, y: number): void;
  /** Updates the rectangular clip mask to match the current composition dimensions. Call whenever comp size changes. */
  setCompSize(width: number, height: number): void;
  destroy(): void;
}

export function createCanvasHost(canvas: HTMLCanvasElement, options: CanvasHostOptions): CanvasHost {
  const app = new Application();
  let isReady = false;
  let pendingResize: { width: number; height: number; dpr: number } | null = null;
  let pendingBackground: { color: number; alpha: number } | null = null;

  // Clip mask — a Graphics rect in comp-local coordinates (0,0,compW,compH).
  // Since app.stage carries the viewport transform (scale + offset), the
  // mask in stage-local space is always (0,0,compW,compH) regardless of zoom.
  // This is the key: the mask travels with the stage transform, so content
  // outside the comp rect is clipped in screen space correctly at any zoom.
  const clipMask = new Graphics();
  let _compWidth = options.compWidth ?? 1080;
  let _compHeight = options.compHeight ?? 1920;

  function redrawClipMask(): void {
    clipMask.clear();
    clipMask.rect(0, 0, _compWidth, _compHeight).fill({ color: 0xffffff, alpha: 1 });
  }

  redrawClipMask();

  function applyResize(width: number, height: number, dpr: number): void {
    app.renderer.resolution = dpr;
    app.renderer.resize(width, height);
  }

  function applyBackground(color: number, alpha: number): void {
    app.renderer.background.color = color;
    app.renderer.background.alpha = alpha;
  }

  const ready = app
    .init({
      canvas,
      width: options.width,
      height: options.height,
      resolution: options.dpr ?? 1,
      autoDensity: true,
      antialias: true,
      backgroundAlpha: options.backgroundAlpha ?? 0,
    })
    .then(() => {
      isReady = true;
      // Apply clip mask after stage exists
      app.stage.addChild(clipMask);
      app.stage.mask = clipMask;
      if (pendingResize) {
        applyResize(pendingResize.width, pendingResize.height, pendingResize.dpr);
        pendingResize = null;
      }
      if (pendingBackground) {
        applyBackground(pendingBackground.color, pendingBackground.alpha);
        pendingBackground = null;
      }
    });

  return {
    stage: app.stage,
    get renderer() {
      return isReady ? app.renderer : undefined;
    },
    ready,
    resize(width, height, dpr) {
      if (!isReady) {
        pendingResize = { width, height, dpr };
        return;
      }
      applyResize(width, height, dpr);
    },
    setBackground(color, alpha) {
      if (!isReady) {
        pendingBackground = { color, alpha };
        return;
      }
      applyBackground(color, alpha);
    },
    setViewport(scale, x, y) {
      app.stage.scale.set(scale);
      app.stage.position.set(x, y);
    },
    setCompSize(width, height) {
      _compWidth = width;
      _compHeight = height;
      redrawClipMask();
    },
    destroy() {
      app.destroy(true, { children: true, texture: true });
    },
  };
}
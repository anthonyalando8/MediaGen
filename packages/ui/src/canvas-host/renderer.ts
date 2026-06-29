// packages/ui/src/canvas-host/renderer.ts
//
// Mirrors `renderer-webgl`'s public `Renderer` interface (Deliverable 08).
// `ui` never imports `renderer-webgl` — the app constructs a real renderer
// and injects it through `CanvasHostProps.createRenderer`.

import type { RenderTree } from "contract";

export interface Renderer {
  /**
   * Render the given tree at the given frame.
   * `frame` is used to compute `uTime = frame/fps` which is auto-injected
   * into every effect shader — overlay effects (rain, snow, sparkles etc.)
   * animate automatically without the user keyframing anything.
   */
  render(tree: RenderTree, playing?: boolean, frame?: number, wallTime?: number): void;
  resize(width: number, height: number, dpr: number): void;
  setFps(fps: number): void;
  setViewport(scale: number, x: number, y: number): void;
  /** Updates the clip mask to match the current composition dimensions. */
  setCompSize(width: number, height: number): void;
  destroy(): void;
}
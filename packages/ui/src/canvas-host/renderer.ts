// packages/ui/src/canvas-host/renderer.ts
//
// Mirrors `renderer-webgl`'s public `Renderer` interface (Deliverable 08:
// "mirror this interface in `ui` for injection"). `ui` never imports
// `renderer-webgl` (dep-cruiser: "ui-no-renderer-webgl") — the app
// (apps/editor) constructs a real renderer via
// `createWebGLRenderer(canvas, media)` and injects it through
// `CanvasHostProps.createRenderer`, which is structurally typed against this
// interface.

import type { RenderTree } from "contract";

export interface Renderer {
  render(tree: RenderTree): void;
  resize(width: number, height: number, dpr: number): void;
  setFps(fps: number): void;
  setViewport(scale: number, x: number, y: number): void;
  /** Updates the clip mask to match the current composition dimensions. */
  setCompSize(width: number, height: number): void;
  destroy(): void;
}
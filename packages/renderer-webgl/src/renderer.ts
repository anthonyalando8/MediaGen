// packages/renderer-webgl/src/renderer.ts
//
// "Public API: render(tree), resize(), destroy(). Stateless between frames."
// (Deliverable 08).

import type { RenderTree } from "contract";
import { oklchToHex } from "./color";
import { createCanvasHost } from "./host/canvas-host";
import { SceneGraphAdapter } from "./adapter/scene-graph";
import { TextureManager } from "./textures/manager";
import type { MediaService } from "./textures/manager";

/**
 * Mirror this interface in `ui` for injection (Deliverable 08).
 *
 * ADDITIVE EXTENSION beyond the literal Deliverable 08 signature —
 * `setFps(fps)`: `RenderTree` (Deliverable 05.5) doesn't carry the
 * composition's fps, but the TextureManager needs it to convert a video
 * RenderNode's `tex.frame` into a seek time (`frame / fps`). The editor
 * calls `renderer.setFps(activeComp.fps)` once whenever the active
 * composition changes (Tier 2 derived state, Deliverable 09) — not every
 * frame. Defaults to 30 if never called. Worth folding `fps` into
 * `RenderTree` itself in a P1.5 ADR alongside the image/video "fit" box gap
 * (see scene-graph.ts).
 */
export interface Renderer {
  render(tree: RenderTree, playing?: boolean): void;
  resize(width: number, height: number, dpr: number): void;
  setFps(fps: number): void;
  /** See CanvasHost.setViewport — maps comp-space coordinates to canvas pixels for `<TransformGizmo>` (Week 7). */
  setViewport(scale: number, x: number, y: number): void;
  destroy(): void;
}

export function createWebGLRenderer(canvas: HTMLCanvasElement, media: MediaService): Renderer {
  const textures = new TextureManager(media);
  const host = createCanvasHost(canvas, {
    width: canvas.width || 1,
    height: canvas.height || 1,
    dpr: typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1,
  });
  const adapter = new SceneGraphAdapter(textures, () => host.renderer);
  host.stage.addChild(adapter.root);

  return {
    render(tree, playing = false) {
      adapter.reconcile(tree, playing);
      if (tree.background) {
        host.setBackground(oklchToHex(tree.background), tree.background.alpha ?? 1);
      }
    },
    resize(width, height, dpr) {
      host.resize(width, height, dpr);
    },
    setFps(fps) {
      adapter.setFps(fps);
    },
    setViewport(scale, x, y) {
      host.setViewport(scale, x, y);
    },
    destroy() {
      adapter.destroy();
      textures.destroy();
      host.destroy();
    },
  };
}
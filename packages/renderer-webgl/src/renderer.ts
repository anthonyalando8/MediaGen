// packages/renderer-webgl/src/renderer.ts
//
// "Public API: render(tree), resize(), destroy(). Stateless between frames."
// (Deliverable 08).

import type { RenderTree } from "contract";
import { oklchToHex } from "./color";
import { createCanvasHost } from "./host/canvas-host";
import { SceneGraphAdapter } from "./adapter/scene-graph";
import { TextureManager } from "./textures/manager";
import { setTimeContext } from "./passes/pass-resolver";
import type { MediaService } from "./textures/manager";

export interface Renderer {
  render(tree: RenderTree, playing?: boolean, frame?: number, wallTime?: number): void;
  resize(width: number, height: number, dpr: number): void;
  setFps(fps: number): void;
  setViewport(scale: number, x: number, y: number): void;
  setCompSize(width: number, height: number): void;
  destroy(): void;
}

export function createWebGLRenderer(canvas: HTMLCanvasElement, media: MediaService): Renderer {
  const textures = new TextureManager(media);
  const host = createCanvasHost(canvas, {
    width: canvas.width || 1,
    height: canvas.height || 1,
  });

  const adapter = new SceneGraphAdapter(textures, () => host.renderer);
  host.stage.addChild(adapter.root);

  // Track fps locally so renderer.ts doesn't need a public getter on the adapter
  let currentFps = 30;

  return {
    render(tree, playing = false, frame = 0, wallTime?: number) {
      const treeWithFrame: RenderTree = { ...tree, frame };

      // uTime for overlay effects uses wall-clock time so they animate
      // continuously regardless of whether the composition is playing.
      // When wallTime is not supplied (e.g. headless render), fall back to
      // frame/fps — a reasonable approximation for export contexts.
      const timeForOverlays = wallTime ?? (frame / currentFps);
      setTimeContext({ frame, fps: currentFps, wallTime: timeForOverlays });

      adapter.reconcile(treeWithFrame, playing);
      if (tree.background) {
        host.setBackground(oklchToHex(tree.background), tree.background.alpha ?? 1);
      }
      host.renderFrame();
    },
    resize(width, height, dpr) {
      host.resize(width, height, dpr);
    },
    setFps(fps) {
      currentFps = fps;
      adapter.setFps(fps);
    },
    setViewport(scale, x, y) {
      host.setViewport(scale, x, y);
    },
    setCompSize(width, height) {
      host.setCompSize(width, height);
    },
    destroy() {
      adapter.destroy();
      host.destroy();
    },
  };
}
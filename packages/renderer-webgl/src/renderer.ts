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

export interface Renderer {
  render(tree: RenderTree, playing?: boolean): void;
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

  return {
    render(tree, playing = false) {
      // STEP 1: reconcile — updates the scene graph AND sets filter.padding
      //         on all effectGroup filters for the current frame.
      adapter.reconcile(tree, playing);
      if (tree.background) {
        host.setBackground(oklchToHex(tree.background), tree.background.alpha ?? 1);
      }
      // STEP 2: draw — Pixi reads filter.padding during this call.
      // Because Pixi's own ticker is disabled (autoStart: false in canvas-host),
      // this is the ONLY place pixels get drawn. Guarantees reconcile (which
      // sets filter.padding) always precedes the GPU draw call, fixing the
      // "effects only cover part of the image until viewport resize" bug.
      host.renderFrame();
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
    setCompSize(width, height) {
      host.setCompSize(width, height);
    },
    destroy() {
      adapter.destroy();
      host.destroy();
    },
  };
}
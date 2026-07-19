// packages/renderer-webgl/src/renderer.ts
//
// "Public API: render(tree), resize(), destroy(). Stateless between frames."
// (Deliverable 08).

import type { RenderTree, RenderNode } from "contract";
import { oklchToHex } from "./color";
import { createCanvasHost } from "./host/canvas-host";
import { SceneGraphAdapter } from "./adapter/scene-graph";
import { TextureManager } from "./textures/manager";
import { setTimeContext } from "./passes/pass-resolver";
import type { MediaService } from "./textures/manager";

export interface Renderer {
  render(tree: RenderTree, playing?: boolean, frame?: number, wallTime?: number): void;
  /**
   * Awaits every image/video texture referenced by `tree` being loaded
   * and, for video, seeked to the EXACT frame requested — before this
   * resolves, `render()` may draw stale or blank textures (see
   * `TextureManager.prepare()`'s doc for why). Live playback (Viewport.tsx's
   * RAF loop) doesn't need this — it just calls `render()` continuously and
   * catches up naturally. A client export (`packages/export`), which
   * renders exactly once per output frame with no further chances to catch
   * up, MUST call and await this before each `render()` call for the same
   * frame.
   */
  prepareFrame(tree: RenderTree, fps: number): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  setFps(fps: number): void;
  setViewport(scale: number, x: number, y: number): void;
  setCompSize(width: number, height: number): void;
  destroy(): void;
}

/** Recursively collects every `TexRef` referenced by an "image"/"video" node in `nodes`, descending into "group"/"effectGroup" children (contract's RenderNode union — see render-node.ts). */
function collectTexRefs(nodes: RenderNode[]): { assetId: string; frame?: number }[] {
  const refs: { assetId: string; frame?: number }[] = [];
  for (const node of nodes) {
    if (node.t === "image" || node.t === "video") refs.push(node.tex);
    if ("children" in node) refs.push(...collectTexRefs(node.children));
  }
  return refs;
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
    async prepareFrame(tree, fps) {
      const refs = collectTexRefs(tree.nodes);
      // Sequential, NOT Promise.all: multiple refs can point at the SAME
      // video asset (one asset placed in two clips at different frames within
      // this one output frame), and prepare() drives that asset's single
      // shared <video> element's `currentTime`. Firing those seeks
      // concurrently races them against each other, leaving the element on an
      // indeterminate frame. Awaiting one at a time serializes the seeks; the
      // cost is trivial (a handful of refs per frame) and it's the only way
      // to guarantee each asset ends parked on the frame that's actually
      // sampled during render(). Distinct assets don't contend, so the little
      // parallelism lost here is on cheap already-loaded lookups anyway.
      for (const ref of refs) {
        await textures.prepare(ref, fps);
      }
    },
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
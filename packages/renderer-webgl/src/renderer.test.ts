// packages/renderer-webgl/src/renderer.test.ts
//
// Tests `collectTexRefs` in isolation — a pure function, no Pixi/canvas
// involved, so it's testable without the DOM-touching machinery
// `createWebGLRenderer` itself needs (Pixi's browser-detection code throws
// on `navigator` in a plain Node test environment).
//
// The "transitionGroup" case exists because of a real bug: unlike "group"/
// "effectGroup" (a `children: RenderNode[]` array), "transitionGroup" holds
// its content in two SINGLE `RenderNode` fields (`from`/`to`) — the
// recursion previously only checked `"children" in node`, so any image/
// video inside either side of a transition was silently never included in
// `prepareFrame()`'s awaited load/seek pass. Live preview never surfaced
// this (continuous re-render papers over a fire-and-forget load); export
// captures one frame with no chance to catch up, so a transition's video/
// image side showed as a hard cut or an uninitialized-texture flash instead
// of a proper cross-fade.

import { describe, expect, it } from "vitest";
import { collectTexRefs } from "./renderer";
import type { RenderNode } from "contract";

const COMMON = { id: "n", matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number], opacity: 1, blend: "normal" as const };

function imageNode(id: string, assetId: string): RenderNode {
  return { ...COMMON, id, t: "image", tex: { assetId }, fit: "cover", box: { x: 0, y: 0, width: 1, height: 1 } };
}

function videoNode(id: string, assetId: string, frame: number): RenderNode {
  return { ...COMMON, id, t: "video", tex: { assetId, frame }, fit: "cover", box: { x: 0, y: 0, width: 1, height: 1 } };
}

describe("collectTexRefs", () => {
  it("collects image/video refs from a flat list", () => {
    const refs = collectTexRefs([imageNode("a", "img1"), videoNode("b", "vid1", 5)]);
    expect(refs).toEqual([{ assetId: "img1" }, { assetId: "vid1", frame: 5 }]);
  });

  it("descends into group/effectGroup children", () => {
    const group: RenderNode = { ...COMMON, id: "g", t: "group", children: [imageNode("a", "img1")] };
    const effectGroup: RenderNode = { ...COMMON, id: "e", t: "effectGroup", children: [videoNode("b", "vid1", 3)], passes: [], isolate: true };
    expect(collectTexRefs([group, effectGroup])).toEqual([{ assetId: "img1" }, { assetId: "vid1", frame: 3 }]);
  });

  it("descends into a transitionGroup's from AND to sides — the bug this test guards against", () => {
    const transitionGroup: RenderNode = {
      ...COMMON,
      id: "t",
      t: "transitionGroup",
      from: videoNode("from-node", "sceneA-video", 100),
      to: videoNode("to-node", "sceneB-video", 0),
      ref: "wipe",
      uniforms: {},
      progress: 0.5,
    };

    const refs = collectTexRefs([transitionGroup]);

    // Both sides must be present — missing either one is exactly what left
    // an in-transition video/image uninitialized for export (a hard cut or
    // an uninitialized-texture flash instead of a cross-fade).
    expect(refs).toEqual([
      { assetId: "sceneA-video", frame: 100 },
      { assetId: "sceneB-video", frame: 0 },
    ]);
  });

  it("descends into media nested arbitrarily deep inside a transitionGroup's from/to (group/effectGroup within them)", () => {
    const transitionGroup: RenderNode = {
      ...COMMON,
      id: "t",
      t: "transitionGroup",
      from: { ...COMMON, id: "from-group", t: "group", children: [imageNode("a", "img-in-from")] },
      to: { ...COMMON, id: "to-effect", t: "effectGroup", children: [videoNode("b", "vid-in-to", 0)], passes: [], isolate: false },
      ref: "dip",
      uniforms: {},
      progress: 0.2,
    };

    expect(collectTexRefs([transitionGroup])).toEqual([{ assetId: "img-in-from" }, { assetId: "vid-in-to", frame: 0 }]);
  });
});

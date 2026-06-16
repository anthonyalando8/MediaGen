// packages/renderer-webgl/src/adapter/scene-graph.test.ts
import { describe, expect, it } from "vitest";
import { Container, Graphics, Sprite, Text, Texture, TextureSource } from "pixi.js";
import type { RenderNode, RenderTree } from "contract";
import { SceneGraphAdapter } from "./scene-graph";
import { TextureManager } from "../textures/manager";
import type { MediaAssetRef, TextureSource as MediaTextureSource } from "media";

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A TextureManager wired to fakes — avoids fetch/document/createImageBitmap
 * (media's real loadTexture needs a browser), and never throws on unknown
 * assets, so reconcile() never produces unhandled promise rejections.
 */
function makeTextureManager(): TextureManager {
  const fakeAsset: MediaAssetRef = { id: "asset1", kind: "image", url: "blob:fake" };
  const fakeSource: MediaTextureSource = {
    kind: "image",
    assetId: "asset1",
    width: 10,
    height: 10,
    bitmap: {} as unknown as ImageBitmap,
    dispose: () => {},
  };
  return new TextureManager(
    { resolveAsset: () => fakeAsset },
    {
      loadTexture: async () => fakeSource,
      createTexture: () => new Texture({ source: new TextureSource({ width: 10, height: 10 }) }),
    }
  );
}

function tree(nodes: RenderNode[]): RenderTree {
  return { size: { width: 1080, height: 1920 }, nodes };
}

describe("SceneGraphAdapter", () => {
  it("creates Sprite/Container/Graphics for image/text/shape and skips group", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());

    const groupNode: RenderNode = { id: "g", matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "group", children: [] };
    const imageNode: RenderNode = {
      id: "img",
      matrix: [1, 0, 50, 0, 1, 60, 0, 0, 1],
      opacity: 0.5,
      blend: "multiply",
      t: "image",
      tex: { assetId: "asset1" },
      fit: "contain",
      box: { x: 0, y: 0, width: 100, height: 100 },
    };
    const textNode: RenderNode = {
      id: "txt",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "text",
      runs: [
        { text: "Hello", x: 0, y: 0, fontFamily: "Inter", fontSize: 64, weight: 400, color: { l: 1, c: 0, h: 0 } },
        { text: "World", x: 0, y: 76.8, fontFamily: "Inter", fontSize: 64, weight: 400, color: { l: 1, c: 0, h: 0 } },
      ],
    };
    const shapeNode: RenderNode = {
      id: "shp",
      matrix: [2, 0, 10, 0, 2, 20, 0, 0, 1],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 100, height: 50, radius: 4 },
      fill: { l: 0.6, c: 0.15, h: 250 },
      stroke: { color: { l: 0, c: 0, h: 0 }, width: 2 },
    };

    adapter.reconcile(tree([groupNode, imageNode, textNode, shapeNode]));

    // group contributes nothing visually.
    expect(adapter.root.children).toHaveLength(3);

    const [img, txt, shp] = adapter.root.children;
    // image is now a Container wrapping one child Sprite (createDisplay's
    // doc) — NOT a bare Sprite — so the outer Container can carry
    // `node.matrix` (asserted below) independently of the inner Sprite's
    // own box-fit position/scale (see the "fit" test further down).
    expect(img).toBeInstanceOf(Container);
    expect(img).not.toBeInstanceOf(Sprite);
    expect((img as Container).children[0]).toBeInstanceOf(Sprite);
    expect(txt).toBeInstanceOf(Container);
    expect(txt).not.toBeInstanceOf(Sprite);
    expect(shp).toBeInstanceOf(Graphics);

    // matrix -> position/scale (image: tx=50,ty=60, no scale; shape: scale 2, pos 10,20)
    expect(img.position.x).toBe(50);
    expect(img.position.y).toBe(60);
    expect(shp.position.x).toBe(10);
    expect(shp.position.y).toBe(20);
    expect(shp.scale.x).toBe(2);
    expect(shp.scale.y).toBe(2);

    // opacity/blend stamped from the RenderNode.
    expect(img.alpha).toBe(0.5);
    expect(img.blendMode).toBe("multiply");
    expect(shp.alpha).toBe(1);
    expect(shp.blendMode).toBe("normal");

    // text: one PIXI.Text per GlyphRun.
    expect(txt.children).toHaveLength(2);
    const [run1, run2] = txt.children as Text[];
    expect(run1.text).toBe("Hello");
    expect(run1.position.x).toBe(0);
    expect(run1.position.y).toBe(0);
    expect(run1.style.fontFamily).toBe("Inter");
    expect(run1.style.fontSize).toBe(64);
    expect(run2.text).toBe("World");
    expect(run2.position.y).toBe(76.8);

    // shape: rect geometry was drawn (fill + stroke = 2 instructions).
    // getLocalBounds() pads by half the stroke width on each side (2px stroke -> +1).
    const graphics = shp as Graphics;
    expect(graphics.context.instructions.length).toBeGreaterThan(0);
    expect(graphics.getLocalBounds().maxX).toBe(101);
    expect(graphics.getLocalBounds().maxY).toBe(51);
  });

  it("reuses display objects for unchanged ids and removes stale ones (keyed diff)", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const shapeA: RenderNode = {
      id: "a",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    };
    const shapeB: RenderNode = { ...shapeA, id: "b" };
    const shapeC: RenderNode = { ...shapeA, id: "c" };

    adapter.reconcile(tree([shapeA, shapeB]));
    const [displayA, displayB] = adapter.root.children;
    expect(adapter.root.children).toHaveLength(2);

    adapter.reconcile(tree([shapeB, shapeC]));
    expect(adapter.root.children).toHaveLength(2);
    expect(adapter.root.children).toContain(displayB); // reused, same instance
    expect(adapter.root.children).not.toContain(displayA);
    expect(displayA.destroyed).toBe(true);
  });

  it("recreates the display object when a node's id changes kind", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const asShape: RenderNode = {
      id: "x",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    };
    const asText: RenderNode = {
      id: "x",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "text",
      runs: [{ text: "hi", x: 0, y: 0, fontFamily: "Inter", fontSize: 16, weight: 400, color: { l: 1, c: 0, h: 0 } }],
    };

    adapter.reconcile(tree([asShape]));
    const [first] = adapter.root.children;
    expect(first).toBeInstanceOf(Graphics);

    adapter.reconcile(tree([asText]));
    expect(first.destroyed).toBe(true);
    expect(adapter.root.children).toHaveLength(1);
    expect(adapter.root.children[0]).toBeInstanceOf(Container);
    expect(adapter.root.children[0]).not.toBeInstanceOf(Graphics);
  });

  it("destroy() releases every display object", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const shapeA: RenderNode = {
      id: "a",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    };
    adapter.reconcile(tree([shapeA]));
    const [display] = adapter.root.children;

    adapter.destroy();
    expect(adapter.root.children).toHaveLength(0);
    expect(display.destroyed).toBe(true);
  });

  it("draws ellipse and line geometry distinctly from rect", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const ellipse: RenderNode = {
      id: "e",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "ellipse", width: 40, height: 20 },
      fill: { l: 0.5, c: 0.1, h: 0 },
    };
    const line: RenderNode = {
      id: "l",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "line", length: 100 },
    };

    adapter.reconcile(tree([ellipse, line]));
    const [eDisplay, lDisplay] = adapter.root.children as Graphics[];

    const eBounds = eDisplay.getLocalBounds();
    expect(eBounds.maxX).toBeCloseTo(40);
    expect(eBounds.maxY).toBeCloseTo(20);

    const lBounds = lDisplay.getLocalBounds();
    // a line with no stroke specified still gets a fallback 1px stroke,
    // which pads getLocalBounds() by half the stroke width (0.5) per side.
    expect(lBounds.maxX).toBeCloseTo(100.5);
    expect(lDisplay.context.instructions.length).toBeGreaterThan(0);
  });

  it("re-rasterizes text at a resolution covering the node's scale, capped at MAX_TEXT_RESOLUTION", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());

    function textNode(matrix: number[]): RenderNode {
      return {
        id: "txt",
        matrix: matrix as RenderNode["matrix"],
        opacity: 1,
        blend: "normal",
        t: "text",
        runs: [{ text: "hi", x: 0, y: 0, fontFamily: "Inter", fontSize: 64, weight: 400, color: { l: 1, c: 0, h: 0 } }],
      };
    }

    // scale = 1 (identity) -> resolution stays at the dpr floor (1 in this headless test env).
    adapter.reconcile(tree([textNode([...IDENTITY])]));
    const container = adapter.root.children[0] as Container;
    const text = container.children[0] as Text;
    expect(text.resolution).toBeCloseTo(1);

    // scale = 6 -> resolution follows the scale (still under the cap).
    adapter.reconcile(tree([textNode([6, 0, 0, 0, 6, 0, 0, 0, 1])]));
    expect(text.resolution).toBeCloseTo(6);

    // scale = 20 -> resolution is capped at MAX_TEXT_RESOLUTION (8), not 20.
    adapter.reconcile(tree([textNode([20, 0, 0, 0, 20, 0, 0, 0, 1])]));
    expect(text.resolution).toBeCloseTo(8);
  });

  it("sizes/positions the inner sprite to node.box per fit, leaving the outer Container's own matrix-derived position untouched", async () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());

    function imageNode(fit: "cover" | "contain" | "fill", box: { x: number; y: number; width: number; height: number }): RenderNode {
      return {
        id: "img",
        matrix: [1, 0, 200, 0, 1, 300, 0, 0, 1], // outer position should stay (200, 300) regardless of fit
        opacity: 1,
        blend: "normal",
        t: "image",
        tex: { assetId: "asset1" },
        fit,
        box,
      };
    }

    // texture is 10x10 (makeTextureManager's fakeSource); needs one reconcile
    // to kick off the async load, then a flush + second reconcile to pick up
    // the resolved (non-EMPTY) texture — same pattern as manager.test.ts.
    adapter.reconcile(tree([imageNode("contain", { x: 0, y: 0, width: 100, height: 50 })]));
    await flush();
    adapter.reconcile(tree([imageNode("contain", { x: 0, y: 0, width: 100, height: 50 })]));

    const container = adapter.root.children[0] as Container;
    const sprite = container.children[0] as Sprite;

    // outer Container carries node.matrix's translation — untouched by fit.
    expect(container.position.x).toBe(200);
    expect(container.position.y).toBe(300);

    // contain: scale = min(100/10, 50/10) = 5 on both axes; centered in the box.
    expect(sprite.scale.x).toBeCloseTo(5);
    expect(sprite.scale.y).toBeCloseTo(5);
    expect(sprite.position.x).toBeCloseTo(50); // box center: 0 + 100/2
    expect(sprite.position.y).toBeCloseTo(25); // box center: 0 + 50/2

    // cover: scale = max(100/10, 50/10) = 10 on both axes.
    adapter.reconcile(tree([imageNode("cover", { x: 0, y: 0, width: 100, height: 50 })]));
    expect(sprite.scale.x).toBeCloseTo(10);
    expect(sprite.scale.y).toBeCloseTo(10);

    // fill: independent per-axis scale = (100/10, 50/10) = (10, 5).
    adapter.reconcile(tree([imageNode("fill", { x: 0, y: 0, width: 100, height: 50 })]));
    expect(sprite.scale.x).toBeCloseTo(10);
    expect(sprite.scale.y).toBeCloseTo(5);
  });
});
// packages/renderer-webgl/src/adapter/scene-graph.test.ts
import { describe, expect, it, vi } from "vitest";
import { Container, Graphics, Sprite, Text, Texture, TextureSource } from "pixi.js";
import type { Filter } from "pixi.js";
import type { PassSpec, RenderNode, RenderTree } from "contract";
import { SceneGraphAdapter } from "./scene-graph";
import { TextureManager } from "../textures/manager";
import * as passResolverModule from "../passes/pass-resolver";
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

describe("SceneGraphAdapter — effectGroup (Phase 2 §5, Week 1-2)", () => {
  function effectGroupNode(id: string, children: RenderNode[], passes: PassSpec[] = []): RenderNode {
    return { id, matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "effectGroup", children, passes, isolate: true };
  }

  it("is genuinely RECURSIVE, unlike 'group' — children render INSIDE the group's own Container, not flattened to root", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const child: RenderNode = {
      id: "child",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    };
    const group = effectGroupNode("grp", [child]);

    adapter.reconcile(tree([group]));

    // exactly one top-level display — the group's own Container — NOT two
    // (which "group" RenderNodes would have produced via flattening).
    expect(adapter.root.children).toHaveLength(1);
    const groupDisplay = adapter.root.children[0] as Container;
    expect(groupDisplay).toBeInstanceOf(Container);

    // the child is nested INSIDE the group's Container, not a root sibling.
    expect(groupDisplay.children).toHaveLength(1);
    expect(groupDisplay.children[0]).toBeInstanceOf(Graphics);
  });

  it("nested group renders to texture then composites — passes resolve via resolvePass and the result is assigned to the group's Container.filters (Week 1-2's exit test)", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const child: RenderNode = {
      id: "child",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    };
    const passSpec: PassSpec = { kind: "effect", ref: "identity", uniforms: {} };
    const group = effectGroupNode("grp", [child], [passSpec]);

    // A fake Filter stand-in — what THIS test verifies is the WIRING
    // (reconcileEffectGroup calls `resolvePass` once per `node.passes`
    // entry, in order, and assigns the flattened results to the real Pixi
    // Container's `filters`), not whether a REAL GlProgram compiles in
    // this headless Node test env (GlProgram probes shader precision via
    // an actual WebGL context — unavailable here, same class of issue
    // vitest.setup.ts documents for `navigator`; covered by
    // pass-resolver.test.ts instead, which only asserts resolvePass
    // degrades to `[]` rather than throwing in that case).
    const fakeFilter = {} as Filter;
    const spy = vi.spyOn(passResolverModule, "resolvePass").mockReturnValue([fakeFilter]);

    try {
      adapter.reconcile(tree([group]));

      expect(spy).toHaveBeenCalledWith(passSpec);
      const groupDisplay = adapter.root.children[0] as Container;
      // a non-empty `filters` array is exactly what makes Pixi render this
      // Container's subtree to a pooled texture FIRST, then composite that
      // texture back via the filter's shader (Filter.d.ts's documented
      // 5-step behavior) — i.e. genuine render-to-texture-then-composite,
      // not just nested Containers with no isolation.
      expect(groupDisplay.filters).toEqual([fakeFilter]);
    } finally {
      spy.mockRestore();
    }
  });

  it("an unrecognized pass ref is skipped (resolves to no Filter) rather than throwing", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const group = effectGroupNode("grp", [], [{ kind: "effect", ref: "not-implemented-yet", uniforms: {} }]);

    expect(() => adapter.reconcile(tree([group]))).not.toThrow();
    const groupDisplay = adapter.root.children[0] as Container;
    expect(groupDisplay.filters).toEqual([]);
  });

  it("an effectGroup with no passes has an empty filters array (no isolation cost when nothing needs it)", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const group = effectGroupNode("grp", []);

    adapter.reconcile(tree([group]));
    const groupDisplay = adapter.root.children[0] as Container;
    expect(groupDisplay.filters).toEqual([]);
  });

  it("keyed-diffs children WITHIN the group across reconciles — reuses unchanged ids, destroys stale ones, independent of any top-level node sharing the same id", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    function rect(id: string): RenderNode {
      return { id, matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "shape", geom: { kind: "rect", width: 10, height: 10, radius: 0 } };
    }

    // a child "a" inside the group, AND a top-level node also id "a" —
    // ids are only unique WITHIN a nesting level (EffectGroupState's doc).
    const topLevelA = rect("a");
    adapter.reconcile(tree([topLevelA, effectGroupNode("grp", [rect("a"), rect("b")])]));

    const groupDisplay1 = adapter.root.children[1] as Container;
    const [childA1, childB1] = groupDisplay1.children;
    expect(groupDisplay1.children).toHaveLength(2);

    // re-reconcile: child "b" -> "c" inside the group; child "a" unchanged.
    adapter.reconcile(tree([topLevelA, effectGroupNode("grp", [rect("a"), rect("c")])]));
    const groupDisplay2 = adapter.root.children[1] as Container;
    expect(groupDisplay2).toBe(groupDisplay1); // same group Container, reused
    expect(groupDisplay2.children).toHaveLength(2);
    expect(groupDisplay2.children).toContain(childA1); // reused, same instance
    expect(groupDisplay2.children).not.toContain(childB1);
    expect(childB1.destroyed).toBe(true);

    // the top-level "a" was never touched by the group's own diff.
    expect(adapter.root.children[0].destroyed).toBe(false);
  });

  it("destroying the group recursively tears down its nested children first", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const child: RenderNode = {
      id: "child",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    };
    adapter.reconcile(tree([effectGroupNode("grp", [child])]));
    const groupDisplay = adapter.root.children[0] as Container;
    const childDisplay = groupDisplay.children[0];

    adapter.destroy();

    expect(adapter.root.children).toHaveLength(0);
    expect(groupDisplay.destroyed).toBe(true);
    expect(childDisplay.destroyed).toBe(true);
  });

  it("removing the group node entirely (not just emptying its children) tears down nested state too", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const child: RenderNode = {
      id: "child",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    };
    adapter.reconcile(tree([effectGroupNode("grp", [child])]));
    const groupDisplay = adapter.root.children[0] as Container;
    const childDisplay = groupDisplay.children[0];

    adapter.reconcile(tree([])); // group node gone entirely

    expect(adapter.root.children).toHaveLength(0);
    expect(groupDisplay.destroyed).toBe(true);
    expect(childDisplay.destroyed).toBe(true);
  });

  it("nested effectGroups (a group inside a group) work recursively", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    const leaf: RenderNode = {
      id: "leaf",
      matrix: [...IDENTITY],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    };
    const inner = effectGroupNode("inner", [leaf]);
    const outer = effectGroupNode("outer", [inner]);

    adapter.reconcile(tree([outer]));

    const outerDisplay = adapter.root.children[0] as Container;
    expect(outerDisplay.children).toHaveLength(1);
    const innerDisplay = outerDisplay.children[0] as Container;
    expect(innerDisplay.children).toHaveLength(1);
    expect(innerDisplay.children[0]).toBeInstanceOf(Graphics);
  });

  describe("wrapper/child id collision (real bug: infinite recursion on teardown)", () => {
    // This is EXACTLY the shape core/evaluator/evaluate-node.ts produces
    // for a node with one enabled effect: the effectGroup wrapper takes
    // `id: node.id`, and its sole child (the node's own un-wrapped
    // RenderNode) ALSO carries that same id — by design, not a bug in the
    // evaluator. The renderer must tolerate this without crashing.
    function sameIdGroup(id: string): RenderNode {
      const child: RenderNode = { id, matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "shape", geom: { kind: "rect", width: 10, height: 10, radius: 0 } };
      return { id, matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "effectGroup", children: [child], passes: [], isolate: true };
    }

    it("reconciles without throwing when the wrapper and its child share the same id", () => {
      const adapter = new SceneGraphAdapter(makeTextureManager());
      expect(() => adapter.reconcile(tree([sameIdGroup("n1")]))).not.toThrow();

      const groupDisplay = adapter.root.children[0] as Container;
      expect(groupDisplay.children).toHaveLength(1);
      expect(groupDisplay.children[0]).toBeInstanceOf(Graphics);
    });

    it("removing the effectGroup entirely (e.g. the user disabled/removed the effect) tears down WITHOUT infinite recursion — the original crash", () => {
      const adapter = new SceneGraphAdapter(makeTextureManager());
      adapter.reconcile(tree([sameIdGroup("n1")]));
      const groupDisplay = adapter.root.children[0] as Container;
      const childDisplay = groupDisplay.children[0];

      // reconciling to a plain (unwrapped) shape with the SAME id — exactly
      // what happens when the user removes the node's last enabled effect
      // (evaluate-node.ts returns the bare RenderNode again, `id` unchanged).
      const plainShape: RenderNode = { id: "n1", matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "shape", geom: { kind: "rect", width: 10, height: 10, radius: 0 } };
      expect(() => adapter.reconcile(tree([plainShape]))).not.toThrow();

      expect(groupDisplay.destroyed).toBe(true);
      expect(childDisplay.destroyed).toBe(true);
      expect(adapter.root.children).toHaveLength(1);
      expect(adapter.root.children[0]).toBeInstanceOf(Graphics);
    });

    it("removing the node entirely also tears down without infinite recursion", () => {
      const adapter = new SceneGraphAdapter(makeTextureManager());
      adapter.reconcile(tree([sameIdGroup("n1")]));
      const groupDisplay = adapter.root.children[0] as Container;
      const childDisplay = groupDisplay.children[0];

      expect(() => adapter.reconcile(tree([]))).not.toThrow();

      expect(groupDisplay.destroyed).toBe(true);
      expect(childDisplay.destroyed).toBe(true);
      expect(adapter.root.children).toHaveLength(0);
    });

    it("destroy() (full adapter teardown) also tolerates the same-id collision without infinite recursion", () => {
      const adapter = new SceneGraphAdapter(makeTextureManager());
      adapter.reconcile(tree([sameIdGroup("n1")]));
      const groupDisplay = adapter.root.children[0] as Container;
      const childDisplay = groupDisplay.children[0];

      expect(() => adapter.destroy()).not.toThrow();

      expect(groupDisplay.destroyed).toBe(true);
      expect(childDisplay.destroyed).toBe(true);
    });

    it("toggling back and forth (wrapped -> plain -> wrapped again) across multiple reconciles never throws", () => {
      const adapter = new SceneGraphAdapter(makeTextureManager());
      const plainShape: RenderNode = { id: "n1", matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "shape", geom: { kind: "rect", width: 10, height: 10, radius: 0 } };

      expect(() => {
        adapter.reconcile(tree([sameIdGroup("n1")]));
        adapter.reconcile(tree([plainShape]));
        adapter.reconcile(tree([sameIdGroup("n1")]));
        adapter.reconcile(tree([plainShape]));
      }).not.toThrow();

      expect(adapter.root.children).toHaveLength(1);
      expect(adapter.root.children[0]).toBeInstanceOf(Graphics);
    });
  });
});

describe("SceneGraphAdapter — transitionGroup (Phase 2 §5/§13 acceptance test 08)", () => {
  function shapeNode(id: string): RenderNode {
    return { id, matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "shape", geom: { kind: "rect", width: 10, height: 10, radius: 0 } };
  }

  function transitionGroupNode(id: string, from: RenderNode, to: RenderNode, ref = "wipe-linear", progress = 0.5): RenderNode {
    return { id, matrix: [...IDENTITY], opacity: 1, blend: "normal", t: "transitionGroup", from, to, ref, uniforms: {}, progress };
  }

  it("creates a Container for the FROM side, keyed-diffs both FROM and TO subtrees, and never throws even with no Renderer available (headless test env — degrades to no filter that frame)", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager()); // no getRenderer passed -> always undefined
    const group = transitionGroupNode("t1", shapeNode("a"), shapeNode("b"));

    expect(() => adapter.reconcile(tree([group]))).not.toThrow();

    const display = adapter.root.children[0] as Container;
    expect(display).toBeInstanceOf(Container);
    // FROM side's keyed-diff result IS this display's own child:
    expect(display.children).toHaveLength(1);
    expect(display.children[0]).toBeInstanceOf(Graphics);
    // no renderer available -> no filter applied this frame, but nothing thrown:
    expect(display.filters).toEqual([]);
  });

  it("with a real (mocked) Renderer available, calls renderer.render({container, target}) to rasterize the TO side into a RenderTexture, then applies a transition Filter to the FROM side", () => {
    const renderSpy = vi.fn();
    const fakeRenderer = { render: renderSpy } as unknown as import("pixi.js").Renderer;
    const adapter = new SceneGraphAdapter(makeTextureManager(), () => fakeRenderer);
    const group = transitionGroupNode("t1", shapeNode("a"), shapeNode("b"));

    adapter.reconcile(tree([group]));

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const call = renderSpy.mock.calls[0][0];
    expect(call.container).toBeInstanceOf(Container);
    expect(call.target).toBeDefined();
    // the TO side's Container passed to render() is NOT the same as the
    // FROM side's display added to the visible tree — they're genuinely
    // separate Containers (TO never appears directly in the visible tree):
    const display = adapter.root.children[0] as Container;
    expect(call.container).not.toBe(display);
  });

  it("resizes the TO-side RenderTexture to match the comp's actual size (tree.size), not a placeholder", () => {
    const renderSpy = vi.fn();
    const fakeRenderer = { render: renderSpy } as unknown as import("pixi.js").Renderer;
    const adapter = new SceneGraphAdapter(makeTextureManager(), () => fakeRenderer);
    const group = transitionGroupNode("t1", shapeNode("a"), shapeNode("b"));

    adapter.reconcile({ size: { width: 640, height: 480 }, nodes: [group] });

    const target = renderSpy.mock.calls[0][0].target;
    expect(target.width).toBe(640);
    expect(target.height).toBe(480);
  });

  it("removing a transitionGroup entirely tears down WITHOUT throwing (both FROM and TO nested levels, plus the TO RenderTexture)", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    adapter.reconcile(tree([transitionGroupNode("t1", shapeNode("a"), shapeNode("b"))]));
    const display = adapter.root.children[0];

    expect(() => adapter.reconcile(tree([]))).not.toThrow();
    expect(display.destroyed).toBe(true);
    expect(adapter.root.children).toHaveLength(0);
  });

  it("full adapter destroy() tears down a transitionGroup without throwing", () => {
    const adapter = new SceneGraphAdapter(makeTextureManager());
    adapter.reconcile(tree([transitionGroupNode("t1", shapeNode("a"), shapeNode("b"))]));

    expect(() => adapter.destroy()).not.toThrow();
  });

  it("re-reconciling the same transitionGroup id across frames reuses its RenderTexture/Containers rather than recreating them (no duplicate renderer.render() targets)", () => {
    const renderSpy = vi.fn();
    const fakeRenderer = { render: renderSpy } as unknown as import("pixi.js").Renderer;
    const adapter = new SceneGraphAdapter(makeTextureManager(), () => fakeRenderer);
    const group1 = transitionGroupNode("t1", shapeNode("a"), shapeNode("b"), "wipe-linear", 0.2);
    const group2 = transitionGroupNode("t1", shapeNode("a"), shapeNode("b"), "wipe-linear", 0.8); // same id, different progress (next frame)

    adapter.reconcile(tree([group1]));
    adapter.reconcile(tree([group2]));

    expect(renderSpy).toHaveBeenCalledTimes(2);
    const firstTarget = renderSpy.mock.calls[0][0].target;
    const secondTarget = renderSpy.mock.calls[1][0].target;
    expect(firstTarget).toBe(secondTarget); // same RenderTexture instance reused, not recreated.
  });

  it("REGRESSION (found via manual browser testing): the FROM container's filterArea is forced to the FULL comp size, not left to Pixi's default bounds-auto-fit — without this, a small shape's filter input gets sized to its OWN small bounding box while uTo is comp-sized, so vTextureCoord samples uTo through the wrong region (effectively invisible/transparent for most of the frame)", () => {
    const fakeRenderer = { render: vi.fn() } as unknown as import("pixi.js").Renderer;
    const adapter = new SceneGraphAdapter(makeTextureManager(), () => fakeRenderer);
    // A deliberately small shape (10x10, see shapeNode) inside a much larger comp —
    // exactly the case that broke: the shape's own bounds are tiny relative to the comp.
    adapter.reconcile({ size: { width: 1080, height: 1920 }, nodes: [transitionGroupNode("t1", shapeNode("a"), shapeNode("b"))] });

    const display = adapter.root.children[0] as Container;
    expect(display.filterArea).toBeDefined();
    expect(display.filterArea?.width).toBe(1080);
    expect(display.filterArea?.height).toBe(1920);
  });

  it("filterArea stays in sync with the comp size across reconciles (e.g. a composition resize)", () => {
    const fakeRenderer = { render: vi.fn() } as unknown as import("pixi.js").Renderer;
    const adapter = new SceneGraphAdapter(makeTextureManager(), () => fakeRenderer);
    const group = transitionGroupNode("t1", shapeNode("a"), shapeNode("b"));

    adapter.reconcile({ size: { width: 1080, height: 1920 }, nodes: [group] });
    adapter.reconcile({ size: { width: 640, height: 480 }, nodes: [group] });

    const display = adapter.root.children[0] as Container;
    expect(display.filterArea?.width).toBe(640);
    expect(display.filterArea?.height).toBe(480);
  });
});
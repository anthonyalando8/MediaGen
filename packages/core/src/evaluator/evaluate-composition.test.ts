// packages/core/src/evaluator/evaluate-composition.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evaluateComposition } from "./evaluate-composition";
import { evaluateNode } from "./evaluate-node";
import { IDENTITY } from "./compose-transform";
import { NodeKindRegistry } from "../registry/registry";
import type { NodeKind } from "../registry/node-kind";
import { toFrame } from "../types/ids";
import type { Id } from "../types/ids";
import type { Composition } from "../types/composition";
import type { Node } from "../types/node";

function makeNode(id: string, extra: Partial<Node> = {}): Node {
  return {
    id: id as Id,
    kind: "rect-test",
    name: id,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0, y: 0 },
    },
    opacity: 1,
    blend: "normal",
    time: { start: toFrame(0), duration: toFrame(60) },
    origin: "user",
    props: { width: 100, height: 50 },
    channels: [],
    ...extra,
  };
}

/**
 * Deliverable 12.1 fitness gate: "Adding a 6th NodeKind requires no edit to
 * core, evaluator, inspector, or store." This kind is defined entirely in
 * this test file — core ships with zero kinds registered, and
 * evaluateComposition dispatches to it purely via `reg.get(node.kind)`.
 */
const rectTestKind: NodeKind = {
  kind: "rect-test",
  displayName: "Rect (test)",
  category: "vector",
  schema: {
    props: z.object({ width: z.number(), height: z.number() }),
    channels: [{ path: "opacity", type: "scalar", label: "Opacity", default: 1 }],
    inspector: [],
  },
  defaults: () => ({ name: "Rect", props: { width: 100, height: 50 } }),
  render: (node) => [
    {
      id: node.id,
      // Placeholders — evaluateNode's applyWorld overwrites these.
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: node.props.width as number, height: node.props.height as number, radius: 0 },
    },
  ],
};

const groupKind: NodeKind = {
  kind: "group",
  displayName: "Group (test)",
  category: "container",
  container: true,
  schema: { props: z.object({}), channels: [], inspector: [] },
  defaults: () => ({ name: "Group", props: {} }),
  render: (node) => [
    { id: node.id, matrix: IDENTITY, opacity: 1, blend: "normal", t: "group", children: [] },
  ],
};

/**
 * Phase 2 §5 (Week 1-2) test-only NodeKind — proves an "effectGroup"
 * RenderNode flows through `evaluateNode`/`evaluateComposition` GENUINELY
 * NESTED (unlike "group", which always flattens — see groupKind/the
 * "flattening" test above). Not a production NodeKind: per the agreed
 * Week 1-2 scope, nothing in `core` yet auto-detects `masks`/`effects`/
 * `matte`/`isAdjustment` and emits an effectGroup for it — that wiring
 * lands in Weeks 3-8 as those features ship. This exists purely to
 * exercise the mechanism end-to-end ahead of any real feature using it.
 *
 * `render()` evaluates `node.children` itself, starting from IDENTITY
 * (not the node's own world matrix) — exactly the convention Deliverable
 * 08's `evalCompNode` pseudocode uses for a real precomp instance
 * (`bound.root.flatMap(n => evaluateNode(n, localF, IDENTITY, ...))`):
 * children end up positioned in the GROUP's local space, since Pixi (or
 * any consumer) composes the group Container's own transform with its
 * children's local transforms automatically once nested — `applyWorld`
 * (evaluate-node.ts) only ever stamps the GROUP's own top-level matrix,
 * never descends into an effectGroup's `children` to re-stamp them.
 */
const isolatingGroupKind: NodeKind = {
  kind: "isolating-group-test",
  displayName: "Isolating Group (test)",
  category: "container",
  container: true,
  schema: { props: z.object({}), channels: [], inspector: [] },
  defaults: () => ({ name: "Isolating Group", props: {} }),
  render: (node, frame, ctx) => {
    const reg = isolatingGroupRegistryRef.current;
    const children = (node.children ?? []).flatMap((c) => evaluateNode(c, frame, IDENTITY, reg, ctx));
    return [
      {
        id: node.id,
        matrix: IDENTITY, // placeholder — applyWorld overwrites with the GROUP's own world matrix
        opacity: 1,
        blend: "normal",
        t: "effectGroup",
        children,
        passes: [{ kind: "effect", ref: "identity", uniforms: {} }],
        isolate: true,
      },
    ];
  },
};
// `render(node, frame, ctx)` doesn't receive the registry — but this test
// kind needs one to recurse via evaluateNode. A module-level ref, set by
// makeRegistry() right after constructing the registry it'll be
// registered into, sidesteps adding a registry param to NodeKind.render
// (a real public-surface change) just for this test-only kind.
const isolatingGroupRegistryRef: { current: NodeKindRegistry } = { current: undefined as unknown as NodeKindRegistry };

function makeRegistry(): NodeKindRegistry {
  const reg = new NodeKindRegistry();
  reg.register(rectTestKind);
  reg.register(groupKind);
  reg.register(isolatingGroupKind);
  isolatingGroupRegistryRef.current = reg;
  return reg;
}

describe("evaluateComposition", () => {
  it("produces the expected RenderTree for a single static node", () => {
    const reg = makeRegistry();
    const comp: Composition = {
      id: "comp1" as Id,
      name: "Test",
      size: { width: 1080, height: 1920 },
      fps: 30,
      duration: toFrame(60),
      root: [makeNode("rect1", { transform: { position: { x: 100, y: 200, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } } })],
    };

    const tree = evaluateComposition(comp, toFrame(0), reg);

    expect(tree).toEqual({
      size: { width: 1080, height: 1920 },
      background: undefined,
      nodes: [
        {
          id: "rect1",
          matrix: [1, 0, 100, 0, 1, 200, 0, 0, 1],
          opacity: 1,
          blend: "normal",
          t: "shape",
          geom: { kind: "rect", width: 100, height: 50, radius: 0 },
        },
      ],
    });
  });

  it("samples an animated opacity channel", () => {
    const reg = makeRegistry();
    const comp: Composition = {
      id: "comp1" as Id,
      name: "Test",
      size: { width: 1080, height: 1920 },
      fps: 30,
      duration: toFrame(60),
      root: [
        makeNode("rect1", {
          channels: [
            {
              id: "chan-opacity" as Id,
              path: "opacity",
              type: "scalar",
              keys: [
                { frame: toFrame(0), value: 0, interp: "linear" },
                { frame: toFrame(30), value: 1, interp: "linear" },
              ],
            },
          ],
        }),
      ],
    };

    expect(evaluateComposition(comp, toFrame(0), reg).nodes[0].opacity).toBe(0);
    expect(evaluateComposition(comp, toFrame(15), reg).nodes[0].opacity).toBeCloseTo(0.5);
    expect(evaluateComposition(comp, toFrame(30), reg).nodes[0].opacity).toBe(1);
  });

  it("composes world matrices through a group, flattening into one array", () => {
    const reg = makeRegistry();
    const comp: Composition = {
      id: "comp1" as Id,
      name: "Test",
      size: { width: 1080, height: 1920 },
      fps: 30,
      duration: toFrame(60),
      root: [
        makeNode("group1", {
          kind: "group",
          transform: { position: { x: 10, y: 20, z: 0 }, scale: { x: 2, y: 2 }, rotation: 0, anchor: { x: 0, y: 0 } },
          props: {},
          children: [
            makeNode("rect1", {
              transform: { position: { x: 5, y: 5, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
            }),
          ],
        }),
      ],
    };

    const tree = evaluateComposition(comp, toFrame(0), reg);

    // Flat array: the group's RenderNode keeps `children: []`, and the
    // child is pushed as a sibling with its world (not local) matrix.
    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes[0]).toMatchObject({ id: "group1", t: "group", children: [], matrix: [2, 0, 10, 0, 2, 20, 0, 0, 1] });
    expect(tree.nodes[1]).toMatchObject({ id: "rect1", t: "shape", matrix: [2, 0, 20, 0, 2, 30, 0, 0, 1] });
  });

  it("composes opacity multiplicatively through (possibly nested) groups", () => {
    const reg = makeRegistry();
    const comp: Composition = {
      id: "comp1" as Id,
      name: "Test",
      size: { width: 1080, height: 1920 },
      fps: 30,
      duration: toFrame(60),
      root: [
        makeNode("outer", {
          kind: "group",
          opacity: 0.5,
          props: {},
          children: [
            makeNode("inner", {
              kind: "group",
              opacity: 0.5,
              props: {},
              children: [makeNode("rect1", { opacity: 0.8 })],
            }),
          ],
        }),
      ],
    };

    const tree = evaluateComposition(comp, toFrame(0), reg);

    expect(tree.nodes).toHaveLength(3);
    // groupKind's render() always sets opacity:1 as a placeholder — applyWorld overwrites it with the composed value.
    expect(tree.nodes.find((n) => n.id === "outer")?.opacity).toBeCloseTo(0.5);
    expect(tree.nodes.find((n) => n.id === "inner")?.opacity).toBeCloseTo(0.25); // 0.5 * 0.5
    expect(tree.nodes.find((n) => n.id === "rect1")?.opacity).toBeCloseTo(0.2); // 0.5 * 0.5 * 0.8
  });

  it("time-gates hidden nodes and nodes outside their TimeSpan", () => {
    const reg = makeRegistry();
    const comp: Composition = {
      id: "comp1" as Id,
      name: "Test",
      size: { width: 1080, height: 1920 },
      fps: 30,
      duration: toFrame(90),
      root: [
        makeNode("hidden", { hidden: true }),
        makeNode("late", { time: { start: toFrame(30), duration: toFrame(30) } }),
      ],
    };

    expect(evaluateComposition(comp, toFrame(0), reg).nodes).toHaveLength(0);
    expect(evaluateComposition(comp, toFrame(45), reg).nodes.map((n) => n.id)).toEqual(["late"]);
  });

  it("is pure: identical input produces deep-equal output and does not mutate the composition", () => {
    const reg = makeRegistry();
    const comp: Composition = {
      id: "comp1" as Id,
      name: "Test",
      size: { width: 1080, height: 1920 },
      fps: 30,
      duration: toFrame(60),
      root: [
        makeNode("rect1", {
          transform: { position: { x: 100, y: 200, z: 0 }, scale: { x: 1, y: 1 }, rotation: 45, anchor: { x: 10, y: 5 } },
          channels: [
            {
              id: "chan-opacity" as Id,
              path: "opacity",
              type: "scalar",
              keys: [
                { frame: toFrame(0), value: 0, interp: "bezier", outHandle: [0.25, 0.1], inHandle: undefined },
                { frame: toFrame(30), value: 1, interp: "linear" },
              ],
            },
          ],
        }),
      ],
    };

    const before = JSON.parse(JSON.stringify(comp));
    const a = evaluateComposition(comp, toFrame(12), reg);
    const b = evaluateComposition(comp, toFrame(12), reg);

    expect(a).toEqual(b);
    expect(comp).toEqual(before);
  });

  describe("effectGroup (Phase 2 §5, Week 1-2) — proves genuine nesting through the evaluator, unlike 'group'", () => {
    it("an effectGroup RenderNode keeps its children GENUINELY NESTED — evaluateComposition does NOT flatten them into the top-level array", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("isogroup", {
            kind: "isolating-group-test",
            transform: { position: { x: 100, y: 200, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
            props: {},
            children: [makeNode("rect1", { transform: { position: { x: 5, y: 5, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } } })],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);

      // exactly ONE top-level RenderNode — NOT two (which "group" would
      // produce by flattening; see the "flattening" test above for
      // contrast). The child stays nested inside the effectGroup's own
      // `children`.
      expect(tree.nodes).toHaveLength(1);
      expect(tree.nodes[0].t).toBe("effectGroup");
      if (tree.nodes[0].t !== "effectGroup") throw new Error("expected effectGroup");
      expect(tree.nodes[0].children).toHaveLength(1);
      expect(tree.nodes[0].children[0].id).toBe("rect1");
    });

    it("the effectGroup's OWN matrix is the world transform (applyWorld stamps it); its child's matrix stays LOCAL to the group (IDENTITY-rooted), since applyWorld never descends into children", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("isogroup", {
            kind: "isolating-group-test",
            transform: { position: { x: 100, y: 200, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
            props: {},
            children: [makeNode("rect1", { transform: { position: { x: 5, y: 5, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } } })],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      const group = tree.nodes[0];
      if (group.t !== "effectGroup") throw new Error("expected effectGroup");

      // the group's own matrix composes with its PARENT (here, the root) — world position (100, 200).
      expect(group.matrix).toEqual([1, 0, 100, 0, 1, 200, 0, 0, 1]);
      // the child's matrix is local to the group (5, 5) — NOT world-composed
      // with the group's (100, 200), since a real renderer (Pixi) composes
      // the group Container's transform with its nested children
      // automatically once the children are actually nested in it.
      expect(group.children[0].matrix).toEqual([1, 0, 5, 0, 1, 5, 0, 0, 1]);
    });

    it("carries passes/isolate through unchanged — the Evaluator emits them as DATA, never resolving a shader itself", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [makeNode("isogroup", { kind: "isolating-group-test", props: {} })],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      const group = tree.nodes[0];
      if (group.t !== "effectGroup") throw new Error("expected effectGroup");

      expect(group.isolate).toBe(true);
      expect(group.passes).toEqual([{ kind: "effect", ref: "identity", uniforms: {} }]);
    });

    it("a child INSIDE an effectGroup is still time-gated/hidden-gated independently, same as any other node", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("isogroup", {
            kind: "isolating-group-test",
            props: {},
            children: [makeNode("hidden-child", { hidden: true }), makeNode("visible-child")],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      const group = tree.nodes[0];
      if (group.t !== "effectGroup") throw new Error("expected effectGroup");

      expect(group.children).toHaveLength(1);
      expect(group.children[0].id).toBe("visible-child");
    });
  });

  describe("node.effects[] -> effectGroup (Phase 2 §6/§7, Week 3-4)", () => {
    it("a node with NO effects field is completely unaffected — output identical to Phase 1", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [makeNode("rect1")],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      expect(tree.nodes).toHaveLength(1);
      expect(tree.nodes[0].t).toBe("shape");
    });

    it("a node with an EMPTY effects array is unaffected (same as undefined)", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [makeNode("rect1", { effects: [] })],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      expect(tree.nodes[0].t).toBe("shape");
    });

    it("a node with only DISABLED effects is unaffected — 'enabled' is the sole on/off switch, not just a no-op uniform value", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("rect1", {
            effects: [{ id: "fx1" as Id, effect: "blur", enabled: false, props: { amount: 20 } }],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      expect(tree.nodes[0].t).toBe("shape");
    });

    it("a node with ONE enabled effect is wrapped in an effectGroup with exactly one PassSpec", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("rect1", {
            effects: [{ id: "fx1" as Id, effect: "blur", enabled: true, props: { amount: 8 } }],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      expect(tree.nodes).toHaveLength(1);
      const group = tree.nodes[0];
      if (group.t !== "effectGroup") throw new Error("expected effectGroup");
      expect(group.isolate).toBe(true);
      expect(group.passes).toEqual([{ kind: "effect", ref: "blur", uniforms: { amount: 8 } }]);
      expect(group.children).toHaveLength(1);
      expect(group.children[0].t).toBe("shape");
    });

    it("MULTIPLE enabled effects produce ordered passes (stacking order = array order); a disabled effect in the middle of the stack is skipped entirely, not left as a gap", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("rect1", {
            effects: [
              { id: "fx1" as Id, effect: "blur", enabled: true, props: { amount: 4 } },
              { id: "fx2" as Id, effect: "rgb-split", enabled: false, props: { amount: 99 } },
              { id: "fx3" as Id, effect: "grade", enabled: true, props: { gain: { l: 1, c: 1, h: 0 } } },
            ],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      const group = tree.nodes[0];
      if (group.t !== "effectGroup") throw new Error("expected effectGroup");
      expect(group.passes).toEqual([
        { kind: "effect", ref: "blur", uniforms: { amount: 4 } },
        { kind: "effect", ref: "grade", uniforms: { gain: { l: 1, c: 1, h: 0 } } },
      ]);
    });

    it("'animated blur amount samples correctly' (blueprint §12, Week 3-4 exit criterion) — a keyframed effect prop produces a DIFFERENT PassSpec.uniforms value at different frames", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("rect1", {
            effects: [
              {
                id: "fx1" as Id,
                effect: "blur",
                enabled: true,
                props: { amount: 0 },
                channels: [
                  {
                    id: "chan1" as Id,
                    path: "fx.fx1.amount",
                    type: "scalar",
                    keys: [
                      { frame: toFrame(0), value: 0, interp: "linear" },
                      { frame: toFrame(30), value: 30, interp: "linear" },
                    ],
                  },
                ],
              },
            ],
          }),
        ],
      };

      const at0 = evaluateComposition(comp, toFrame(0), reg);
      const at15 = evaluateComposition(comp, toFrame(15), reg);
      const at30 = evaluateComposition(comp, toFrame(30), reg);

      const group0 = at0.nodes[0];
      const group15 = at15.nodes[0];
      const group30 = at30.nodes[0];
      if (group0.t !== "effectGroup" || group15.t !== "effectGroup" || group30.t !== "effectGroup") {
        throw new Error("expected effectGroup at every frame");
      }

      expect(group0.passes[0].uniforms).toEqual({ amount: 0 });
      expect(group15.passes[0].uniforms).toEqual({ amount: 15 }); // linear interp, halfway between 0 and 30
      expect(group30.passes[0].uniforms).toEqual({ amount: 30 });
    });

    it("a node with BOTH children AND effects wraps the WHOLE subtree (own RenderNode + every descendant) in one effectGroup, not just its own immediate visual", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("parent", {
            transform: { position: { x: 50, y: 50, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
            effects: [{ id: "fx1" as Id, effect: "blur", enabled: true, props: { amount: 4 } }],
            children: [makeNode("child", { transform: { position: { x: 5, y: 5, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } } })],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      expect(tree.nodes).toHaveLength(1); // NOT two — parent + child both end up nested inside the ONE effectGroup.
      const group = tree.nodes[0];
      if (group.t !== "effectGroup") throw new Error("expected effectGroup");
      expect(group.children).toHaveLength(2); // parent's own shape + the child's shape, both nested.
      expect(group.children.map((c) => c.id)).toEqual(["parent", "child"]);
    });

    it("the effectGroup's own matrix is the node's WORLD transform; wrapped children are re-rooted to LOCAL space (matrix becomes IDENTITY, since they were all stamped with exactly `world` before wrapping)", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("rect1", {
            transform: { position: { x: 100, y: 200, z: 0 }, scale: { x: 2, y: 2 }, rotation: 0, anchor: { x: 0, y: 0 } },
            effects: [{ id: "fx1" as Id, effect: "blur", enabled: true, props: { amount: 4 } }],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      const group = tree.nodes[0];
      if (group.t !== "effectGroup") throw new Error("expected effectGroup");

      expect(group.matrix).toEqual([2, 0, 100, 0, 2, 200, 0, 0, 1]); // world: scale 2, translate (100,200)
      expect(group.children[0].matrix).toEqual(IDENTITY); // re-rooted to local — the group's own Container transform supplies the world position once nested.
    });

    it("a DISABLED effect's channels are never sampled at all (no PassSpec is produced for it, so its uniforms never need computing)", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("rect1", {
            effects: [
              {
                id: "fx1" as Id,
                effect: "blur",
                enabled: false,
                props: { amount: 0 },
                channels: [{ id: "chan1" as Id, path: "fx.fx1.amount", type: "scalar", keys: [{ frame: toFrame(0), value: 999, interp: "hold" }] }],
              },
            ],
          }),
        ],
      };

      // would throw if it tried to wrap in an effectGroup with this
      // disabled effect's channel — instead, no effectGroup is produced
      // at all (the "only disabled effects" case above), so there's
      // nothing further to assert beyond "doesn't throw and stays a plain shape."
      const tree = evaluateComposition(comp, toFrame(0), reg);
      expect(tree.nodes[0].t).toBe("shape");
    });
  });

  describe("Phase 2 §12.1 fitness gate — adding an effect needs no edit to core/the evaluator", () => {
    // The renderer-side half of this same gate lives in
    // renderer-webgl/src/passes/fitness-gate.test.ts (NOT here — importing
    // `core` from `renderer-webgl` would itself violate the
    // `renderer-webgl-no-core` dependency rule). This half proves the
    // EVALUATOR's contribution: `node.effects[]` -> PassSpec works for ANY
    // string `effect` key, including one that has never been registered
    // anywhere, isn't a real builtin, and means nothing to `core` —
    // because the evaluator's job is purely to sample and forward data, it
    // never looks up or validates against an EffectRegistry (that
    // resolution happens entirely in renderer-webgl/passes/pass-resolver.ts,
    // a different package `core` doesn't import).
    it("a node referencing a brand-new, never-registered-anywhere effect key still produces a real PassSpec — the evaluator has no registry to consult, so nothing about it needs to change for a new effect to exist", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(60),
        root: [
          makeNode("rect1", {
            effects: [{ id: "fx1" as Id, effect: "fitness-gate-tint-never-seen-before", enabled: true, props: { amount: 0.5 } }],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(0), reg);
      const group = tree.nodes[0];
      if (group.t !== "effectGroup") throw new Error("expected effectGroup");
      expect(group.passes).toEqual([{ kind: "effect", ref: "fitness-gate-tint-never-seen-before", uniforms: { amount: 0.5 } }]);
    });
  });

  describe("transitions (Phase 2 §4.4/§5/§13 acceptance test 08) — Node.transitionIn/transitionOut span the boundary between two z-order-adjacent siblings", () => {
    it("two siblings with NO transition declared evaluate completely unaffected — Phase 1 documents (which never set transitionIn/Out) are unchanged", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(120),
        root: [makeNode("a", { time: { start: toFrame(0), duration: toFrame(60) } }), makeNode("b", { time: { start: toFrame(60), duration: toFrame(60) } })],
      };

      const tree = evaluateComposition(comp, toFrame(30), reg);
      expect(tree.nodes).toHaveLength(1); // "b" is time-gated out at frame 30 — only "a" renders, exactly as in Phase 1.
      expect(tree.nodes[0].t).toBe("shape");
    });

    it("a transitionIn with a real overlap window produces ONE transitionGroup wrapping both siblings' own evaluated output, replacing their two separate entries", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(120),
        root: [
          makeNode("a", { time: { start: toFrame(0), duration: toFrame(60) } }),
          makeNode("b", {
            time: { start: toFrame(50), duration: toFrame(60) }, // overlaps "a" by 10 frames: [50, 60)
            transitionIn: { preset: "wipe", durationF: toFrame(10), props: { angle: 0 } },
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(55), reg); // mid-overlap
      expect(tree.nodes).toHaveLength(1);
      const group = tree.nodes[0];
      if (group.t !== "transitionGroup") throw new Error(`expected transitionGroup, got ${group.t}`);
      expect(group.ref).toBe("wipe");
      expect(group.uniforms).toEqual({ angle: 0 });
      expect(group.from.t).toBe("shape");
      expect(group.to.t).toBe("shape");
    });

    it("progress is 0 at the start of the overlap window and 1 at its end (exclusive), increasing monotonically across it", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(120),
        root: [
          makeNode("a", { time: { start: toFrame(0), duration: toFrame(60) } }),
          makeNode("b", {
            time: { start: toFrame(50), duration: toFrame(60) }, // overlap [50, 60)
            transitionIn: { preset: "wipe", durationF: toFrame(10), props: {} },
          }),
        ],
      };

      function progressAt(frame: number): number {
        const tree = evaluateComposition(comp, toFrame(frame), reg);
        const group = tree.nodes[0];
        if (group.t !== "transitionGroup") throw new Error(`expected transitionGroup at frame ${frame}, got ${group.t}`);
        return group.progress;
      }

      expect(progressAt(50)).toBe(0);
      expect(progressAt(55)).toBeCloseTo(0.5, 5);
      expect(progressAt(59)).toBeCloseTo(0.9, 5);
      // strictly increasing across the window:
      expect(progressAt(52)).toBeLessThan(progressAt(57));
    });

    it("transitionOut on the OUTGOING sibling works exactly like transitionIn on the incoming one when the incoming sibling sets neither", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(120),
        root: [
          makeNode("a", {
            time: { start: toFrame(0), duration: toFrame(60) },
            transitionOut: { preset: "dip", durationF: toFrame(10), props: {} },
          }),
          makeNode("b", { time: { start: toFrame(50), duration: toFrame(60) } }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(55), reg);
      expect(tree.nodes).toHaveLength(1);
      const group = tree.nodes[0];
      if (group.t !== "transitionGroup") throw new Error(`expected transitionGroup, got ${group.t}`);
      expect(group.ref).toBe("dip");
    });

    it("transitionIn on the incoming sibling takes precedence over transitionOut on the outgoing one when BOTH are set (avoids double-applying two different transitions to the same boundary)", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(120),
        root: [
          makeNode("a", {
            time: { start: toFrame(0), duration: toFrame(60) },
            transitionOut: { preset: "dip", durationF: toFrame(10), props: {} },
          }),
          makeNode("b", {
            time: { start: toFrame(50), duration: toFrame(60) },
            transitionIn: { preset: "wipe", durationF: toFrame(10), props: {} },
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(55), reg);
      const group = tree.nodes[0];
      if (group.t !== "transitionGroup") throw new Error(`expected transitionGroup, got ${group.t}`);
      expect(group.ref).toBe("wipe");
    });

    it("a transitionIn declared but with NO actual overlap between the two siblings' TimeSpans produces no transitionGroup — the two siblings evaluate independently instead", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(120),
        root: [
          makeNode("a", { time: { start: toFrame(0), duration: toFrame(60) } }), // ends at 60, no overlap with b
          makeNode("b", {
            time: { start: toFrame(60), duration: toFrame(60) },
            transitionIn: { preset: "wipe", durationF: toFrame(10), props: {} },
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(60), reg);
      expect(tree.nodes).toHaveLength(1); // only "b" is time-active at frame 60; no transitionGroup since there's no overlap window at all.
      expect(tree.nodes[0].t).toBe("shape");
    });

    it("a transition between two GROUP children (not just top-level comp.root siblings) is resolved at that nesting level too", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(120),
        root: [
          makeNode("group1", {
            kind: "group",
            children: [
              makeNode("a", { time: { start: toFrame(0), duration: toFrame(60) } }),
              makeNode("b", {
                time: { start: toFrame(50), duration: toFrame(60) },
                transitionIn: { preset: "wipe", durationF: toFrame(10), props: {} },
              }),
            ],
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(55), reg);
      // groupKind's own render() always emits its own placeholder "group"
      // RenderNode (per the flat-array convention — see evaluate-node.ts's
      // module doc), with children flattened in as ADDITIONAL siblings
      // alongside it, not nested under it: [group-placeholder,
      // transitionGroup], not just [transitionGroup].
      expect(tree.nodes).toHaveLength(2);
      expect(tree.nodes[0].t).toBe("group");
      expect(tree.nodes[1].t).toBe("transitionGroup");
    });

    it("a transition between two clips renders via shader (blueprint §13 acceptance test 08) — the renderer-side proof lives in renderer-webgl/src/passes/transition-resolver.test.ts; this confirms the evaluator's contribution (a real transitionGroup with a resolvable ref) is in place", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(120),
        root: [
          makeNode("a", { time: { start: toFrame(0), duration: toFrame(60) } }),
          makeNode("b", {
            time: { start: toFrame(50), duration: toFrame(60) },
            transitionIn: { preset: "wipe", durationF: toFrame(10), props: { angle: 0, feather: 0 } },
          }),
        ],
      };

      const tree = evaluateComposition(comp, toFrame(55), reg);
      const group = tree.nodes[0];
      if (group.t !== "transitionGroup") throw new Error("expected transitionGroup");
      // everything a renderer needs to resolve and draw this transition is present:
      expect(typeof group.ref).toBe("string");
      expect(group.progress).toBeGreaterThanOrEqual(0);
      expect(group.progress).toBeLessThanOrEqual(1);
      expect(group.from).toBeDefined();
      expect(group.to).toBeDefined();
    });

    it("REGRESSION (found via manual browser testing): a MIDDLE node with BOTH transitionIn (from the previous sibling) and transitionOut (to the next sibling) set must be able to participate in EACH transition at its own window, not have transitionIn unconditionally starve transitionOut", () => {
      const reg = makeRegistry();
      const comp: Composition = {
        id: "comp1" as Id,
        name: "Test",
        size: { width: 1080, height: 1920 },
        fps: 30,
        duration: toFrame(200),
        root: [
          makeNode("a", { time: { start: toFrame(0), duration: toFrame(60) } }), // [0, 60)
          makeNode("b", {
            time: { start: toFrame(50), duration: toFrame(60) }, // [50, 110) — overlaps "a" by [50,60), overlaps "c" by [100,110)
            transitionIn: { preset: "wipe-radial", durationF: toFrame(10), props: {} }, // boundary with "a": window [50,60)
            transitionOut: { preset: "wipe-linear", durationF: toFrame(10), props: {} }, // boundary with "c": window [100,110)
          }),
          makeNode("c", { time: { start: toFrame(100), duration: toFrame(60) } }), // [100, 160)
        ],
      };

      // At frame 55: only the A-B boundary's window [50,60) is active.
      const atAB = evaluateComposition(comp, toFrame(55), reg);
      const abGroup = atAB.nodes.find((n) => n.t === "transitionGroup");
      if (!abGroup || abGroup.t !== "transitionGroup") throw new Error("expected an A-B transitionGroup at frame 55");
      expect(abGroup.ref).toBe("wipe-radial");
      // "c" is NOT yet time-active at frame 55 (starts at 100) — only 1 other node ("b"-wrapped) renders alongside the group? No: "a"/"b" are consumed into the group; "c" isn't time-active yet, so nothing else renders.
      expect(atAB.nodes).toHaveLength(1);

      // At frame 105: only the B-C boundary's window [100,110) is active — THIS is the case the bug broke (transitionIn used to win regardless of frame).
      const atBC = evaluateComposition(comp, toFrame(105), reg);
      const bcGroup = atBC.nodes.find((n) => n.t === "transitionGroup");
      if (!bcGroup || bcGroup.t !== "transitionGroup") throw new Error("expected a B-C transitionGroup at frame 105 — this is the exact bug: transitionIn previously starved transitionOut unconditionally");
      expect(bcGroup.ref).toBe("wipe-linear");
      // "a" is no longer time-active at frame 105 (ended at 60) — only the B-C group renders.
      expect(atBC.nodes).toHaveLength(1);

      // At frame 80 (between both windows): neither boundary's window is active — "b" renders alone, untransitioned.
      const between = evaluateComposition(comp, toFrame(80), reg);
      expect(between.nodes.some((n) => n.t === "transitionGroup")).toBe(false);
      expect(between.nodes).toHaveLength(1); // "a" ended at 60, "c" starts at 100 — only "b" is time-active.
    });
  });
});
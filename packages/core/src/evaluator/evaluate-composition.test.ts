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
});
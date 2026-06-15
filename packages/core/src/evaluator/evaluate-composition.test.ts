// packages/core/src/evaluator/evaluate-composition.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evaluateComposition } from "./evaluate-composition";
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

function makeRegistry(): NodeKindRegistry {
  const reg = new NodeKindRegistry();
  reg.register(rectTestKind);
  reg.register(groupKind);
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
});
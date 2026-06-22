// apps/editor/src/e2e/precompose.test.ts
//
// Blueprint WK 7-8 exit criteria:
//   "edit source updates all instances; overrides apply."

import { describe, expect, it } from "vitest";
import { applyOp, applyExposed, evalCompNode, evaluateComposition, invertOp, toFrame, createComposition, createId } from "core";
import type { Composition } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "../commands/add-node";
import { setNodeProp } from "../commands/set-node-prop";
import { precompose } from "../commands/precompose";

const registry = createRegistry();

function evalAt(comp: Composition, frame = 0, comps: Record<string, Composition> = {}) {
  const resolveComp = (id: string) => {
    const c = comps[id];
    if (!c) throw new Error(`resolveComp: "${id}" not found`);
    return c;
  };
  return evaluateComposition(comp, toFrame(frame), registry, undefined, resolveComp);
}

function setupMasterWithTwoShapes() {
  const project = createBlankProject();
  const c0 = project.comps[project.rootCompId];
  let comp = applyOp(c0, appendNodeOp(c0, registry, "shape"));
  comp = applyOp(comp, appendNodeOp(comp, registry, "shape"));
  return { comp };
}

describe("precompose command", () => {
  it("extracts selected layers into a new Composition and replaces them with a comp node", () => {
    const { comp } = setupMasterWithTwoShapes();
    const nodeIds = [comp.root[0].id, comp.root[1].id];

    const result = precompose(comp, registry, nodeIds, "Extracted");

    expect(result.newComp.name).toBe("Extracted");
    expect(result.newComp.root).toHaveLength(2);

    const afterComp = applyOp(comp, result.op);
    expect(afterComp.root).toHaveLength(1);
    expect(afterComp.root[0].kind).toBe("comp");
    expect(afterComp.root[0].source?.compId).toBe(result.newComp.id);
    expect(afterComp.root[0].id).toBe(result.compNodeId);
  });

  it("the precompose op is undoable — restores original layers", () => {
    const { comp } = setupMasterWithTwoShapes();
    const nodeIds = [comp.root[0].id, comp.root[1].id];
    const originalKinds = comp.root.map((n) => n.kind);

    const { op } = precompose(comp, registry, nodeIds);
    const after = applyOp(comp, op);
    expect(after.root).toHaveLength(1);

    const restored = applyOp(after, invertOp(op));
    expect(restored.root).toHaveLength(2);
    expect(restored.root.map((n) => n.kind)).toEqual(originalKinds);
  });

  it("comp node evaluates — resolves the source comp and renders its layers as an effectGroup", () => {
    const { comp } = setupMasterWithTwoShapes();
    const nodeIds = [comp.root[0].id];
    const { op, newComp } = precompose(comp, registry, nodeIds);
    const master = applyOp(comp, op);

    const tree = evalAt(master, 0, { [newComp.id]: newComp });

    expect(tree.nodes).toHaveLength(2); // effectGroup (precomp) + remaining shape
    const precompNode = tree.nodes.find((n) => n.t === "effectGroup");
    expect(precompNode).toBeDefined();
    expect(precompNode?.isolate).toBe(true);
  });
});

describe("edit source updates all instances", () => {
  it("modifying the source comp's inner node is reflected in ALL comp node instances on next eval", () => {
    const { comp } = setupMasterWithTwoShapes();
    const shapeId = comp.root[0].id;

    const { op, newComp } = precompose(comp, registry, [shapeId], "LowerThird");
    const master = applyOp(comp, op);

    // Create TWO instances of the same source comp in the master
    const secondInstanceOp = appendNodeOp(master, registry, "comp", {
      name: "Instance 2",
      source: { compId: newComp.id },
    });
    const masterWithTwo = applyOp(master, secondInstanceOp);

    // Edit the source comp — change the shape's opacity
    const editedSource = applyOp(newComp, setNodeProp(newComp, shapeId, "opacity", 0.5));

    // Both instances see the change since they evaluate from the same source
    const comps = { [newComp.id]: editedSource };
    const tree = evalAt(masterWithTwo, 0, comps);

    // Both effectGroups should have the updated inner content
    const effectGroups = tree.nodes.filter((n) => n.t === "effectGroup");
    expect(effectGroups).toHaveLength(2);
    // Both instances come from the same edited source
    effectGroups.forEach((eg) => {
      expect(eg.children?.[0]?.opacity).toBeCloseTo(0.5);
    });
  });
});

describe("exposed prop overrides", () => {
  it("applyExposed overlays instance props onto the target composition's inner nodes", () => {
    const innerNodeId = createId();

    const source: Composition = {
      ...createComposition({ name: "Source" }),
      root: [
        {
          id: innerNodeId,
          kind: "shape",
          name: "Shape",
          transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
          opacity: 1,
          blend: "normal",
          time: { start: toFrame(0), duration: toFrame(150) },
          props: { width: 200, height: 200 },
          channels: [],
          origin: "user",
        },
      ],
      exposed: [
        { key: "w", label: "Width", target: { nodeId: innerNodeId, path: "props.width" }, type: "scalar" },
      ],
    };

    const bound = applyExposed(source, { w: 400 });
    expect(bound.root[0].props.width).toBe(400);
    // Source is not mutated
    expect(source.root[0].props.width).toBe(200);
  });

  it("applyExposed is a no-op when no overrides match exposed bindings", () => {
    const source: Composition = { ...createComposition({ name: "S" }), root: [], exposed: [] };
    const bound = applyExposed(source, { anything: 42 });
    expect(bound).toBe(source); // same reference — no clone needed
  });
});

describe("cycle guard", () => {
  it("evalCompNode throws when a comp references itself directly", () => {
    const selfId = createId();
    const selfComp: Composition = { ...createComposition({ name: "Self" }), id: selfId, root: [] };

    const selfNode = registry.create("comp", { name: "Self", source: { compId: selfId } });
    const resolveComp = () => selfComp;
    const ctx = { fps: 30, size: { width: 1080, height: 1920 }, resolveComp };

    expect(() =>
      evalCompNode(selfNode, [1,0,0,0,1,0,0,0,1] as never, 1, 30, toFrame(0), registry, ctx, new Set([selfId]))
    ).toThrow(/cycle/);
  });
});
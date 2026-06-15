// apps/editor/src/commands/group-nodes.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, evaluateComposition, invertOp, toFrame } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { groupNodes } from "./group-nodes";
import { moveNode } from "./transform-node";

/** A composition with 2 top-level shape nodes. */
function setupComp() {
  const project = createBlankProject();
  const registry = createRegistry();
  let comp = project.comps[project.rootCompId];
  comp = applyOp(comp, appendNodeOp(comp, registry, "shape"));
  comp = applyOp(comp, appendNodeOp(comp, registry, "shape"));
  return { comp, registry };
}

describe("groupNodes", () => {
  it("replaces 2 top-level nodes with 1 'group' node containing both, in original order", () => {
    const { comp, registry } = setupComp();
    const [a, b] = comp.root;

    const op = groupNodes(comp, registry, [a.id, b.id]);
    const next = applyOp(comp, op);

    expect(next.root).toHaveLength(1);
    const group = next.root[0];
    expect(group.kind).toBe("group");
    expect(group.children?.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it("groups regardless of the order ids are passed in (always uses ascending original indices)", () => {
    const { comp, registry } = setupComp();
    const [a, b] = comp.root;

    const op = groupNodes(comp, registry, [b.id, a.id]);
    const next = applyOp(comp, op);

    expect(next.root[0].children?.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it("invertOp (ungroup) restores the original 2-node root", () => {
    const { comp, registry } = setupComp();
    const originalIds = comp.root.map((n) => n.id);

    const op = groupNodes(comp, registry, [comp.root[0].id, comp.root[1].id]);
    const grouped = applyOp(comp, op);
    const restored = applyOp(grouped, invertOp(op));

    expect(restored.root.map((n) => n.id)).toEqual(originalIds);
    expect(restored.root).toHaveLength(2);
  });

  it("throws when fewer than 2 ids are given", () => {
    const { comp, registry } = setupComp();
    expect(() => groupNodes(comp, registry, [comp.root[0].id])).toThrow();
  });

  it("throws for an unknown node id", () => {
    const { comp, registry } = setupComp();
    expect(() => groupNodes(comp, registry, [comp.root[0].id, "nonexistent" as never])).toThrow();
  });

  it("exit criterion 06: moving the group shifts both children's RenderNode.matrix translation by the same delta", () => {
    const { comp, registry } = setupComp();
    const [a, b] = comp.root;

    const grouped = applyOp(comp, groupNodes(comp, registry, [a.id, b.id]));
    const groupId = grouped.root[0].id;

    const before = evaluateComposition(grouped, toFrame(0), registry);
    const beforeA = before.nodes.find((n) => n.id === a.id)!;
    const beforeB = before.nodes.find((n) => n.id === b.id)!;

    const moved = applyOp(grouped, moveNode(grouped, groupId, 30, -10));
    const after = evaluateComposition(moved, toFrame(0), registry);
    const afterA = after.nodes.find((n) => n.id === a.id)!;
    const afterB = after.nodes.find((n) => n.id === b.id)!;

    // matrix = [a,b,tx,c,d,ty,0,0,1] -> tx is index 2, ty is index 5
    expect(afterA.matrix[2] - beforeA.matrix[2]).toBeCloseTo(30);
    expect(afterA.matrix[5] - beforeA.matrix[5]).toBeCloseTo(-10);
    expect(afterB.matrix[2] - beforeB.matrix[2]).toBeCloseTo(30);
    expect(afterB.matrix[5] - beforeB.matrix[5]).toBeCloseTo(-10);
  });
});
// apps/editor/src/commands/ungroup-node.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, invertOp } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { groupNodes } from "./group-nodes";
import { ungroupNode } from "./ungroup-node";

/** A composition with 3 top-level shape nodes. */
function setupComp() {
  const project = createBlankProject();
  const registry = createRegistry();
  let comp = project.comps[project.rootCompId];
  comp = applyOp(comp, appendNodeOp(comp, registry, "shape"));
  comp = applyOp(comp, appendNodeOp(comp, registry, "shape"));
  comp = applyOp(comp, appendNodeOp(comp, registry, "shape"));
  return { comp, registry };
}

describe("ungroupNode", () => {
  it("restores the grouped nodes at the group's position, in original order", () => {
    const { comp, registry } = setupComp();
    const [a, b, c] = comp.root;

    const grouped = applyOp(comp, groupNodes(comp, registry, [a.id, b.id]));
    const groupId = grouped.root[0].id;
    expect(grouped.root.map((n) => n.id)).toEqual([groupId, c.id]); // group landed at index 0

    const ungrouped = applyOp(grouped, ungroupNode(grouped, groupId));

    expect(ungrouped.root.map((n) => n.id)).toEqual([a.id, b.id, c.id]);
    expect(ungrouped.root.map((n) => n.kind)).toEqual(["shape", "shape", "shape"]);
  });

  it("invertOp (re-group) restores the single group node", () => {
    const { comp, registry } = setupComp();
    const [a, b] = comp.root;

    const grouped = applyOp(comp, groupNodes(comp, registry, [a.id, b.id]));
    const groupId = grouped.root[0].id;

    const op = ungroupNode(grouped, groupId);
    const ungrouped = applyOp(grouped, op);
    const regrouped = applyOp(ungrouped, invertOp(op));

    expect(regrouped.root.map((n) => n.id)).toEqual(grouped.root.map((n) => n.id));
    expect(regrouped.root[0].kind).toBe("group");
    expect(regrouped.root[0].children?.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it("throws for a non-group node", () => {
    const { comp } = setupComp();
    expect(() => ungroupNode(comp, comp.root[0].id)).toThrow();
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupComp();
    expect(() => ungroupNode(comp, "nonexistent" as never)).toThrow();
  });
});
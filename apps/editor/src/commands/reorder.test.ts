// apps/editor/src/commands/reorder.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, invertOp } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { reorderNode } from "./reorder";

/** A composition with 3 top-level nodes: [shape, text, group]. */
function setupComp() {
  const project = createBlankProject();
  const registry = createRegistry();
  let comp = project.comps[project.rootCompId];
  comp = applyOp(comp, appendNodeOp(comp, registry, "shape"));
  comp = applyOp(comp, appendNodeOp(comp, registry, "text"));
  comp = applyOp(comp, appendNodeOp(comp, registry, "group"));
  return comp;
}

describe("reorderNode", () => {
  it("moves a node from index 0 to index 2: [A,B,C] -> [B,C,A]", () => {
    const comp = setupComp();
    const [a, b, c] = comp.root;

    const op = reorderNode(comp, a.id, 2);
    const next = applyOp(comp, op);

    expect(next.root.map((n) => n.id)).toEqual([b.id, c.id, a.id]);
  });

  it("moves a node from index 2 to index 0: [A,B,C] -> [C,A,B]", () => {
    const comp = setupComp();
    const [a, b, c] = comp.root;

    const op = reorderNode(comp, c.id, 0);
    const next = applyOp(comp, op);

    expect(next.root.map((n) => n.id)).toEqual([c.id, a.id, b.id]);
  });

  it("moves a middle node to the end: [A,B,C] -> [A,C,B]", () => {
    const comp = setupComp();
    const [a, b, c] = comp.root;

    const op = reorderNode(comp, b.id, 2);
    const next = applyOp(comp, op);

    expect(next.root.map((n) => n.id)).toEqual([a.id, c.id, b.id]);
  });

  it("invertOp restores the original order", () => {
    const comp = setupComp();
    const originalOrder = comp.root.map((n) => n.id);
    const [a] = comp.root;

    const op = reorderNode(comp, a.id, 2);
    const moved = applyOp(comp, op);
    const restored = applyOp(moved, invertOp(op));

    expect(restored.root.map((n) => n.id)).toEqual(originalOrder);
  });

  it("throws for an unknown node id", () => {
    const comp = setupComp();
    expect(() => reorderNode(comp, "nonexistent" as never, 0)).toThrow();
  });
});
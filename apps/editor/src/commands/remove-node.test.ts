// apps/editor/src/commands/remove-node.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, invertOp } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { removeNode } from "./remove-node";

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

describe("removeNode", () => {
  it("removes the targeted node, leaving the others in order", () => {
    const { comp } = setupComp();
    const [a, b, c] = comp.root;

    const next = applyOp(comp, removeNode(comp, b.id));

    expect(next.root.map((n) => n.id)).toEqual([a.id, c.id]);
  });

  it("invertOp (add) restores the node at its original index", () => {
    const { comp } = setupComp();
    const [a, b, c] = comp.root;

    const op = removeNode(comp, b.id);
    const removed = applyOp(comp, op);
    const restored = applyOp(removed, invertOp(op));

    expect(restored.root.map((n) => n.id)).toEqual([a.id, b.id, c.id]);
  });

  it("removing multiple nodes by re-finding indices after each removal", () => {
    const { comp } = setupComp();
    const [a, , c] = comp.root;

    // Delete a and c (in id order) — must re-resolve c's index after a is removed.
    let next = applyOp(comp, removeNode(comp, a.id));
    next = applyOp(next, removeNode(next, c.id));

    expect(next.root.map((n) => n.id)).toEqual([comp.root[1].id]);
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupComp();
    expect(() => removeNode(comp, "nonexistent" as never)).toThrow();
  });
});
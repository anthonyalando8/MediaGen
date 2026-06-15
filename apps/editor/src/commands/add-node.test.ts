// apps/editor/src/commands/add-node.test.ts
import { describe, expect, it } from "vitest";
import { applyOp } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { addNode } from "./add-node";

describe("addNode", () => {
  it("produces an 'add' Op appending a node of the requested kind to root", () => {
    const project = createBlankProject();
    const registry = createRegistry();
    const comp = project.comps[project.rootCompId];

    const op = addNode(comp, registry, "shape");

    expect(op.type).toBe("add");
    expect(op.compId).toBe(comp.id);
    expect(op.path).toBe("/root/0");
    expect(op.before).toBeNull();
    expect((op.after as { kind: string }).kind).toBe("shape");
  });

  it("applying the op via core's reducer adds the node to comp.root, leaving the original untouched", () => {
    const project = createBlankProject();
    const registry = createRegistry();
    const comp = project.comps[project.rootCompId];

    const op = addNode(comp, registry, "text");
    const next = applyOp(comp, op);

    expect(next.root).toHaveLength(1);
    expect(next.root[0].kind).toBe("text");
    expect(comp.root).toHaveLength(0); // applyOp is pure
  });

  it("appends at the next index for a non-empty root", () => {
    const project = createBlankProject();
    const registry = createRegistry();
    let comp = project.comps[project.rootCompId];

    comp = applyOp(comp, addNode(comp, registry, "shape"));
    const op2 = addNode(comp, registry, "text");

    expect(op2.path).toBe("/root/1");
  });

  it("sizes the new node's time span to the composition's duration", () => {
    const project = createBlankProject();
    const registry = createRegistry();
    const comp = project.comps[project.rootCompId];

    const op = addNode(comp, registry, "shape");
    const node = op.after as { time: { start: number; duration: number } };

    expect(node.time.start).toBe(0);
    expect(node.time.duration).toBe(comp.duration);
  });
});
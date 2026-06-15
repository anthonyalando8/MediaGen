// apps/editor/src/commands/toggle-node-flag.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, invertOp } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { setNodeHidden, setNodeLocked } from "./toggle-node-flag";

function setupCompWithOneShape() {
  const project = createBlankProject();
  const registry = createRegistry();
  const comp0 = project.comps[project.rootCompId];
  const comp = applyOp(comp0, appendNodeOp(comp0, registry, "shape"));
  return { comp, nodeId: comp.root[0].id };
}

describe("setNodeHidden", () => {
  it("sets node.hidden to true, defaulting `before` to false when unset", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    expect(comp.root[0].hidden).toBeUndefined();

    const op = setNodeHidden(comp, nodeId, true);
    expect(op.before).toBe(false);

    const next = applyOp(comp, op);
    expect(next.root[0].hidden).toBe(true);
  });

  it("invertOp toggles it back", () => {
    const { comp, nodeId } = setupCompWithOneShape();

    const op = setNodeHidden(comp, nodeId, true);
    const hidden = applyOp(comp, op);
    const restored = applyOp(hidden, invertOp(op));

    expect(restored.root[0].hidden).toBeFalsy();
  });
});

describe("setNodeLocked", () => {
  it("sets node.locked to true and back", () => {
    const { comp, nodeId } = setupCompWithOneShape();

    const op = setNodeLocked(comp, nodeId, true);
    const locked = applyOp(comp, op);
    expect(locked.root[0].locked).toBe(true);

    const unlocked = applyOp(locked, setNodeLocked(locked, nodeId, false));
    expect(unlocked.root[0].locked).toBe(false);
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupCompWithOneShape();
    expect(() => setNodeLocked(comp, "nonexistent" as never, true)).toThrow();
  });
});
// apps/editor/src/commands/set-node-prop.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, invertOp } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { setNodeProp } from "./set-node-prop";

function setupCompWithOneShape() {
  const project = createBlankProject();
  const registry = createRegistry();
  const comp0 = project.comps[project.rootCompId];
  const comp = applyOp(comp0, appendNodeOp(comp0, registry, "shape"));
  return { comp, nodeId: comp.root[0].id };
}

describe("setNodeProp", () => {
  it("sets a top-level field (name) and records its prior value", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].name;

    const op = setNodeProp(comp, nodeId, "name", "Renamed");
    expect(op.path).toBe(`/root/0/name`);
    expect(op.before).toBe(before);

    const next = applyOp(comp, op);
    expect(next.root[0].name).toBe("Renamed");
  });

  it("sets a nested props field (props.width)", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].props.width;

    const op = setNodeProp(comp, nodeId, "props.width", 300);
    expect(op.path).toBe(`/root/0/props/width`);
    expect(op.before).toBe(before);

    const next = applyOp(comp, op);
    expect(next.root[0].props.width).toBe(300);
  });

  it("sets a deeply-nested transform field (transform.position.x)", () => {
    const { comp, nodeId } = setupCompWithOneShape();

    const op = setNodeProp(comp, nodeId, "transform.position.x", 50);
    expect(op.path).toBe(`/root/0/transform/position/x`);

    const next = applyOp(comp, op);
    expect(next.root[0].transform.position.x).toBe(50);
    expect(next.root[0].transform.position.y).toBe(comp.root[0].transform.position.y); // untouched
  });

  it("before is null for a field that doesn't exist yet (e.g. optional strokeColor)", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    expect(comp.root[0].props.strokeColor).toBeUndefined();

    const op = setNodeProp(comp, nodeId, "props.strokeColor", { l: 0, c: 0, h: 0 });
    expect(op.before).toBeNull();

    const next = applyOp(comp, op);
    expect(next.root[0].props.strokeColor).toEqual({ l: 0, c: 0, h: 0 });
  });

  it("invertOp restores the prior value", () => {
    const { comp, nodeId } = setupCompWithOneShape();

    const op = setNodeProp(comp, nodeId, "props.width", 999);
    const changed = applyOp(comp, op);
    const restored = applyOp(changed, invertOp(op));

    expect(restored.root[0].props.width).toBe(comp.root[0].props.width);
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupCompWithOneShape();
    expect(() => setNodeProp(comp, "nonexistent" as never, "name", "x")).toThrow();
  });
});
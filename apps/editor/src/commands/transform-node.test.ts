// apps/editor/src/commands/transform-node.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, invertOp } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { moveNode, rotateNode, scaleNode } from "./transform-node";
import { setNodeProp } from "./set-node-prop";

function setupCompWithOneShape() {
  const project = createBlankProject();
  const registry = createRegistry();
  const comp0 = project.comps[project.rootCompId];
  const comp = applyOp(comp0, appendNodeOp(comp0, registry, "shape"));
  return { comp, nodeId: comp.root[0].id };
}

describe("moveNode", () => {
  it("translates transform.position by (dx, dy), preserving z", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].transform.position;

    const op = moveNode(comp, nodeId, 10, -5);
    const next = applyOp(comp, op);

    expect(next.root[0].transform.position).toEqual({ x: before.x + 10, y: before.y - 5, z: before.z });
    expect(comp.root[0].transform.position).toEqual(before); // applyOp is pure
  });

  it("invertOp restores the original position", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].transform.position;

    const op = moveNode(comp, nodeId, 10, -5);
    const moved = applyOp(comp, op);
    const restored = applyOp(moved, invertOp(op));

    expect(restored.root[0].transform.position).toEqual(before);
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupCompWithOneShape();
    expect(() => moveNode(comp, "nonexistent" as never, 1, 1)).toThrow();
  });
});

describe("scaleNode", () => {
  it("without a pivot, multiplies transform.scale and leaves position/anchor fixed (op targets the whole transform)", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].transform;

    const op = scaleNode(comp, nodeId, 2, 0.5);
    expect(op.path).toBe("/root/0/transform");

    const next = applyOp(comp, op);
    expect(next.root[0].transform.scale).toEqual({ x: before.scale.x * 2, y: before.scale.y * 0.5 });
    expect(next.root[0].transform.position).toEqual(before.position);
    expect(next.root[0].transform.rotation).toBe(before.rotation);
  });

  it("invertOp restores the original transform", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].transform;

    const op = scaleNode(comp, nodeId, 2, 0.5);
    const scaled = applyOp(comp, op);
    const restored = applyOp(scaled, invertOp(op));

    expect(restored.root[0].transform).toEqual(before);
  });

  it("with a pivot, repositions so the pivot's world point stays fixed (exit criterion: resizing doesn't reposition the shape)", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    // Place the 200x200 shape (anchor=(0,0)) at (100,100): world TL=(100,100), world BR=(300,300).
    const placed = applyOp(comp, setNodeProp(comp, nodeId, "transform.position", { x: 100, y: 100, z: 0 }));

    // Drag the TL handle (local (0,0)) to halve the size — pivot is the
    // opposite (BR) corner: local (200,200), currently at world (300,300).
    const op = scaleNode(placed, nodeId, 0.5, 0.5, { local: { x: 200, y: 200 }, world: { x: 300, y: 300 } });
    const next = applyOp(placed, op);

    expect(next.root[0].transform.scale).toEqual({ x: 0.5, y: 0.5 });
    // Solved position keeps BR (local 200,200) at world (300,300):
    // world = scale*local + position => 300 = 0.5*200 + position => position = 200.
    expect(next.root[0].transform.position).toEqual({ x: 200, y: 200, z: 0 });
  });
});

describe("rotateNode", () => {
  it("without a pivot, adds deltaDegrees to transform.rotation and leaves position/anchor fixed (op targets the whole transform)", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].transform;

    const op = rotateNode(comp, nodeId, 45);
    expect(op.path).toBe("/root/0/transform");

    const next = applyOp(comp, op);
    expect(next.root[0].transform.rotation).toBe(before.rotation + 45);
    expect(next.root[0].transform.position).toEqual(before.position);
    expect(next.root[0].transform.scale).toEqual(before.scale);
  });

  it("invertOp restores the original transform", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].transform;

    const op = rotateNode(comp, nodeId, 45);
    const rotated = applyOp(comp, op);
    const restored = applyOp(rotated, invertOp(op));

    expect(restored.root[0].transform).toEqual(before);
  });

  it("with a pivot, repositions so the pivot's world point stays fixed", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    // Place the 200x200 shape (anchor=(0,0)) at (100,100): world center is (200,200).
    const placed = applyOp(comp, setNodeProp(comp, nodeId, "transform.position", { x: 100, y: 100, z: 0 }));

    const op = rotateNode(placed, nodeId, 90, { local: { x: 100, y: 100 }, world: { x: 200, y: 200 } });
    const next = applyOp(placed, op);

    expect(next.root[0].transform.rotation).toBe(90);
    expect(next.root[0].transform.position.x).toBeCloseTo(300);
    expect(next.root[0].transform.position.y).toBeCloseTo(100);
  });
});
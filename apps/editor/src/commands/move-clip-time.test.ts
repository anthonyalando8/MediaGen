// apps/editor/src/commands/move-clip-time.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, createId, createOp, invertOp } from "core";
import type { Json } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { moveClipOp, trimClipOp } from "./move-clip-time";

function setupCompWithOneShape() {
  const project = createBlankProject();
  const registry = createRegistry();
  const comp0 = project.comps[project.rootCompId];
  const comp = applyOp(comp0, appendNodeOp(comp0, registry, "shape"));
  return { comp, nodeId: comp.root[0].id };
}

describe("moveClipOp", () => {
  it("sets time.start to the new value, leaving duration untouched", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].time;

    const op = moveClipOp(comp, nodeId, 25);
    const next = applyOp(comp, op);

    expect(next.root[0].time.start).toBe(25);
    expect(next.root[0].time.duration).toBe(before.duration);
    expect(comp.root[0].time).toEqual(before); // applyOp is pure
  });

  it("allows a negative start (no clamping — same stance as moveNode not clamping position)", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const next = applyOp(comp, moveClipOp(comp, nodeId, -10));
    expect(next.root[0].time.start).toBe(-10);
  });

  it("invertOp restores the original time span exactly", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].time;

    const op = moveClipOp(comp, nodeId, 25);
    const moved = applyOp(comp, op);
    const restored = applyOp(moved, invertOp(op));

    expect(restored.root[0].time).toEqual(before);
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupCompWithOneShape();
    expect(() => moveClipOp(comp, "nonexistent" as never, 10)).toThrow();
  });
});

describe("trimClipOp", () => {
  it("sets start AND duration together as one op (left-trim shape: start moves forward, duration shrinks)", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const op = trimClipOp(comp, nodeId, 20, 100);
    const next = applyOp(comp, op);

    expect(next.root[0].time.start).toBe(20);
    expect(next.root[0].time.duration).toBe(100);
  });

  it("right-trim shape: start unchanged, duration changes — still a single op on the whole time object", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const originalStart = comp.root[0].time.start;
    const next = applyOp(comp, trimClipOp(comp, nodeId, originalStart as number, 60));

    expect(next.root[0].time.start).toBe(originalStart);
    expect(next.root[0].time.duration).toBe(60);
  });

  it("floors duration at 1 frame — a zero or negative duration is never written", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const next = applyOp(comp, trimClipOp(comp, nodeId, 0, -5));
    expect(next.root[0].time.duration).toBe(1);
  });

  it("invertOp restores the original time span exactly", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const before = comp.root[0].time;

    const op = trimClipOp(comp, nodeId, 20, 100);
    const trimmed = applyOp(comp, op);
    const restored = applyOp(trimmed, invertOp(op));

    expect(restored.root[0].time).toEqual(before);
  });

  it("preserves in/out trim fields if already set on the time span", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const withInOut = applyOp(
      comp,
      createOp({
        type: "set",
        compId: comp.id,
        path: "/root/0/time",
        before: comp.root[0].time as unknown as Json,
        after: { ...comp.root[0].time, in: 5, out: 50 } as unknown as Json,
        txn: createId(),
      })
    );

    const next = applyOp(withInOut, trimClipOp(withInOut, nodeId, 10, 80));
    expect(next.root[0].time.in).toBe(5);
    expect(next.root[0].time.out).toBe(50);
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupCompWithOneShape();
    expect(() => trimClipOp(comp, "nonexistent" as never, 0, 10)).toThrow();
  });
});
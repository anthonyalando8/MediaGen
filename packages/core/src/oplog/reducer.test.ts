// packages/core/src/oplog/reducer.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, getByPointer, invertOp } from "./reducer";
import { History } from "./history";
import { createOp } from "./op";
import { toFrame } from "../types/ids";
import type { Id } from "../types/ids";
import type { Composition } from "../types/composition";
import type { Node } from "../types/node";
import type { Json } from "../types/primitives";

function makeNode(id: string, extra: Partial<Node> = {}): Node {
  return {
    id: id as Id,
    kind: "shape",
    name: id,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0, y: 0 },
    },
    opacity: 1,
    blend: "normal",
    time: { start: toFrame(0), duration: toFrame(150) },
    origin: "user",
    props: {},
    channels: [],
    ...extra,
  };
}

function makeComposition(): Composition {
  return {
    id: "comp1" as Id,
    name: "Test",
    size: { width: 1080, height: 1920 },
    fps: 30,
    duration: toFrame(150),
    root: [makeNode("A", { children: [] }), makeNode("B"), makeNode("C")],
  };
}

describe("reducer: set", () => {
  it("apply then invert restores the composition", () => {
    const comp = makeComposition();
    const op = createOp({
      type: "set",
      compId: comp.id,
      path: "/root/0/opacity",
      before: 1,
      after: 0.5,
      txn: "txn1" as Id,
    });

    const applied = applyOp(comp, op);
    expect(getByPointer<number>(applied, "/root/0/opacity")).toBe(0.5);

    const restored = applyOp(applied, invertOp(op));
    expect(restored).toEqual(comp);
  });

  it("does not mutate the original composition", () => {
    const comp = makeComposition();
    const before = JSON.parse(JSON.stringify(comp));
    const op = createOp({
      type: "set",
      compId: comp.id,
      path: "/root/1/name",
      before: "B",
      after: "Renamed",
      txn: "txn1" as Id,
    });
    applyOp(comp, op);
    expect(comp).toEqual(before);
  });
});

describe("reducer: add / remove", () => {
  it("apply then invert restores the composition", () => {
    const comp = makeComposition();
    const newNode = makeNode("D") as unknown as Json;
    const op = createOp({
      type: "add",
      compId: comp.id,
      path: "/root/3",
      before: null,
      after: newNode,
      txn: "txn1" as Id,
    });

    const applied = applyOp(comp, op);
    expect(applied.root).toHaveLength(4);
    expect(applied.root[3].id).toBe("D");

    const restored = applyOp(applied, invertOp(op));
    expect(restored).toEqual(comp);
  });

  it("remove then invert (add) restores the composition", () => {
    const comp = makeComposition();
    const removeOp = createOp({
      type: "remove",
      compId: comp.id,
      path: "/root/1",
      before: comp.root[1] as unknown as Json,
      after: null,
      txn: "txn1" as Id,
    });

    const applied = applyOp(comp, removeOp);
    expect(applied.root).toHaveLength(2);
    expect(applied.root.map((n) => n.id)).toEqual(["A", "C"]);

    const restored = applyOp(applied, invertOp(removeOp));
    expect(restored).toEqual(comp);
  });
});

describe("reducer: move / reparent", () => {
  it("moving a top-level node into a group's children, then inverting, restores the composition", () => {
    const comp = makeComposition();

    // Move root[2] ("C") to become root[0]'s ("A") first child.
    const op = createOp({
      type: "reparent",
      compId: comp.id,
      path: "",
      before: { from: "/root/0/children/0", to: "/root/2" } as unknown as Json,
      after: { from: "/root/2", to: "/root/0/children/0" } as unknown as Json,
      txn: "txn1" as Id,
    });

    const applied = applyOp(comp, op);
    expect(applied.root).toHaveLength(2);
    expect(applied.root.map((n) => n.id)).toEqual(["A", "B"]);
    expect(applied.root[0].children?.map((n) => n.id)).toEqual(["C"]);

    const restored = applyOp(applied, invertOp(op));
    expect(restored).toEqual(comp);
  });
});

describe("reducer: group / ungroup", () => {
  it("grouping two nodes, then inverting (ungroup), restores the composition", () => {
    const comp = makeComposition();

    const group = makeNode("G", {
      kind: "group",
      children: [comp.root[1], comp.root[2]],
    }) as unknown as Json;

    const op = createOp({
      type: "group",
      compId: comp.id,
      path: "/root",
      before: { indices: [1, 2] } as unknown as Json,
      after: { group, at: 1 } as unknown as Json,
      txn: "txn1" as Id,
    });

    const applied = applyOp(comp, op);
    expect(applied.root.map((n) => n.id)).toEqual(["A", "G"]);
    expect(applied.root[1].children?.map((n) => n.id)).toEqual(["B", "C"]);

    const ungroupOp = invertOp(op);
    const restored = applyOp(applied, ungroupOp);
    expect(restored).toEqual(comp);

    // Double invert returns to the forward "group" op.
    expect(invertOp(ungroupOp)).toEqual(op);
  });
});

describe("History", () => {
  it("apply/undo/redo are deterministic", () => {
    const comp = makeComposition();
    const history = new History(comp);

    const op1 = createOp({
      type: "set",
      compId: comp.id,
      path: "/root/0/opacity",
      before: 1,
      after: 0.5,
      txn: "txn1" as Id,
    });
    const op2 = createOp({
      type: "set",
      compId: comp.id,
      path: "/root/1/opacity",
      before: 1,
      after: 0.25,
      txn: "txn2" as Id,
    });

    history.apply(op1);
    history.apply(op2);

    expect(getByPointer<number>(history.current, "/root/0/opacity")).toBe(0.5);
    expect(getByPointer<number>(history.current, "/root/1/opacity")).toBe(0.25);

    history.undo();
    expect(getByPointer<number>(history.current, "/root/1/opacity")).toBe(1);
    expect(getByPointer<number>(history.current, "/root/0/opacity")).toBe(0.5);

    history.undo();
    expect(history.current).toEqual(comp);
    expect(history.canUndo()).toBe(false);

    history.redo();
    history.redo();
    expect(getByPointer<number>(history.current, "/root/0/opacity")).toBe(0.5);
    expect(getByPointer<number>(history.current, "/root/1/opacity")).toBe(0.25);
    expect(history.canRedo()).toBe(false);
  });

  it("a new apply after undo drops the redo branch", () => {
    const comp = makeComposition();
    const history = new History(comp);

    const op1 = createOp({
      type: "set",
      compId: comp.id,
      path: "/root/0/opacity",
      before: 1,
      after: 0.5,
      txn: "txn1" as Id,
    });
    const op2 = createOp({
      type: "set",
      compId: comp.id,
      path: "/root/1/opacity",
      before: 1,
      after: 0.25,
      txn: "txn2" as Id,
    });
    const op3 = createOp({
      type: "set",
      compId: comp.id,
      path: "/root/2/opacity",
      before: 1,
      after: 0.75,
      txn: "txn3" as Id,
    });

    history.apply(op1);
    history.apply(op2);
    history.undo(); // back to just op1

    history.apply(op3); // drops op2's redo branch

    expect(history.canRedo()).toBe(false);
    expect(getByPointer<number>(history.current, "/root/0/opacity")).toBe(0.5);
    expect(getByPointer<number>(history.current, "/root/1/opacity")).toBe(1);
    expect(getByPointer<number>(history.current, "/root/2/opacity")).toBe(0.75);
    expect(history.entries).toEqual([op1, op3]);
  });
});

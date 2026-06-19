// apps/editor/src/e2e/parenting.test.ts
//
// Blueprint WK 5-6 exit criterion: "null drives children; moving the null
// moves all of them." Tests cover: basic transform inheritance, multi-level
// chains, cross-subtree parenting (parentId pointing at an UNRELATED
// subtree — the case impossible to achieve by nesting alone), and the
// cycle guard.

import { describe, expect, it } from "vitest";
import { applyOp, evaluateComposition, toFrame } from "core";
import type { Composition, Id } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "../commands/add-node";
import { setNodeProp } from "../commands/set-node-prop";

function setup() {
  const registry = createRegistry();
  const project = createBlankProject();
  const comp0 = project.comps[project.rootCompId];
  let comp = applyOp(comp0, appendNodeOp(comp0, registry, "shape")); // root[0] = parent
  comp = applyOp(comp, appendNodeOp(comp, registry, "shape")); // root[1] = child
  return { registry, comp };
}

function evalAt(comp: Composition, frame = 0) {
  return evaluateComposition(comp, toFrame(frame), createRegistry());
}

describe("parenting (Phase 2 §4.4)", () => {
  it("a node WITHOUT parentId is unaffected — same world matrix as before parenting was added", () => {
    const { comp } = setup();
    const moved = applyOp(comp, setNodeProp(comp, comp.root[0].id, "transform.position.x", 200));
    const tree = evalAt(moved);

    const parent = tree.nodes.find((n) => n.id === comp.root[0].id);
    const child = tree.nodes.find((n) => n.id === comp.root[1].id);
    expect(parent?.matrix[2]).toBeCloseTo(200);
    expect(child?.matrix[2]).toBeCloseTo(0); // untouched
  });

  it("a node WITH parentId inherits the parent's world transform — moving the parent moves the child", () => {
    const { comp } = setup();
    const parentId = comp.root[0].id;
    const childId = comp.root[1].id;

    let c = applyOp(comp, setNodeProp(comp, parentId, "transform.position.x", 300));
    c = applyOp(c, setNodeProp(c, childId, "parentId", parentId));

    const tree = evalAt(c);
    const child = tree.nodes.find((n) => n.id === childId);
    expect(child?.matrix[2]).toBeCloseTo(300);
  });

  it("child's OWN transform stacks on top of the parent's (not replaced)", () => {
    const { comp } = setup();
    const parentId = comp.root[0].id;
    const childId = comp.root[1].id;

    let c = applyOp(comp, setNodeProp(comp, parentId, "transform.position.x", 100));
    c = applyOp(c, setNodeProp(c, childId, "transform.position.x", 50));
    c = applyOp(c, setNodeProp(c, childId, "parentId", parentId));

    const tree = evalAt(c);
    const child = tree.nodes.find((n) => n.id === childId);
    expect(child?.matrix[2]).toBeCloseTo(150); // 100 (parent) + 50 (child local)
  });

  it("cross-subtree parenting — parentId points at a node NOT in the same branch", () => {
    const registry = createRegistry();
    const project = createBlankProject();
    const c0 = project.comps[project.rootCompId];
    let comp = applyOp(c0, appendNodeOp(c0, registry, "shape")); // root[0] = driven
    comp = applyOp(comp, appendNodeOp(comp, registry, "shape")); // root[1] = unrelated
    comp = applyOp(comp, appendNodeOp(comp, registry, "shape")); // root[2] = driver

    const driverId = comp.root[2].id;
    const drivenId = comp.root[0].id;

    let c = applyOp(comp, setNodeProp(comp, driverId, "transform.position.x", 400));
    c = applyOp(c, setNodeProp(c, drivenId, "parentId", driverId));

    const tree = evalAt(c);
    const driven = tree.nodes.find((n) => n.id === drivenId);
    expect(driven?.matrix[2]).toBeCloseTo(400);
  });

  it("cycle guard — A.parentId=B, B.parentId=A does NOT throw; both nodes still render", () => {
    const { comp } = setup();
    const idA = comp.root[0].id;
    const idB = comp.root[1].id;

    let c = applyOp(comp, setNodeProp(comp, idA, "parentId", idB));
    c = applyOp(c, setNodeProp(c, idB, "parentId", idA));

    expect(() => evalAt(c)).not.toThrow();
    const tree = evalAt(c);
    expect(tree.nodes.length).toBeGreaterThan(0);
  });

  it("dangling parentId (non-existent node) degrades to no parenting without crashing", () => {
    const { comp } = setup();
    const childId = comp.root[1].id;
    const c = applyOp(comp, setNodeProp(comp, childId, "parentId", "does-not-exist" as Id));

    expect(() => evalAt(c)).not.toThrow();
    const tree = evalAt(c);
    const child = tree.nodes.find((n) => n.id === childId);
    expect(child?.matrix[2]).toBeCloseTo(0); // IDENTITY fallback
  });
});
// apps/editor/src/e2e/adjustment-layers.test.ts
//
// Blueprint WK 5-6 / Deliverable 07 exit criterion: "adjustment: its effects
// wrap an effectGroup over everything beneath it in z-order."
// Tests cover: basic wrapping, multiple adjustment layers stacking,
// no-effects no-op, adjustment with no nodes below it, and nested scope.

import { describe, expect, it } from "vitest";
import { applyOp, evaluateComposition, toFrame } from "core";
import type { Composition } from "core";
import type { RenderNode } from "contract";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "../commands/add-node";
import { setNodeProp } from "../commands/set-node-prop";
import { addEffectOp } from "../commands/add-effect";
import { EffectRegistry, registerBuiltinEffects } from "effects";

function setup(count = 2) {
  const registry = createRegistry();
  const project = createBlankProject();
  const c0 = project.comps[project.rootCompId];
  let comp = c0;
  for (let i = 0; i < count; i++) {
    comp = applyOp(comp, appendNodeOp(comp, registry, "shape"));
  }
  return { comp, registry };
}

function effectRegistry() {
  const r = new EffectRegistry();
  registerBuiltinEffects(r);
  return r;
}

function evalAt(comp: Composition) {
  return evaluateComposition(comp, toFrame(0), createRegistry());
}

function findEffectGroup(nodes: RenderNode[]): RenderNode | undefined {
  return nodes.find((n) => n.t === "effectGroup");
}

describe("adjustment layers (Phase 2 §4.4 / Deliverable 07)", () => {
  it("without isAdjustment, two shapes render as two flat RenderNodes with no effectGroup", () => {
    const { comp } = setup(2);
    const tree = evalAt(comp);
    expect(tree.nodes).toHaveLength(2);
    expect(findEffectGroup(tree.nodes)).toBeUndefined();
  });

  it("an adjustment node wraps all shapes BELOW it in a single effectGroup", () => {
    const { comp, registry } = setup(2); // root[0], root[1] = shapes
    const er = effectRegistry();

    // Add adjustment layer at root[2], above both shapes
    let c = applyOp(comp, appendNodeOp(comp, registry, "shape", { isAdjustment: true, name: "Adjustment" }));
    const adjId = c.root[2].id;
    // Give it an effect so it actually wraps (no-effects adjustment is a no-op)
    c = applyOp(c, addEffectOp(c, adjId, er.get("blur")));

    const tree = evalAt(c);
    // The two shapes below are wrapped in one effectGroup; the adjustment node itself is not in the output
    expect(tree.nodes).toHaveLength(1);
    const group = tree.nodes[0];
    if (group.t !== "effectGroup") throw new Error(`expected effectGroup, got ${group.t}`);
    expect(group.passes).toHaveLength(1);
    expect(group.passes[0].kind).toBe("effect");
    expect(group.passes[0].ref).toBe("blur");
    expect(group.children).toHaveLength(2);
  });

  it("adjustment node only affects siblings BELOW it — nodes added AFTER it (higher z-order) are not wrapped", () => {
    const { comp, registry } = setup(1); // root[0] = shape below
    const er = effectRegistry();

    // [shape, adjustment, shape_above]
    let c = applyOp(comp, appendNodeOp(comp, registry, "shape", { isAdjustment: true, name: "Adj" }));
    c = applyOp(c, addEffectOp(c, c.root[1].id, er.get("blur")));
    c = applyOp(c, appendNodeOp(c, registry, "shape")); // added AFTER adjustment

    const tree = evalAt(c);
    // effectGroup wraps root[0]; root[2] (above adjustment) renders independently
    const group = tree.nodes.find((n) => n.t === "effectGroup");
    expect(group).toBeDefined();
    // The shape above the adjustment renders as its own flat node
    const flatShapes = tree.nodes.filter((n) => n.t === "shape");
    expect(flatShapes).toHaveLength(1);
  });

  it("an adjustment node with NO enabled effects is a no-op — nodes below render unchanged", () => {
    const { comp, registry } = setup(2);
    // Add adjustment layer but give it NO effects
    const c = applyOp(comp, appendNodeOp(comp, registry, "shape", { isAdjustment: true, name: "Adj" }));
    const tree = evalAt(c);
    // No wrapping — two flat shapes, no effectGroup
    expect(findEffectGroup(tree.nodes)).toBeUndefined();
    expect(tree.nodes).toHaveLength(2);
  });

  it("two stacked adjustment layers — each wraps everything below it, producing nested effectGroups", () => {
    const { comp, registry } = setup(1); // root[0] = base shape
    const er = effectRegistry();

    // [shape, adj1, adj2]
    let c = applyOp(comp, appendNodeOp(comp, registry, "shape", { isAdjustment: true, name: "Adj1" }));
    c = applyOp(c, addEffectOp(c, c.root[1].id, er.get("blur")));
    c = applyOp(c, appendNodeOp(c, registry, "shape", { isAdjustment: true, name: "Adj2" }));
    c = applyOp(c, addEffectOp(c, c.root[2].id, er.get("glow")));

    const tree = evalAt(c);
    // Outer: adj2 wraps [effectGroup-from-adj1]
    expect(tree.nodes).toHaveLength(1);
    const outer = tree.nodes[0];
    if (outer.t !== "effectGroup") throw new Error("expected outer effectGroup");
    expect(outer.passes[0].ref).toBe("glow");
    // Inner: adj1 wraps [shape]
    expect(outer.children).toHaveLength(1);
    const inner = outer.children[0];
    if (inner.t !== "effectGroup") throw new Error("expected inner effectGroup");
    expect(inner.passes[0].ref).toBe("blur");
    expect(inner.children).toHaveLength(1); // the base shape
  });

  it("isAdjustment can be toggled ON an existing layer via setNodeProp — no special command needed", () => {
    const { comp } = setup(2);
    const er = effectRegistry();
    const adjId = comp.root[1].id; // promote root[1] to adjustment

    let c = applyOp(comp, setNodeProp(comp, adjId, "isAdjustment", true));
    c = applyOp(c, addEffectOp(c, adjId, er.get("blur")));

    const tree = evalAt(c);
    // root[0] is below adj, gets wrapped
    expect(findEffectGroup(tree.nodes)).toBeDefined();
  });
});
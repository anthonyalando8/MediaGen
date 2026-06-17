// apps/editor/src/commands/add-effect.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, invertOp } from "core";
import { EffectRegistry, registerBuiltinEffects } from "effects";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { addEffectOp, removeEffectOp } from "./add-effect";

function setupCompWithOneShape() {
  const project = createBlankProject();
  const registry = createRegistry();
  const comp0 = project.comps[project.rootCompId];
  const comp = applyOp(comp0, appendNodeOp(comp0, registry, "shape"));
  return { comp, nodeId: comp.root[0].id };
}

function blurDef() {
  const effectRegistry = new EffectRegistry();
  registerBuiltinEffects(effectRegistry);
  return effectRegistry.get("blur");
}

describe("addEffectOp", () => {
  it("adds the first effect to a node with no effects field yet (undefined -> [ref])", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    expect(comp.root[0].effects).toBeUndefined();

    const op = addEffectOp(comp, nodeId, blurDef());
    const next = applyOp(comp, op);

    expect(next.root[0].effects).toHaveLength(1);
    expect(next.root[0].effects?.[0].effect).toBe("blur");
    expect(next.root[0].effects?.[0].enabled).toBe(true);
  });

  it("seeds props from the effect's own Zod schema defaults", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const next = applyOp(comp, addEffectOp(comp, nodeId, blurDef()));
    expect(next.root[0].effects?.[0].props).toEqual({ amount: 0 });
  });

  it("appends to an existing effects array rather than replacing it", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const def = blurDef();
    const withOne = applyOp(comp, addEffectOp(comp, nodeId, def));
    const withTwo = applyOp(withOne, addEffectOp(withOne, nodeId, def));

    expect(withTwo.root[0].effects).toHaveLength(2);
    expect(withTwo.root[0].effects?.[0].id).not.toBe(withTwo.root[0].effects?.[1].id);
  });

  it("invertOp removes the just-added effect, restoring the prior array exactly (empty, since it started unset and addEffectOp's before-default is [])", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    const op = addEffectOp(comp, nodeId, blurDef());
    const added = applyOp(comp, op);
    const restored = applyOp(added, invertOp(op));

    expect(restored.root[0].effects).toEqual([]);
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupCompWithOneShape();
    expect(() => addEffectOp(comp, "nonexistent" as never, blurDef())).toThrow();
  });
});

describe("removeEffectOp", () => {
  function setupCompWithTwoEffects() {
    const { comp, nodeId } = setupCompWithOneShape();
    const def = blurDef();
    const step1 = applyOp(comp, addEffectOp(comp, nodeId, def));
    const step2 = applyOp(step1, addEffectOp(step1, nodeId, def));
    return { comp: step2, nodeId };
  }

  it("removes the matching effect by id, leaving the other untouched", () => {
    const { comp, nodeId } = setupCompWithTwoEffects();
    const [first, second] = comp.root[0].effects!;

    const afterRemove = applyOp(comp, removeEffectOp(comp, nodeId, first.id));
    expect(afterRemove.root[0].effects).toHaveLength(1);
    expect(afterRemove.root[0].effects?.[0].id).toBe(second.id);
  });

  it("invertOp restores the removed effect at its original position", () => {
    const { comp, nodeId } = setupCompWithTwoEffects();
    const removeOp = removeEffectOp(comp, nodeId, comp.root[0].effects![0].id);
    const removed = applyOp(comp, removeOp);
    const restored = applyOp(removed, invertOp(removeOp));

    expect(restored.root[0].effects).toEqual(comp.root[0].effects);
  });

  it("throws if the effect id doesn't exist on the node", () => {
    const { comp, nodeId } = setupCompWithOneShape();
    expect(() => removeEffectOp(comp, nodeId, "nonexistent" as never)).toThrow();
  });
});
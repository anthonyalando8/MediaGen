// apps/editor/src/commands/set-transition.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, invertOp } from "core";
import { TransitionRegistry, registerBuiltinTransitions } from "effects";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "./add-node";
import { removeTransitionOp, setTransitionDurationOp, setTransitionOp } from "./set-transition";

function setupCompWithTwoShapes() {
  const project = createBlankProject();
  const registry = createRegistry();
  const comp0 = project.comps[project.rootCompId];
  const withFirst = applyOp(comp0, appendNodeOp(comp0, registry, "shape"));
  const comp = applyOp(withFirst, appendNodeOp(withFirst, registry, "shape"));
  return { comp, firstId: comp.root[0].id, secondId: comp.root[1].id };
}

function wipeDef() {
  const transitionRegistry = new TransitionRegistry();
  registerBuiltinTransitions(transitionRegistry);
  return transitionRegistry.get("wipe-linear");
}

describe("setTransitionOp", () => {
  it("sets transitionIn on a node with no transition yet (undefined -> ref)", () => {
    const { comp, secondId } = setupCompWithTwoShapes();
    expect(comp.root[1].transitionIn).toBeUndefined();

    const op = setTransitionOp(comp, secondId, "transitionIn", wipeDef(), 15);
    const next = applyOp(comp, op);

    expect(next.root[1].transitionIn).toBeDefined();
    expect(next.root[1].transitionIn?.preset).toBe("wipe-linear");
    expect(next.root[1].transitionIn?.durationF).toBe(15);
  });

  it("sets transitionOut on the FIRST node's field, independent of the second node's transitionIn", () => {
    const { comp, firstId } = setupCompWithTwoShapes();
    const op = setTransitionOp(comp, firstId, "transitionOut", wipeDef(), 10);
    const next = applyOp(comp, op);

    expect(next.root[0].transitionOut?.preset).toBe("wipe-linear");
    expect(next.root[1].transitionIn).toBeUndefined(); // untouched — setting one side never writes the other.
  });

  it("seeds props from the transition's own Zod schema defaults", () => {
    const { comp, secondId } = setupCompWithTwoShapes();
    const next = applyOp(comp, setTransitionOp(comp, secondId, "transitionIn", wipeDef(), 15));
    expect(next.root[1].transitionIn?.props).toEqual({ angle: 0, feather: 0.02 });
  });

  it("REPLACES an existing transition on the same side rather than erroring (switching presets)", () => {
    const { comp, secondId } = setupCompWithTwoShapes();
    const withWipe = applyOp(comp, setTransitionOp(comp, secondId, "transitionIn", wipeDef(), 15));

    const dipDef = (() => {
      const reg = new TransitionRegistry();
      registerBuiltinTransitions(reg);
      return reg.get("dip");
    })();
    const withDip = applyOp(withWipe, setTransitionOp(withWipe, secondId, "transitionIn", dipDef, 20));

    expect(withDip.root[1].transitionIn?.preset).toBe("dip");
    expect(withDip.root[1].transitionIn?.durationF).toBe(20);
  });

  it("invertOp restores the prior (unset) state — written as the literal value null, since applyOp's \"set\" always writes op.after directly rather than deleting the key (setByPointer, core/oplog/reducer.ts)", () => {
    const { comp, secondId } = setupCompWithTwoShapes();
    const op = setTransitionOp(comp, secondId, "transitionIn", wipeDef(), 15);
    const applied = applyOp(comp, op);
    const restored = applyOp(applied, invertOp(op));

    expect(restored.root[1].transitionIn).toBeNull();
  });

  it("throws for an unknown node id", () => {
    const { comp } = setupCompWithTwoShapes();
    expect(() => setTransitionOp(comp, "nonexistent" as never, "transitionIn", wipeDef(), 15)).toThrow();
  });
});

describe("removeTransitionOp", () => {
  function setupWithTransition() {
    const { comp, secondId, firstId } = setupCompWithTwoShapes();
    const next = applyOp(comp, setTransitionOp(comp, secondId, "transitionIn", wipeDef(), 15));
    return { comp: next, secondId, firstId };
  }

  it("clears an existing transitionIn to the literal value null (setByPointer writes op.after directly; it never deletes the key)", () => {
    const { comp, secondId } = setupWithTransition();
    const next = applyOp(comp, removeTransitionOp(comp, secondId, "transitionIn"));
    expect(next.root[1].transitionIn).toBeNull();
  });

  it("invertOp restores the removed transition exactly", () => {
    const { comp, secondId } = setupWithTransition();
    const removeOp = removeTransitionOp(comp, secondId, "transitionIn");
    const removed = applyOp(comp, removeOp);
    const restored = applyOp(removed, invertOp(removeOp));

    expect(restored.root[1].transitionIn).toEqual(comp.root[1].transitionIn);
  });

  it("is a no-op-shaped (before=null, after=null) call when the side was never set, not a throw", () => {
    const { comp, firstId } = setupCompWithTwoShapes();
    expect(() => removeTransitionOp(comp, firstId, "transitionOut")).not.toThrow();
  });
});

describe("setTransitionDurationOp", () => {
  it("updates ONLY durationF, leaving preset/props untouched", () => {
    const { comp, secondId } = setupCompWithTwoShapes();
    const withTransition = applyOp(comp, setTransitionOp(comp, secondId, "transitionIn", wipeDef(), 15));

    const next = applyOp(withTransition, setTransitionDurationOp(withTransition, secondId, "transitionIn", 30));
    expect(next.root[1].transitionIn?.durationF).toBe(30);
    expect(next.root[1].transitionIn?.preset).toBe("wipe-linear");
    expect(next.root[1].transitionIn?.props).toEqual(withTransition.root[1].transitionIn?.props);
  });

  it("throws if the node has no transition on that side yet (the panel should only render this control once one exists)", () => {
    const { comp, secondId } = setupCompWithTwoShapes();
    expect(() => setTransitionDurationOp(comp, secondId, "transitionIn", 30)).toThrow();
  });

  it("invertOp restores the prior duration", () => {
    const { comp, secondId } = setupCompWithTwoShapes();
    const withTransition = applyOp(comp, setTransitionOp(comp, secondId, "transitionIn", wipeDef(), 15));
    const durationOp = setTransitionDurationOp(withTransition, secondId, "transitionIn", 30);
    const changed = applyOp(withTransition, durationOp);
    const restored = applyOp(changed, invertOp(durationOp));

    expect(restored.root[1].transitionIn?.durationF).toBe(15);
  });
});
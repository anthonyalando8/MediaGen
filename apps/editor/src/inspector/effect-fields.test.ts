// apps/editor/src/inspector/effect-fields.test.ts
import { describe, expect, it } from "vitest";
import { applyOp } from "core";
import { EffectRegistry, registerBuiltinEffects } from "effects";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "../commands/add-node";
import { addEffectOp } from "../commands/add-effect";
import { getEffectStackEntries } from "./effect-fields";

function nodeWithOneShape() {
  const project = createBlankProject();
  const registry = createRegistry();
  const comp0 = project.comps[project.rootCompId];
  const comp = applyOp(comp0, appendNodeOp(comp0, registry, "shape"));
  return { comp, nodeId: comp.root[0].id };
}

function effectRegistry() {
  const reg = new EffectRegistry();
  registerBuiltinEffects(reg);
  return reg;
}

describe("getEffectStackEntries", () => {
  it("returns an empty array for a node with no effects field", () => {
    const { comp, nodeId } = nodeWithOneShape();
    const node = comp.root.find((n) => n.id === nodeId)!;
    expect(getEffectStackEntries(node, effectRegistry())).toEqual([]);
  });

  it("returns one entry per effect, in stacking order, with displayName/enabled/effect resolved from the registry", () => {
    const { comp, nodeId } = nodeWithOneShape();
    const reg = effectRegistry();
    const blur = reg.get("blur");
    const grade = reg.get("grade");

    const step1 = applyOp(comp, addEffectOp(comp, nodeId, blur));
    const step2 = applyOp(step1, addEffectOp(step1, nodeId, grade));
    const node = step2.root[0];

    const entries = getEffectStackEntries(node, reg);
    expect(entries).toHaveLength(2);
    expect(entries[0].effect).toBe("blur");
    expect(entries[0].displayName).toBe("Gaussian Blur");
    expect(entries[0].enabled).toBe(true);
    expect(entries[1].effect).toBe("grade");
  });

  it("each field's path is prefixed with 'effects.<effectIndex>.' — matching setNodeProp's dotted-path convention", () => {
    const { comp, nodeId } = nodeWithOneShape();
    const reg = effectRegistry();
    const next = applyOp(comp, addEffectOp(comp, nodeId, reg.get("blur")));

    const entries = getEffectStackEntries(next.root[0], reg);
    expect(entries[0].fields[0].path).toBe("effects.0.props.amount");
  });

  it("resolves each field's current value from the actual EffectRef.props (not the registry's defaults) once edited", () => {
    const { comp, nodeId } = nodeWithOneShape();
    const reg = effectRegistry();
    const added = applyOp(comp, addEffectOp(comp, nodeId, reg.get("blur")));
    // simulate an edit directly on props, as setNodeProp would produce:
    const edited = { ...added, root: [{ ...added.root[0], effects: [{ ...added.root[0].effects![0], props: { amount: 12 } }] }] };

    const entries = getEffectStackEntries(edited.root[0], reg);
    expect(entries[0].fields[0].value).toBe(12);
  });

  it("a second effect's effectIndex correctly reflects its position, not always 0", () => {
    const { comp, nodeId } = nodeWithOneShape();
    const reg = effectRegistry();
    const step1 = applyOp(comp, addEffectOp(comp, nodeId, reg.get("blur")));
    const step2 = applyOp(step1, addEffectOp(step1, nodeId, reg.get("grade")));

    const entries = getEffectStackEntries(step2.root[0], reg);
    expect(entries[1].effectIndex).toBe(1);
    expect(entries[1].fields[0].path.startsWith("effects.1.")).toBe(true);
  });

  it("skips an effect whose registry key is unknown (e.g. a removed/renamed effect) rather than throwing", () => {
    const { comp, nodeId } = nodeWithOneShape();
    const reg = effectRegistry();
    const added = applyOp(comp, addEffectOp(comp, nodeId, reg.get("blur")));
    const corrupted = { ...added.root[0], effects: [{ ...added.root[0].effects![0], effect: "no-longer-exists" }] };

    expect(() => getEffectStackEntries(corrupted, reg)).not.toThrow();
    expect(getEffectStackEntries(corrupted, reg)).toEqual([]);
  });
});
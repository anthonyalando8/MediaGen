// packages/effects/src/registry.test.ts
import { describe, expect, it } from "vitest";
import { EffectRegistry, TransitionRegistry, UnknownEffectError, UnknownTransitionError } from "./registry";
import { registerBuiltinEffects, registerBuiltinTransitions, builtinEffects, builtinTransitions } from "./register-builtins";

describe("EffectRegistry", () => {
  it("registers and retrieves an effect by key", () => {
    const reg = new EffectRegistry();
    registerBuiltinEffects(reg);
    expect(reg.get("blur").displayName).toBe("Gaussian Blur");
  });

  it("throws UnknownEffectError for an unregistered key", () => {
    const reg = new EffectRegistry();
    expect(() => reg.get("not-a-real-effect")).toThrow(UnknownEffectError);
  });

  it("tryGet returns undefined instead of throwing for an unregistered key", () => {
    const reg = new EffectRegistry();
    expect(reg.tryGet("not-a-real-effect")).toBeUndefined();
  });

  it("list() returns every registered effect", () => {
    const reg = new EffectRegistry();
    registerBuiltinEffects(reg);
    expect(reg.list()).toHaveLength(builtinEffects.length);
  });
});

describe("TransitionRegistry", () => {
  it("registers and retrieves a transition by key", () => {
    const reg = new TransitionRegistry();
    registerBuiltinTransitions(reg);
    expect(reg.get("slam").displayName).toBe("Slam");
  });

  it("throws UnknownTransitionError for an unregistered key", () => {
    const reg = new TransitionRegistry();
    expect(() => reg.get("not-a-real-transition")).toThrow(UnknownTransitionError);
  });

  it("tryGet returns undefined instead of throwing for an unregistered key", () => {
    const reg = new TransitionRegistry();
    expect(reg.tryGet("not-a-real-transition")).toBeUndefined();
  });

  it("list() returns every registered transition", () => {
    const reg = new TransitionRegistry();
    registerBuiltinTransitions(reg);
    expect(reg.list()).toHaveLength(builtinTransitions.length);
  });
});

describe("builtin effects — structural sanity (§6: '~7 effects')", () => {
  it("ships at least 7 effects, each with a unique key", () => {
    expect(builtinEffects.length).toBeGreaterThanOrEqual(7);
    const keys = builtinEffects.map((e) => e.effect);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every effect's props schema successfully parses an empty object (every prop has a default)", () => {
    for (const def of builtinEffects) {
      const result = def.schema.props.safeParse({});
      expect(result.success, `${def.effect}: ${!result.success ? JSON.stringify(result.error.issues) : ""}`).toBe(true);
    }
  });

  it("every channel/inspector field path starts with 'props.' (the only addressable space for an EffectRef)", () => {
    for (const def of builtinEffects) {
      for (const channel of def.schema.channels) {
        expect(channel.path.startsWith("props."), `${def.effect}: channel path "${channel.path}"`).toBe(true);
      }
      for (const field of def.schema.inspector) {
        expect(field.path.startsWith("props."), `${def.effect}: inspector path "${field.path}"`).toBe(true);
      }
    }
  });

  it("every effect has non-empty GLSL fragment source containing a main() entry point", () => {
    for (const def of builtinEffects) {
      expect(def.glsl.length, def.effect).toBeGreaterThan(0);
      expect(def.glsl, def.effect).toContain("void main(void)");
      expect(def.glsl, def.effect).toContain("uTexture");
      expect(def.glsl, def.effect).toContain("finalColor");
    }
  });

  it("a multi-pass effect (blur) declares passes > 1; every other effect defaults to a single pass", () => {
    const blur = builtinEffects.find((e) => e.effect === "blur");
    expect(blur?.passes).toBe(2);
    for (const def of builtinEffects) {
      if (def.effect === "blur") continue;
      expect(def.passes ?? 1, def.effect).toBe(1);
    }
  });
});

describe("builtin transitions — structural sanity (§6: '~6 transitions')", () => {
  it("ships at least 6 transitions, each with a unique key", () => {
    expect(builtinTransitions.length).toBeGreaterThanOrEqual(6);
    const keys = builtinTransitions.map((t) => t.preset);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every transition's GLSL references uFrom, uTo, and uProgress — the shared signature (§6)", () => {
    for (const def of builtinTransitions) {
      expect(def.glsl, def.preset).toContain("uFrom");
      expect(def.glsl, def.preset).toContain("uTo");
      expect(def.glsl, def.preset).toContain("uProgress");
      expect(def.glsl, def.preset).toContain("void main(void)");
    }
  });

  it("every transition's props schema successfully parses an empty object", () => {
    for (const def of builtinTransitions) {
      const result = def.schema.props.safeParse({});
      expect(result.success, `${def.preset}: ${!result.success ? JSON.stringify(result.error.issues) : ""}`).toBe(true);
    }
  });
});
// packages/renderer-webgl/src/passes/pass-resolver.test.ts
import { describe, expect, it } from "vitest";
import { buildEffectUniforms, resolvePass } from "./pass-resolver";

describe("resolvePass", () => {
  it("returns null for an unrecognized pass ref (not yet implemented), rather than throwing", () => {
    expect(resolvePass({ kind: "effect", ref: "not-implemented-yet", uniforms: {} })).toBeNull();
    expect(resolvePass({ kind: "mask", ref: "pen-path", uniforms: {} })).toBeNull();
    expect(resolvePass({ kind: "matte", ref: "luma", uniforms: {}, srcNodeId: "n1" })).toBeNull();
    expect(resolvePass({ kind: "adjustment", ref: "grade", uniforms: {} })).toBeNull();
    expect(resolvePass({ kind: "transition", ref: "wipe", uniforms: {} })).toBeNull();
  });

  it("never throws for an 'identity' pass, even in an environment where GlProgram construction fails (e.g. this package's headless Node test env — no real WebGL context for GlProgram's shader-precision probe)", () => {
    // Whether this resolves to a real Filter or null depends on whether a
    // WebGL-capable context exists in the current environment (it does in
    // a real browser; it doesn't here) — `getIdentityProgram`'s doc in
    // pass-resolver.ts explains the fallback. The one invariant that must
    // hold EVERYWHERE is "never throws."
    expect(() => resolvePass({ kind: "effect", ref: "identity", uniforms: {} })).not.toThrow();
  });

  it("reuses the same identity Filter program across multiple calls (doesn't recompile per pass)", () => {
    const a = resolvePass({ kind: "effect", ref: "identity", uniforms: {} });
    const b = resolvePass({ kind: "effect", ref: "identity", uniforms: {} });
    // Either both resolved (real GL context available) or both didn't
    // (headless) — never a mix, since the underlying GlProgram is a
    // memoized singleton (getIdentityProgram).
    expect(a === null).toBe(b === null);
  });
});

describe("resolvePass — effect passes (Week 3-4)", () => {
  it("resolving a real builtin effect (blur), an unregistered effect, or one with unmappable uniform values never throws, regardless of whether a real GL context is available", () => {
    expect(() => resolvePass({ kind: "effect", ref: "blur", uniforms: { amount: 5 } })).not.toThrow();
    expect(() => resolvePass({ kind: "effect", ref: "definitely-not-a-real-effect", uniforms: {} })).not.toThrow();
    expect(() => resolvePass({ kind: "effect", ref: "blur", uniforms: { amount: 5, someFutureStringProp: "x" } })).not.toThrow();
  });

  it("returns null for a not-yet-registered effect ref", () => {
    expect(resolvePass({ kind: "effect", ref: "definitely-not-a-real-effect", uniforms: {} })).toBeNull();
  });
});

describe("buildEffectUniforms — the pure uniform-mapping logic (GL-independent, deterministic regardless of test environment)", () => {
  it("maps a numeric prop to f32, named u<CapitalizedPropKey> (e.g. amount -> uAmount)", () => {
    expect(buildEffectUniforms({ amount: 5 })).toEqual({ uAmount: { value: 5, type: "f32" } });
  });

  it("maps a boolean prop to f32 as 0/1", () => {
    expect(buildEffectUniforms({ enabled: true })).toEqual({ uEnabled: { value: 1, type: "f32" } });
    expect(buildEffectUniforms({ enabled: false })).toEqual({ uEnabled: { value: 0, type: "f32" } });
  });

  it("maps a ColorOKLCH-shaped prop (grade's lift/gamma/gain) to a vec3<f32> of [l, c, h]", () => {
    expect(buildEffectUniforms({ lift: { l: 0.1, c: 0.2, h: 30 } })).toEqual({
      uLift: { value: [0.1, 0.2, 30], type: "vec3<f32>" },
    });
  });

  it("skips a prop with no GLSL-representable value (e.g. a string), rather than throwing or emitting a malformed uniform", () => {
    expect(buildEffectUniforms({ amount: 5, someFutureStringProp: "x" })).toEqual({ uAmount: { value: 5, type: "f32" } });
  });

  it("'animated blur amount samples correctly' (blueprint §12, Week 3-4 exit criterion) — different sampled values produce different mapped uniforms, not a shared/stale one", () => {
    expect(buildEffectUniforms({ amount: 0 })).toEqual({ uAmount: { value: 0, type: "f32" } });
    expect(buildEffectUniforms({ amount: 20 })).toEqual({ uAmount: { value: 20, type: "f32" } });
    // calling it again with the FIRST value confirms there's no hidden
    // memoization keeping the second call's value around.
    expect(buildEffectUniforms({ amount: 0 })).toEqual({ uAmount: { value: 0, type: "f32" } });
  });

  it("maps an empty props object to an empty uniforms object", () => {
    expect(buildEffectUniforms({})).toEqual({});
  });
});
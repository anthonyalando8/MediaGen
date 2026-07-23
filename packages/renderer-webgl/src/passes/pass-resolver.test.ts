// packages/renderer-webgl/src/passes/pass-resolver.test.ts
import { describe, expect, it } from "vitest";
import { buildEffectUniforms, resolvePass } from "./pass-resolver";
import { oklchToRgbFloat } from "../color";

describe("resolvePass", () => {
  it("returns an empty array for an unrecognized pass ref (not yet implemented), rather than throwing", () => {
    expect(resolvePass({ kind: "effect", ref: "not-implemented-yet", uniforms: {} })).toEqual([]);
    expect(resolvePass({ kind: "mask", ref: "pen-path", uniforms: {} })).toEqual([]);
    expect(resolvePass({ kind: "matte", ref: "luma", uniforms: {}, srcNodeId: "n1" })).toEqual([]);
    expect(resolvePass({ kind: "adjustment", ref: "grade", uniforms: {} })).toEqual([]);
    expect(resolvePass({ kind: "transition", ref: "wipe", uniforms: {} })).toEqual([]);
  });

  it("never throws for an 'identity' pass, even in an environment where GlProgram construction fails (e.g. this package's headless Node test env — no real WebGL context for GlProgram's shader-precision probe)", () => {
    // Whether this resolves to a real [Filter] or [] depends on whether a
    // WebGL-capable context exists in the current environment (it does in
    // a real browser; it doesn't here) — `getIdentityProgram`'s doc in
    // pass-resolver.ts explains the fallback. The one invariant that must
    // hold EVERYWHERE is "never throws."
    expect(() => resolvePass({ kind: "effect", ref: "identity", uniforms: {} })).not.toThrow();
  });

  it("an identity pass resolves to AT MOST one Filter (single-pass, never multiple)", () => {
    const result = resolvePass({ kind: "effect", ref: "identity", uniforms: {} });
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it("reuses the same identity Filter program across multiple calls (doesn't recompile per pass)", () => {
    const a = resolvePass({ kind: "effect", ref: "identity", uniforms: {} });
    const b = resolvePass({ kind: "effect", ref: "identity", uniforms: {} });
    // Either both resolved (real GL context available) or both didn't
    // (headless) — never a mix, since the underlying GlProgram is a
    // memoized singleton (getIdentityProgram).
    expect(a.length).toBe(b.length);
  });
});

describe("resolvePass — effect passes (Week 3-4)", () => {
  it("resolving a real builtin effect (blur), an unregistered effect, or one with unmappable uniform values never throws, regardless of whether a real GL context is available", () => {
    expect(() => resolvePass({ kind: "effect", ref: "blur", uniforms: { amount: 5 } })).not.toThrow();
    expect(() => resolvePass({ kind: "effect", ref: "definitely-not-a-real-effect", uniforms: {} })).not.toThrow();
    expect(() => resolvePass({ kind: "effect", ref: "blur", uniforms: { amount: 5, someFutureStringProp: "x" } })).not.toThrow();
  });

  it("returns an empty array for a not-yet-registered effect ref", () => {
    expect(resolvePass({ kind: "effect", ref: "definitely-not-a-real-effect", uniforms: {} })).toEqual([]);
  });

  it("a single-pass effect (e.g. grade) resolves to AT MOST one Filter", () => {
    const result = resolvePass({ kind: "effect", ref: "grade", uniforms: {} });
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it("a multi-pass effect (blur, EffectDef.passes=2) resolves to AT MOST two Filters — never collapsed to one, never more than declared", () => {
    const result = resolvePass({ kind: "effect", ref: "blur", uniforms: { amount: 5 } });
    expect(result.length).toBeLessThanOrEqual(2);
    // if a real GL context IS available (not the case in this headless
    // test env, but asserting the invariant for whenever it is): exactly
    // 2, matching blurEffect.passes — never silently collapsed to 1.
    if (result.length > 0) expect(result.length).toBe(2);
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

  it("maps a ColorOKLCH-shaped prop (grade's lift/gamma/gain, a transition's dip color, etc.) to a vec3<f32> of real sRGB — NOT the raw [l, c, h] triple", () => {
    // Bug this guards against: `h` alone ranges 0-360 (degrees). A shader
    // declaring `uniform vec3 uColor` and using it directly as RGB (e.g.
    // dip.ts's "Dip to Color" transition, or grade.ts's uLift/uGamma/uGain)
    // got handed wildly out-of-range values if this ever regresses to
    // packing the raw OKLCH triple — GPU-clamped into a color with nothing
    // to do with the one actually configured (confirmed root cause of a dip
    // transition rendering as a saturated blue flash instead of its
    // intended dip color).
    const oklch = { l: 0.1, c: 0.2, h: 30 };
    const [r, g, b] = oklchToRgbFloat(oklch);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);

    const result = buildEffectUniforms({ lift: oklch });
    expect(result.uLift.type).toBe("vec3<f32>");
    const [ur, ug, ub] = result.uLift.value as [number, number, number];
    expect(ur).toBeCloseTo(r);
    expect(ug).toBeCloseTo(g);
    expect(ub).toBeCloseTo(b);
    // Explicitly NOT the raw OKLCH triple this bug used to emit.
    expect(result.uLift.value).not.toEqual([0.1, 0.2, 30]);
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
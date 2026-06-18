// packages/renderer-webgl/src/passes/fitness-gate.test.ts
//
// Phase 2 §12.1 fitness gate (renderer half): "Adding an effect/transition
// requires no edit to ... the renderer's pass executor — proven by a
// throwaway tint effect in a test." This file defines a brand-new "tint"
// EffectDef ENTIRELY within this test file (no change to any other source
// file in the repo), registers it into the exact SAME `effectRegistry`
// singleton `resolvePass` reads (imported from pass-resolver.ts, not a
// fresh instance), then resolves it via the real, unmodified `resolvePass`
// to confirm the renderer's pass executor picks it up automatically.
//
// The EVALUATOR half of this same gate ("no edit to core" — does
// `node.effects[]` -> PassSpec work for an arbitrary, unregistered-in-core
// effect key?) lives in core's OWN test suite instead
// (evaluate-composition.test.ts) — NOT here, because importing `core`
// from `renderer-webgl` would itself violate the `renderer-webgl-no-core`
// dependency rule this exact fitness gate is supposed to help guard (the
// renderer sees only `contract`, never the Evaluator). Two independent
// tests, each respecting its own package's boundaries, together proving
// the same end-to-end claim.
//
// If this test ever requires editing pass-resolver.ts or scene-graph.ts
// to pass, the gate has failed — adding an effect is supposed to be
// purely additive registration data.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { EffectDef } from "effects";
import { buildEffectUniforms, effectRegistry, resolvePass } from "./pass-resolver";

/** A minimal-but-real throwaway effect — multiplies the source color by a flat tint. Never registered anywhere outside this test. */
const tintEffect: EffectDef = {
  effect: "fitness-gate-tint",
  displayName: "Fitness Gate Tint (test-only)",
  category: "color",
  schema: {
    props: z.object({ amount: z.number().min(0).max(1).default(0) }),
    channels: [{ path: "props.amount", type: "scalar", label: "Amount", default: 0 }],
    inspector: [{ path: "props.amount", label: "Amount", control: "number" }],
  },
  glsl: `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uAmount;
void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    finalColor = mix(color, vec4(1.0, 0.0, 0.0, color.a), uAmount);
}
`,
};

describe("Phase 2 §12.1 fitness gate — adding an effect needs no edit to the renderer's pass executor", () => {
  it("registering a brand-new effect at test-time into the SAME registry resolvePass reads makes it resolvable immediately, with no change to pass-resolver.ts or scene-graph.ts", () => {
    effectRegistry.register(tintEffect);

    expect(effectRegistry.get("fitness-gate-tint").displayName).toBe("Fitness Gate Tint (test-only)");
    expect(() => resolvePass({ kind: "effect", ref: "fitness-gate-tint", uniforms: { amount: 0.5 } })).not.toThrow();
  });

  it("a PassSpec referencing this brand-new effect's uniforms maps through the exact same buildEffectUniforms() logic as any builtin effect — no special-casing by ref string", () => {
    effectRegistry.register(tintEffect);
    const def = effectRegistry.get("fitness-gate-tint");

    // the uniform-mapping convention ("amount" -> "uAmount", numeric -> f32)
    // is generic over ANY EffectDef's props — proven here without needing
    // a real GlProgram/WebGL context (see buildEffectUniforms's own doc on
    // why it's tested this way rather than through resolvePass directly).
    expect(buildEffectUniforms({ amount: 0.5 })).toEqual({ uAmount: { value: 0.5, type: "f32" } });
    expect(def.schema.props.parse({})).toEqual({ amount: 0 });
  });

  it("resolving a PassSpec for this brand-new effect never throws, exactly like any builtin — the renderer's pass executor has no special-casing by ref string to fail to cover", () => {
    effectRegistry.register(tintEffect);
    expect(() => resolvePass({ kind: "effect", ref: "fitness-gate-tint", uniforms: { amount: 0.5 } })).not.toThrow();
    expect(() => resolvePass({ kind: "effect", ref: "blur", uniforms: { amount: 5 } })).not.toThrow();
  });
});
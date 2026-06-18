// packages/renderer-webgl/src/passes/pass-resolver.ts
//
// Resolves a `PassSpec` (contract — sampled data the Evaluator emits, see
// its doc) to a compiled Pixi `Filter`. This is the ONE place a `ref`
// string becomes an actual shader — kept separate from scene-graph.ts so
// later weeks (5-6: masks/mattes/adjustment) only need to add cases here,
// never touch the reconciliation logic itself.
//
// EFFECT passes (Week 3-4): resolve via the `effects` package's
// `EffectRegistry` — single input -> single output, which maps directly
// onto Pixi's `Container.filters` mechanism (one Filter, one implicit
// input texture). `buildEffectFilter` turns an `EffectDef`'s GLSL +
// `pass.uniforms` into a real compiled `Filter`.
//
// TRANSITION passes are NOT YET implemented here — deliberately deferred.
// A transition's GLSL signature (`effects` package's TransitionDef doc:
// "vec4 trans(sampler2D from, sampler2D to, float progress)") needs TWO
// input textures, which `Container.filters` can't supply (a Filter only
// ever sees ONE implicit input — its container's own rendered subtree).
// Rendering two sibling layers to separate textures and compositing them
// via a custom two-texture shader pass needs its own mechanism — tracked
// as a follow-up once that pass-graph shape is designed, rather than
// guessed at here. `resolvePass` returns `null` for "transition" passes
// in the meantime (same graceful "not implemented yet" behavior as any
// unrecognized `ref`).
//
// Week 1-2 scope (Phase 2 blueprint §12, "WK 1-2 · pass graph + FBO pool"):
// the IDENTITY pass — a real passthrough shader, copied verbatim from
// Pixi's own bundled default filter vertex/fragment source
// (`pixi.js/lib/filters/defaults/defaultFilter.vert.js` +
// `.../passthrough/passthrough.frag.js`), proving the effectGroup +
// isolate render-to-texture-then-composite path genuinely executes one GPU
// pass. Still used by tests; real content now resolves through the
// EFFECT case below instead.

import { Filter, GlProgram } from "pixi.js";
import type { Json, PassSpec } from "contract";
import { EffectRegistry, registerBuiltinEffects } from "effects";
import type { EffectDef } from "effects";

/**
 * Pixi's own default filter vertex shader, verbatim — handles the
 * filter-space vertex transform (`uOutputFrame`/`uOutputTexture`) any
 * single-pass filter needs regardless of what its fragment shader does.
 * Copying this (rather than writing a new one) guarantees pixel-identical
 * behavior to Pixi's internal filters for anything that doesn't otherwise
 * distort `vTextureCoord`. Every EFFECT pass (below) pairs with this same
 * vertex stage too — only the fragment shader differs per effect.
 *
 * IMPORTANT — `uInputSize` precision: `GlProgram.defaultOptions` (Pixi)
 * prepends `precision highp float;` to every VERTEX shader and `precision
 * mediump float;` to every FRAGMENT shader by default. GLSL ES linking
 * requires a uniform declared in BOTH stages to have the SAME effective
 * precision; an unqualified `uniform vec4 uInputSize;` in a fragment
 * shader inherits the fragment default (mediump) while this vertex
 * shader's copy inherits highp — a mismatch that fails to LINK (not
 * compile), surfacing as Pixi's "Precisions of uniform 'uInputSize'
 * differ between VERTEX and FRAGMENT shaders" warning immediately
 * followed by a hard "Could not initialize shader" failure. Pixi's own
 * bundled blur filter avoids this entirely by never referencing
 * `uInputSize` in its fragment at all (it precomputes offset UVs in the
 * vertex stage instead — generateBlurFragSource.mjs). Any effect fragment
 * in THIS package that needs `uInputSize` (blur/drop-shadow/glow/rgb-split)
 * must declare it as `uniform highp vec4 uInputSize;` explicitly — matching
 * this vertex shader's precision exactly — rather than leaving it
 * unqualified.
 */
export const DEFAULT_VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

/** Pixi's own passthrough fragment shader, verbatim — samples `uTexture` unchanged. */
const IDENTITY_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
void main() {
    finalColor = texture(uTexture, vTextureCoord);
}
`;

/**
 * The shared effect registry this module resolves "effect" passes
 * against. A module-level singleton (not constructor-injected) — like
 * `core`'s own bootstrap convention (registerBuiltins called once at
 * startup), `effects`' registrations are static for the process lifetime;
 * nothing here needs per-instance registries the way, say,
 * NodeKindRegistry sometimes does for test isolation (this module's own
 * tests register a throwaway tint effect into a SEPARATE registry
 * instance instead — see pass-resolver.test.ts — to avoid mutating this
 * shared one).
 */
const effectRegistry = new EffectRegistry();
registerBuiltinEffects(effectRegistry);

/** Exposed so a Week 3-4 fitness-gate test ("adding a throwaway tint effect requires no edit to the renderer's pass executor") can register into the SAME registry resolvePass reads, without this module needing a setter API. */
export { effectRegistry };

let identityProgram: GlProgram | undefined;
let identityProgramFailed = false;

/**
 * Lazily-constructed singleton — a GlProgram only needs building once;
 * every identity pass reuses it. Returns `undefined` (rather than
 * throwing) if construction fails — `GlProgram`'s constructor probes
 * shader precision via a real `<canvas>`/WebGL context
 * (`getMaxFragmentPrecision` -> `getTestContext`), which doesn't exist in
 * a headless test environment (this package's tests run in plain Node, no
 * jsdom — see vitest.setup.ts's doc on the same class of issue for
 * `navigator`). In an actual browser this always succeeds; treating a
 * failure as "can't resolve this pass" (returned as `null` by
 * `resolvePass`, same as any unrecognized `ref`) keeps that one
 * environment difference from crashing `reconcile()` entirely.
 */
function getIdentityProgram(): GlProgram | undefined {
  if (identityProgram || identityProgramFailed) return identityProgram;
  try {
    identityProgram = new GlProgram({ vertex: DEFAULT_VERTEX, fragment: IDENTITY_FRAGMENT, name: "seabytes-identity" });
  } catch {
    identityProgramFailed = true;
  }
  return identityProgram;
}

const effectPrograms = new Map<string, GlProgram | null>();

/** Same lazy/failure-tolerant pattern as `getIdentityProgram`, keyed per effect so each effect's GlProgram only compiles once. */
function getEffectProgram(def: EffectDef): GlProgram | undefined {
  if (effectPrograms.has(def.effect)) return effectPrograms.get(def.effect) ?? undefined;
  try {
    const program = new GlProgram({ vertex: DEFAULT_VERTEX, fragment: def.glsl, name: `seabytes-effect-${def.effect}` });
    effectPrograms.set(def.effect, program);
    return program;
  } catch {
    effectPrograms.set(def.effect, null);
    return undefined;
  }
}

/**
 * Maps a sampled `EffectRef.props` value (JSON-safe — string | number |
 * boolean | a ColorOKLCH-shaped object, per `Scalar`, core/types/node.ts)
 * to a Pixi uniform `{value, type}` pair. Every effect's GLSL declares its
 * own uniform names (e.g. `uAmount`, `uLift`) distinct from its prop keys
 * (`amount`, `lift`) — this function only handles the VALUE/TYPE side;
 * `buildEffectFilter` handles the NAME mapping (`u` + capitalized prop
 * key, the convention every shipped effect's GLSL follows).
 */
function toUniformValue(value: Json): { value: unknown; type: string } | null {
  if (typeof value === "number") return { value, type: "f32" };
  if (typeof value === "boolean") return { value: value ? 1 : 0, type: "f32" };
  if (value && typeof value === "object" && !Array.isArray(value) && "l" in value && "c" in value && "h" in value) {
    // ColorOKLCH-shaped — every shipped effect that takes one (grade's
    // lift/gamma/gain, drop-shadow's color) reads `.l`/`.c`/`.h` as three
    // independent numeric channels (NOT an actual OKLCH->RGB conversion —
    // see grade.ts's doc on why ColorOKLCH is reused purely as the one
    // structured 3-number Scalar shape available), so map directly to a vec3.
    const c = value as { l: number; c: number; h: number };
    return { value: [c.l, c.c, c.h], type: "vec3<f32>" };
  }
  return null; // strings (e.g. a future enum-typed prop) have no GLSL uniform representation yet.
}

/** "amount" -> "uAmount" — every shipped effect's GLSL follows this convention (verified by registry.test.ts's structural-sanity tests, indirectly: every prop the inspector exposes has a matching uniform declared in the shader). */
function uniformName(propKey: string): string {
  return `u${propKey.charAt(0).toUpperCase()}${propKey.slice(1)}`;
}

/**
 * Maps a sampled `EffectRef.props` object to the `{ uAmount: {value,
 * type}, ... }` shape a Filter's `resources` slot expects — the pure,
 * GL-independent half of "resolve an effect pass": no `GlProgram`/`Filter`
 * construction here, so this is testable without a real WebGL context
 * (unlike `buildEffectFilter`/`resolvePass` themselves, whose result also
 * depends on whether `GlProgram` construction succeeds in the current
 * environment — see `getEffectProgram`'s doc).
 */
export function buildEffectUniforms(props: Record<string, Json>): Record<string, { value: unknown; type: string }> {
  const uniforms: Record<string, { value: unknown; type: string }> = {};
  for (const [key, value] of Object.entries(props)) {
    const mapped = toUniformValue(value);
    if (mapped) uniforms[uniformName(key)] = mapped;
  }
  return uniforms;
}

/** Builds one Filter per pass `index` (0-based) out of `def.passes` (defaults to 1) for an "effect" PassSpec. Each pass gets the SAME sampled `pass.uniforms`, PLUS a per-pass `uDirection` override — see `directionForPass`'s doc — which is how a separable multi-pass effect (blur: horizontal then vertical) differentiates its passes; a single-pass effect's shader simply never reads `uDirection`, so the override is harmless to include unconditionally. */
function buildEffectFilters(pass: PassSpec): Filter[] {
  const def = effectRegistry.tryGet(pass.ref);
  if (!def) return []; // not yet implemented — see resolvePass's doc.

  const program = getEffectProgram(def);
  if (!program) return []; // GlProgram construction failed (headless test env) — see getIdentityProgram's doc.

  const props = pass.uniforms && typeof pass.uniforms === "object" && !Array.isArray(pass.uniforms) ? pass.uniforms : {};
  const baseUniforms = buildEffectUniforms(props as Record<string, Json>);

  const passCount = def.passes ?? 1;
  const filters: Filter[] = [];
  for (let index = 0; index < passCount; index++) {
    const uniforms = { ...baseUniforms, uDirection: directionForPass(index, passCount) };
    filters.push(new Filter({ glProgram: program, resources: { effectUniforms: uniforms } }));
  }
  return filters;
}

/**
 * Per-pass direction override for a separable multi-pass effect (blur's
 * `passes: 2`): pass 0 -> horizontal (1,0), pass 1 -> vertical (0,1). A
 * single-pass effect (`passCount === 1`) never actually reads `uDirection`
 * in its shader, so this returns an arbitrary-but-harmless (0,0) for that
 * case — included unconditionally rather than branching on `passCount`
 * here, since a uniform a shader doesn't declare/use is simply ignored by
 * the GL driver, keeping `buildEffectFilters` itself effect-agnostic
 * (it doesn't need to know WHICH effects care about direction).
 * Effects needing more than 2 distinct per-pass directions don't exist
 * yet — extend this (or replace it with a per-effect callback on
 * `EffectDef`) if one ever does.
 */
function directionForPass(index: number, passCount: number): { value: [number, number]; type: string } {
  if (passCount <= 1) return { value: [0, 0], type: "vec2<f32>" };
  return { value: index === 0 ? [1, 0] : [0, 1], type: "vec2<f32>" };
}

/**
 * Resolves one `PassSpec` to zero or more compiled `Filter`s (zero if
 * `ref` isn't recognized yet, or `def.passes` for a multi-pass effect) —
 * the renderer should skip an unrecognized pass rather than throw (it's
 * "not implemented yet," not a corrupt document; this also keeps a Phase
 * 1 RenderTree, which never has `effectGroup`s, fully unaffected, and
 * lets a project reference a not-yet-implemented effect without crashing
 * the whole frame). Returns an array (not `Filter | null`) specifically
 * so a SINGLE `PassSpec` can expand into MULTIPLE sequential
 * `container.filters` entries for a separable multi-pass effect (blur's
 * horizontal-then-vertical) — Pixi runs each entry in `filters` as its own
 * sequential render-to-texture pass, feeding one's output into the next's
 * input automatically (the same mechanism Pixi's own bundled multi-pass
 * filters rely on).
 */
export function resolvePass(pass: PassSpec): Filter[] {
  if (pass.ref === "identity") {
    const program = getIdentityProgram();
    return program ? [new Filter({ glProgram: program, resources: {} })] : [];
  }
  if (pass.kind === "effect") {
    return buildEffectFilters(pass);
  }
  // Week 3-4: "transition" passes need a two-texture pass mechanism not yet built — see module doc.
  // Week 5-6: "mask" / "matte" / "adjustment" passes.
  return [];
}
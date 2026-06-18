// packages/renderer-webgl/src/passes/transition-resolver.ts
//
// Resolves a "transitionGroup" RenderNode (contract — see its doc) to a
// real, drawable result: a `Filter` that reads the "from" side as its
// implicit input texture (the standard single-input Filter contract every
// effect already uses) and the "to" side as an ADDED resource — a second,
// independently pre-rendered texture supplied by the caller
// (scene-graph.ts's `reconcileTransitionGroup`, which actually performs
// the render-to-texture step via the real Pixi Renderer).
//
// WHY A FILTER, NOT A CUSTOM MESH: a `Mesh` with a from-scratch shader
// bypasses Pixi's automatic global/local-uniform (projection + transform)
// wiring entirely (GlMeshAdaptor.mjs: `if (!shader.glProgram) { warn(...);
// return }` — a custom glProgram skips ALL of Pixi's own
// localUniformBitGl/textureBitGl setup), which is real, easy-to-get-wrong
// surface this codebase has no way to verify against a real GL context.
// A `Filter` reuses the EXACT vertex stage (DEFAULT_VERTEX, pass-resolver.ts)
// and uniform-resource mechanism (Shader's constructor: passing only
// `resources`, no `groups`, auto-assigns every key a bind slot under
// group 99 by NAME — confirmed by reading Shader.mjs directly) every
// shipped effect already relies on. The only difference from a normal
// effect Filter is one extra named resource (`uTo`, a real
// `Texture`/`RenderTexture` — `Texture.source` exists, so the
// auto-UniformGroup-wrap check in Shader's constructor correctly skips it
// and binds it as a texture sampler instead).

import { Filter, GlProgram } from "pixi.js";
import type { Texture } from "pixi.js";
import type { Json } from "contract";
import { TransitionRegistry, registerBuiltinTransitions } from "effects";
import type { TransitionDef } from "effects";
import { DEFAULT_VERTEX, buildEffectUniforms } from "./pass-resolver";

/** Exposed so a fitness-gate test can register into the SAME registry resolveTransitionFilter reads — mirrors pass-resolver.ts's `effectRegistry` export for the identical reason. */
export const transitionRegistry = new TransitionRegistry();
registerBuiltinTransitions(transitionRegistry);

const transitionPrograms = new Map<string, GlProgram | null>();

/** Same lazy/failure-tolerant pattern as pass-resolver.ts's `getEffectProgram` — each transition's GlProgram only compiles once. */
function getTransitionProgram(def: TransitionDef): GlProgram | undefined {
  if (transitionPrograms.has(def.preset)) return transitionPrograms.get(def.preset) ?? undefined;
  try {
    const program = new GlProgram({ vertex: DEFAULT_VERTEX, fragment: def.glsl, name: `seabytes-transition-${def.preset}` });
    transitionPrograms.set(def.preset, program);
    return program;
  } catch {
    transitionPrograms.set(def.preset, null);
    return undefined;
  }
}

/**
 * Builds a real, compiled `Filter` for a "transitionGroup" — applied to
 * the FROM side's Container (so Pixi's implicit `uTexture` resource is
 * the "from" content, matching every transition's GLSL convention:
 * `uniform sampler2D uFrom` reads the filter's own input — see
 * pass-resolver.ts's `buildEffectFilters` doc on the same implicit-input
 * convention). `toTexture` is the TO side's already-rendered
 * `RenderTexture` (produced by the caller via a real `renderer.render()`
 * call this module never performs itself — kept GL-context-construction
 * concerns in scene-graph.ts, mirroring pass-resolver.ts's own
 * separation). Returns `undefined` if the transition isn't registered or
 * `GlProgram` construction fails (headless test env — same degrade-
 * gracefully pattern every other pass resolver in this package uses).
 */
export function resolveTransitionFilter(ref: string, uniforms: Json, progress: number, toTexture: Texture): Filter | undefined {
  const def = transitionRegistry.tryGet(ref);
  if (!def) return undefined;

  const program = getTransitionProgram(def);
  if (!program) return undefined;

  const props = uniforms && typeof uniforms === "object" && !Array.isArray(uniforms) ? uniforms : {};
  const transitionUniforms = buildEffectUniforms(props as Record<string, Json>);
  transitionUniforms.uProgress = { value: progress, type: "f32" };

  return new Filter({ glProgram: program, resources: { transitionUniforms, uTo: toTexture } });
}
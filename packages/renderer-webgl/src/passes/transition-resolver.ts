// packages/renderer-webgl/src/passes/transition-resolver.ts
//
// Resolves a transitionGroup RenderNode to a Pixi Filter.
//
// KEY DESIGN: Filters are CACHED per transition preset — one Filter instance
// per active transitionGroup, reused across frames with uniforms updated
// in-place. Creating new Filter() every frame means uProgress is never
// uploaded (Pixi uploads uniforms on the tick AFTER the filter is set; a
// new Filter each frame resets that cycle before the upload happens).
// Cached filters avoid this entirely: the first frame creates and uploads,
// subsequent frames mutate the existing uniform values directly.

import { Filter, GlProgram } from "pixi.js";
import type { Texture } from "pixi.js";
import type { Json } from "contract";
import { TransitionRegistry, registerBuiltinTransitions } from "effects";
import type { TransitionDef } from "effects";
import { DEFAULT_VERTEX, buildEffectUniforms } from "./pass-resolver";

export const transitionRegistry = new TransitionRegistry();
registerBuiltinTransitions(transitionRegistry);

const transitionPrograms = new Map<string, GlProgram | null>();

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

/** Cached Filter state per transitionGroup node id. */
interface FilterCache {
  preset: string;
  filter: Filter;
  progressUniforms: Record<string, { value: unknown; type: string }>;
  effectUniforms: Record<string, { value: unknown; type: string }>;
}

const filterCache = new Map<string, FilterCache>();

/**
 * Returns a Filter for the given transitionGroup — reusing a cached one if
 * the preset hasn't changed, updating uniforms in-place each frame.
 *
 * `nodeId` is the transitionGroup's node id, used as the cache key so each
 * active transition gets its own Filter instance (multiple simultaneous
 * transitions each need their own uTo texture and progress value).
 */
export function resolveTransitionFilter(
  nodeId: string,
  ref: string,
  uniforms: Json,
  progress: number,
  toTexture: Texture
): Filter | undefined {
  const def = transitionRegistry.tryGet(ref);
  if (!def) return undefined;

  const program = getTransitionProgram(def);
  if (!program) return undefined;

  const props = uniforms && typeof uniforms === "object" && !Array.isArray(uniforms)
    ? uniforms as Record<string, Json>
    : {};

  let cached = filterCache.get(nodeId);

  // Create a new Filter if this is the first frame or the preset changed
  if (!cached || cached.preset !== ref) {
    const effectUniforms = buildEffectUniforms(props);
    const progressUniforms: Record<string, { value: unknown; type: string }> = {
      uProgress: { value: progress, type: "f32" },
    };

    const resources: Record<string, unknown> = { progressUniforms, uTo: toTexture };
    if (Object.keys(effectUniforms).length > 0) resources.effectUniforms = effectUniforms;

    const filter = new Filter({ glProgram: program, resources });
    cached = { preset: ref, filter, progressUniforms, effectUniforms };
    filterCache.set(nodeId, cached);
  } else {
    // Reuse existing Filter — update uProgress in the existing UniformGroup
    // and call .update() so Pixi re-uploads to GPU this frame.
    const resources = cached.filter.resources as Record<string, unknown>;
    const pg = resources.progressUniforms as { uniforms?: Record<string, unknown>; update?: () => void } | undefined;
    if (pg?.uniforms) {
      pg.uniforms.uProgress = progress;
      pg.update?.();
    }

    // Update uTo texture reference in case it changed
    resources.uTo = toTexture;
  }

  return cached.filter;
}

/** Called by SceneGraphAdapter when a transitionGroup is destroyed — cleans up its cached Filter. */
export function destroyTransitionFilter(nodeId: string): void {
  const cached = filterCache.get(nodeId);
  if (cached) {
    cached.filter.destroy();
    filterCache.delete(nodeId);
  }
}
// packages/effects/src/registry.ts
//
// Mirrors core's NodeKindRegistry pattern (Phase 2 §6, verbatim shape).
// `EffectDef`/`TransitionDef` ship GLSL + a Zod param schema as DATA —
// `effects` never imports a renderer (dep-cruiser.cjs's
// "effects-no-renderer-webgl" rule); `renderer-webgl/passes/pass-resolver.ts`
// is the one place a `def.glsl` string becomes a compiled Filter.

import type { ZodType } from "zod";
import type { ChannelSpec, InspectorField } from "core";

export type EffectCategory = "blur" | "color" | "stylize" | "distort" | "overlay";

export interface EffectDef {
  /** Registry key — matches `EffectRef.effect` (core/types/effect.ts) and a PassSpec's `ref`. */
  effect: string;
  displayName: string;
  category: EffectCategory;
  schema: {
    /** Validates an `EffectRef.props` object for this effect. */
    props: ZodType;
    /** Which of this effect's props can be keyframed — same shape NodeKind.schema.channels uses, so the curve editor (§9, P2 Week 9) needs no effect-specific logic. */
    channels: ChannelSpec[];
    /** Auto-renders the effect-stack panel's controls — same InspectorField shape InspectorPanel.tsx already uses for node props ("the inspector is free", §6). */
    inspector: InspectorField[];
  };
  /** Fragment shader source; uniforms are derived from `props`/`channels` (sampled values become uniform values 1:1 by name). */
  glsl: string;
  /** Multi-pass effects (e.g. separable blur: horizontal then vertical) — defaults to 1 if omitted. */
  passes?: number;
}

export interface TransitionDef {
  /** Registry key — matches `TransitionRef.preset` and a PassSpec's `ref`. */
  preset: string;
  displayName: string;
  /** Signature: `vec4 trans(sampler2D from, sampler2D to, float progress)` — the renderer supplies `from`/`to`/`progress` as uniforms; this string is just the function body's containing shader. */
  glsl: string;
  schema: {
    props: ZodType;
    inspector: InspectorField[];
  };
}

/** Thrown by `EffectRegistry.get`/`TransitionRegistry.get` for an unknown key — mirrors `NodeKindRegistry`'s same-shaped error (registry.ts, core). */
export class UnknownEffectError extends Error {
  constructor(effect: string) {
    super(`Unknown effect: "${effect}"`);
    this.name = "UnknownEffectError";
  }
}

export class UnknownTransitionError extends Error {
  constructor(preset: string) {
    super(`Unknown transition: "${preset}"`);
    this.name = "UnknownTransitionError";
  }
}

export class EffectRegistry {
  private defs = new Map<string, EffectDef>();

  register(def: EffectDef): void {
    this.defs.set(def.effect, def);
  }

  get(effect: string): EffectDef {
    const def = this.defs.get(effect);
    if (!def) throw new UnknownEffectError(effect);
    return def;
  }

  /** Like `get`, but returns `undefined` instead of throwing — for callers that should degrade gracefully (e.g. `resolvePass` skipping a not-yet-implemented effect rather than crashing a frame). */
  tryGet(effect: string): EffectDef | undefined {
    return this.defs.get(effect);
  }

  list(): EffectDef[] {
    return [...this.defs.values()];
  }
}

export class TransitionRegistry {
  private defs = new Map<string, TransitionDef>();

  register(def: TransitionDef): void {
    this.defs.set(def.preset, def);
  }

  get(preset: string): TransitionDef {
    const def = this.defs.get(preset);
    if (!def) throw new UnknownTransitionError(preset);
    return def;
  }

  tryGet(preset: string): TransitionDef | undefined {
    return this.defs.get(preset);
  }

  list(): TransitionDef[] {
    return [...this.defs.values()];
  }
}
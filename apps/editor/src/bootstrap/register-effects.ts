// apps/editor/src/bootstrap/register-effects.ts
import { EffectRegistry, TransitionRegistry } from "effects";
import { registerBuiltinEffects, registerBuiltinTransitions } from "effects";

/**
 * Creates a fresh EffectRegistry with all Phase 2 builtin effects
 * registered. Called once per app instance (main.tsx) — same "fresh
 * instance, not a module-level singleton" reasoning as
 * `register-kinds.ts`'s `createRegistry` (SSR/tests/render-worker each
 * need their own).
 */
export function createEffectRegistry(): EffectRegistry {
  const registry = new EffectRegistry();
  registerBuiltinEffects(registry);
  return registry;
}

/** Same "fresh instance per app" reasoning as `createEffectRegistry` — used by `TransitionPanel` to list available transitions for the "apply transition" picker. */
export function createTransitionRegistry(): TransitionRegistry {
  const registry = new TransitionRegistry();
  registerBuiltinTransitions(registry);
  return registry;
}
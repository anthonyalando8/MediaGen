// apps/editor/src/bootstrap/register-effects.ts
import { EffectRegistry } from "effects";
import { registerBuiltinEffects } from "effects";

/**
 * Creates a fresh EffectRegistry with all Phase 2 builtin effects
 * registered. Called once per app instance (main.tsx) — same "fresh
 * instance, not a module-level singleton" reasoning as
 * `register-kinds.ts`'s `createRegistry` (SSR/tests/render-worker each
 * need their own). TransitionRegistry isn't created here yet — no UI or
 * evaluator path consumes transitions until the transition rendering
 * mechanism (deferred, see renderer-webgl/passes/pass-resolver.ts's doc)
 * is designed.
 */
export function createEffectRegistry(): EffectRegistry {
  const registry = new EffectRegistry();
  registerBuiltinEffects(registry);
  return registry;
}
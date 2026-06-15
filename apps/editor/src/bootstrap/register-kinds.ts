// apps/editor/src/bootstrap/register-kinds.ts
import { NodeKindRegistry } from "core";
import { registerBuiltins } from "nodekinds";

/**
 * Creates a fresh NodeKindRegistry with all Phase 1 kinds registered. Called
 * once per app instance (main.tsx) — and again, independently, in the render
 * worker. NOT a module-level singleton (see core/src/registry/registry.ts):
 * that would break SSR, tests, and the render worker, which each need their
 * own instance.
 */
export function createRegistry(): NodeKindRegistry {
  const registry = new NodeKindRegistry();
  registerBuiltins(registry);
  return registry;
}
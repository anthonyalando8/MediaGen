// apps/editor/src/bootstrap/registry-context.tsx
import { createContext, useContext } from "react";
import type { NodeKindRegistry } from "core";

const RegistryContext = createContext<NodeKindRegistry | null>(null);

/** Provides the single NodeKindRegistry instance created in main.tsx (see register-kinds.ts). */
export const RegistryProvider = RegistryContext.Provider;

export function useRegistry(): NodeKindRegistry {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error("useRegistry() called outside <RegistryProvider>");
  return registry;
}
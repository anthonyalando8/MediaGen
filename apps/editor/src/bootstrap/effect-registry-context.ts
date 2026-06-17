// apps/editor/src/bootstrap/effect-registry-context.tsx
import { createContext, useContext } from "react";
import type { EffectRegistry } from "effects";

const EffectRegistryContext = createContext<EffectRegistry | null>(null);

/** Provides the single EffectRegistry instance created in main.tsx (see register-effects.ts). */
export const EffectRegistryProvider = EffectRegistryContext.Provider;

export function useEffectRegistry(): EffectRegistry {
  const registry = useContext(EffectRegistryContext);
  if (!registry) throw new Error("useEffectRegistry() called outside <EffectRegistryProvider>");
  return registry;
}
// apps/editor/src/bootstrap/transition-registry-context.tsx
import { createContext, useContext } from "react";
import type { TransitionRegistry } from "effects";

const TransitionRegistryContext = createContext<TransitionRegistry | null>(null);

/** Provides the single TransitionRegistry instance created in main.tsx (see register-effects.ts's `createTransitionRegistry`). */
export const TransitionRegistryProvider = TransitionRegistryContext.Provider;

export function useTransitionRegistry(): TransitionRegistry {
  const registry = useContext(TransitionRegistryContext);
  if (!registry) throw new Error("useTransitionRegistry() called outside <TransitionRegistryProvider>");
  return registry;
}
// apps/editor/src/store/context.tsx
import { createContext, useContext } from "react";
import type { EditorState, EditorStore } from "./index";

const StoreContext = createContext<EditorStore | null>(null);

/** Provides the single EditorStore instance created in main.tsx. */
export const StoreProvider = StoreContext.Provider;

function useStoreApi(): EditorStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useEditorStore() called outside <StoreProvider>");
  return store;
}

/** Subscribes a component to `selector(state)` — re-renders only when its result changes. */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStoreApi()(selector);
}

/**
 * The store hook itself — `.getState()` for one-off reads (e.g. inside the
 * RAF loop or an event handler) without subscribing to re-renders.
 */
export function useEditorStoreApi(): EditorStore {
  return useStoreApi();
}
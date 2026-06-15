// apps/editor/src/index.ts
//
// The editor app (Vite + React). `main.tsx` is the Vite entry point; this
// barrel re-exports the non-UI pieces (store, selectors, commands,
// bootstrap) for testing and reuse (e.g. by the render worker).
export * from "./store";
export * from "./bootstrap/create-project";
export * from "./bootstrap/register-kinds";
export * from "./commands/add-node";
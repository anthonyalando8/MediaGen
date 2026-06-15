// apps/editor/src/main.tsx
import { createRoot } from "react-dom/client";
// @ts-ignore CSS side-effect import type declarations are handled by the bundler.
import "./styles/theme.css";

import { createBlankProject } from "./bootstrap/create-project";
import { createRegistry } from "./bootstrap/register-kinds";
import { RegistryProvider } from "./bootstrap/registry-context";
import { loadProject, saveProject } from "./persistence/local-storage";
import { createEditorStore } from "./store";
import { StoreProvider } from "./store/context";
import { App } from "./components/App";

const registry = createRegistry();

// Exit criterion 10: "User reloads; project persists and re-renders
// identically." `loadProject()` validates against ProjectSchema and returns
// `undefined` on first run / corrupt / schema-invalid data, in which case we
// fall back to a fresh blank project.
const store = createEditorStore(loadProject() ?? createBlankProject());

// Auto-save on every Tier 1 (document) change. `document.project` is only
// replaced by reference on apply/undo/redo (Tier 1) — Tier 3 changes
// (selection/playback/ui, which fire far more often, e.g. every RAF frame
// while playing) leave it untouched, so this reference check is sufficient
// to avoid redundant writes.
let lastProject = store.getState().document.project;
store.subscribe((state) => {
  if (state.document.project !== lastProject) {
    lastProject = state.document.project;
    saveProject(lastProject);
  }
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error('main.tsx: no element with id="root" found');

createRoot(rootEl).render(
  <RegistryProvider value={registry}>
    <StoreProvider value={store}>
      <App />
    </StoreProvider>
  </RegistryProvider>
);
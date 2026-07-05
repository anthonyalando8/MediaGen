// apps/editor/src/main.tsx
//
// Only change vs. the original: import the new `inspector-tabs.css` AFTER
// workspace.css so the menubar / tab / status-bar chrome layers on top.
// Everything else (registries, store, auto-save subscription, providers) is
// untouched — copy this file or just add the one import line.

import { createRoot } from "react-dom/client";
// @ts-ignore CSS side-effect import type declarations are handled by the bundler.

import "./styles/theme.css";
// @ts-ignore
import "./styles/workspace.css"; // workspace ergonomics layer (must load after theme.css)
// @ts-ignore
import "./styles/inspector-tabs.css"; // menubar + tabbed inspector + status bar (load last)
// @ts-ignore
import "./styles/span-anim.css"; // per-span text animation panel
// @ts-ignore
import "./styles/text-effects.css"; // per-span text visual effects panel
// @ts-ignore
import "./styles/range-slider.css"; // polished bounded numeric slider
// @ts-ignore
import "./styles/audio.css"; // audio upload panel, timeline rows, inspector
// @ts-ignore
import "./styles/audio-timeline.css";
// @ts-ignore
import "./styles/viewport-backdrop.css";
// @ts-ignore
import "./styles/effects-panel.css";
// @ts-ignore
import "./styles/left-tabs.css";
// @ts-ignore
import "./styles/timeline-playhead.css";
import { createBlankProject } from "./bootstrap/create-project";
import { createRegistry } from "./bootstrap/register-kinds";
import { RegistryProvider } from "./bootstrap/registry-context";
import { createEffectRegistry, createTransitionRegistry } from "./bootstrap/register-effects";
import { EffectRegistryProvider } from "./bootstrap/effect-registry-context";
import { TransitionRegistryProvider } from "./bootstrap/transition-registry-context";
import { loadProject, saveProject } from "./persistence/local-storage";
import { createEditorStore } from "./store";
import { StoreProvider } from "./store/context";
import { App } from "./components/App";

const registry = createRegistry();
const effectRegistry = createEffectRegistry();
const transitionRegistry = createTransitionRegistry();

const store = createEditorStore(loadProject() ?? createBlankProject());

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
    <EffectRegistryProvider value={effectRegistry}>
      <TransitionRegistryProvider value={transitionRegistry}>
        <StoreProvider value={store}>
          <App />
        </StoreProvider>
      </TransitionRegistryProvider>
    </EffectRegistryProvider>
  </RegistryProvider>
);
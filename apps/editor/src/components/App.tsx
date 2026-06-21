// apps/editor/src/components/App.tsx
import { useState } from "react";
import { Header } from "./Header";
import { Toolbar } from "./Toolbar";
import { LayerPanel } from "./LayerPanel";
import { Viewport } from "./Viewport";
import { ViewportHud } from "./ViewportHud";
import { InspectorPanel } from "./InspectorPanel";
import { TimelinePlaceholder } from "./TimelinePlaceholder";
import { useUndoRedoShortcuts } from "../store/use-undo-redo-shortcuts";
import { useDeleteShortcut } from "../store/use-delete-shortcut";

type Theme = "dark" | "light";

/**
 * The editor shell (Deliverable 09 §9.1). Pure layout — all *document* state
 * still lives in the store (Tier 1/2/3); panels are thin and re-render only
 * on selection/document change. <Viewport>'s render loop stays outside React
 * (see store/index.ts and Viewport.tsx).
 *
 * UI/UX redesign: the old single toolbar is split into a top <Header>
 * (brand · project · theme · export) and an action <Toolbar> (insert ·
 * arrange · tools · history). `theme` is the only new state and is pure
 * view-state (a `data-theme` flag the stylesheet keys off) — it touches no
 * document/store logic. Visual structure lives in styles/theme.css.
 */
export function App() {
  useUndoRedoShortcuts();
  useDeleteShortcut();

  const [theme, setTheme] = useState<Theme>("dark");

  return (
    <div className="app-shell" data-theme={theme}>
      <div className="app-shell__span">
        <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
      </div>
      <div className="app-shell__span">
        <Toolbar />
      </div>
      <LayerPanel />
      <div className="app-shell__viewport">
        <Viewport />
        <ViewportHud />
      </div>
      <InspectorPanel />
      <div className="app-shell__span">
        <TimelinePlaceholder />
      </div>
    </div>
  );
}

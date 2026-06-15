// apps/editor/src/components/App.tsx
import { Toolbar } from "./Toolbar";
import { LayerPanel } from "./LayerPanel";
import { Viewport } from "./Viewport";
import { InspectorPanel } from "./InspectorPanel";
import { TimelinePlaceholder } from "./TimelinePlaceholder";
import { useUndoRedoShortcuts } from "../store/use-undo-redo-shortcuts";
import { useDeleteShortcut } from "../store/use-delete-shortcut";

/**
 * The editor shell (Deliverable 09 §9.1). Pure layout — all state lives in
 * the store (Tier 1/2/3); panels are thin and re-render only on
 * selection/document change. <Viewport>'s render loop stays outside React
 * (see store/index.ts and Viewport.tsx). Visual structure (grid, panel
 * chrome, form controls) lives in styles/theme.css.
 */
export function App() {
  useUndoRedoShortcuts();
  useDeleteShortcut();

  return (
    <div className="app-shell">
      <div className="app-shell__span">
        <Toolbar />
      </div>
      <LayerPanel />
      <div className="app-shell__viewport">
        <Viewport />
      </div>
      <InspectorPanel />
      <div className="app-shell__span">
        <TimelinePlaceholder />
      </div>
    </div>
  );
}
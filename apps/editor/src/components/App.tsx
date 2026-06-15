// apps/editor/src/components/App.tsx
import { Toolbar } from "./Toolbar";
import { LayerPanel } from "./LayerPanel";
import { Viewport } from "./Viewport";
import { InspectorPanel } from "./InspectorPanel";
import { TimelinePlaceholder } from "./TimelinePlaceholder";
import { useUndoRedoShortcuts } from "../store/use-undo-redo-shortcuts";

/**
 * The editor shell (Deliverable 09 §9.1). Pure layout — all state lives in
 * the store (Tier 1/2/3); panels are thin and re-render only on
 * selection/document change. <Viewport>'s render loop stays outside React
 * (see store/index.ts and Viewport.tsx).
 */
export function App() {
  useUndoRedoShortcuts();

  return (
    <div
      style={{
        display: "grid",
        height: "100%",
        width: "100%",
        gridTemplateColumns: "240px 1fr 280px",
        gridTemplateRows: "auto 1fr auto",
      }}
    >
      <div style={{ gridColumn: "1 / -1" }}>
        <Toolbar />
      </div>
      <LayerPanel />
      <div style={{ position: "relative" }}>
        <Viewport />
      </div>
      <InspectorPanel />
      <div style={{ gridColumn: "1 / -1" }}>
        <TimelinePlaceholder />
      </div>
    </div>
  );
}
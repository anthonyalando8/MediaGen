// apps/editor/src/components/App.tsx
import { useCallback, useEffect, useState } from "react";
import { Header } from "./Header";
import { Toolbar } from "./Toolbar";
import { LayerPanel } from "./LayerPanel";
import { Viewport } from "./Viewport";
import { ViewportStatusBar } from "./ViewportStatusBar";
import { InspectorPanel } from "./InspectorPanel";
import { TimelinePlaceholder } from "./TimelinePlaceholder";
import { useUndoRedoShortcuts } from "../store/use-undo-redo-shortcuts";
import { useDeleteShortcut } from "../store/use-delete-shortcut";
import { useEditorStore, useEditorStoreApi } from "../store/context";

type Theme = "dark" | "light";

const THEME_KEY = "seabytes.theme.v1";
const DIVIDER = 6; // px — width/height of the resize handles

function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/**
 * The editor shell (Deliverable 09 §9.1). Pure layout — all *document* state
 * still lives in the store (Tier 1/2/3); panels are thin and re-render only
 * on selection/document change. <Viewport>'s render loop stays outside React.
 *
 * Workspace ergonomics pass: the shell's CSS grid is now driven by Tier-3 UI
 * state (panel widths/height + collapsed flags in store/ui.ts), and the gaps
 * between panels are draggable <ShellDivider>s (drag to resize · double-click
 * to collapse). The Toolbar's View cluster collapses panels and applies
 * Edit/Preview/Focus presets. Zoom moved off the canvas into <ViewportStatusBar>.
 * `theme` and all workspace state persist to localStorage. No document/store
 * logic changes — only `data-theme` (view flag) and the new Tier-3 UI slice.
 */
export function App() {
  useUndoRedoShortcuts();
  useDeleteShortcut();

  const store = useEditorStoreApi();
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const leftWidth = useEditorStore((s) => s.leftWidth);
  const rightWidth = useEditorStore((s) => s.rightWidth);
  const timelineHeight = useEditorStore((s) => s.timelineHeight);
  const leftCollapsed = useEditorStore((s) => s.leftCollapsed);
  const rightCollapsed = useEditorStore((s) => s.rightCollapsed);
  const timelineCollapsed = useEditorStore((s) => s.timelineCollapsed);

  const startVDrag = useCallback(
    (panel: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const start = panel === "left" ? store.getState().leftWidth : store.getState().rightWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = panel === "left" ? ev.clientX - startX : startX - ev.clientX;
        store.getState().setPanelSize(panel, start + delta);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [store]
  );

  const startHDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const start = store.getState().timelineHeight;
      const onMove = (ev: MouseEvent) => {
        store.getState().setPanelSize("timeline", start + (startY - ev.clientY));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [store]
  );

  // Columns: [left] [v-divider] [viewport] [v-divider] [right]
  // Rows:    [header] [toolbar] [middle] [h-divider] [timeline]
  // A collapsed panel (and its divider) shrink to 0; minmax(0,1fr) lets the
  // viewport take all remaining space and shrink last when room is tight.
  const gridTemplateColumns = `${leftCollapsed ? 0 : leftWidth}px ${leftCollapsed ? 0 : DIVIDER}px minmax(0, 1fr) ${rightCollapsed ? 0 : DIVIDER}px ${rightCollapsed ? 0 : rightWidth}px`;
  const gridTemplateRows = `auto auto minmax(0, 1fr) ${timelineCollapsed ? 0 : DIVIDER}px ${timelineCollapsed ? 0 : timelineHeight}px`;

  return (
    <div className="app-shell" data-theme={theme} style={{ gridTemplateColumns, gridTemplateRows }}>
      <div className="app-shell__span">
        <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
      </div>
      <div className="app-shell__span">
        <Toolbar />
      </div>

      <LayerPanel />
      <div
        className={`shell-divider shell-divider--v${leftCollapsed ? " shell-divider--hidden" : ""}`}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · double-click to collapse"
        onMouseDown={startVDrag("left")}
        onDoubleClick={() => store.getState().togglePanel("left")}
      />
      <div className="app-shell__viewport">
        <div className="viewport-stage">
          <Viewport />
        </div>
        <ViewportStatusBar />
      </div>
      <div
        className={`shell-divider shell-divider--v${rightCollapsed ? " shell-divider--hidden" : ""}`}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · double-click to collapse"
        onMouseDown={startVDrag("right")}
        onDoubleClick={() => store.getState().togglePanel("right")}
      />
      <InspectorPanel />

      <div
        className={`shell-divider shell-divider--h app-shell__span${timelineCollapsed ? " shell-divider--hidden" : ""}`}
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize · double-click to collapse"
        onMouseDown={startHDrag}
        onDoubleClick={() => store.getState().togglePanel("timeline")}
      />
      <div className="app-shell__span">
        <TimelinePlaceholder />
      </div>
    </div>
  );
}

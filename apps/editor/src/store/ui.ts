// apps/editor/src/store/ui.ts
//
// Tier 3 · EPHEMERAL (Deliverable 09 §9.2). Viewport zoom plus the editor
// WORKSPACE state — panel widths/height + collapsed flags. This is the spot
// the original file reserved ("panel sizes, grid/snap toggles ... joins here
// in later weeks without touching Tier 1/2"); it does exactly that.
//
// Workspace state is persisted to localStorage (a small, self-contained key,
// independent of the Tier-1 document save in main.tsx) so panel sizes and
// collapsed state survive reloads — per the UI/UX workspace-management pass.
// NO Tier 1/2 logic is touched.

import type { StateCreator } from "zustand";
import type { EditorState } from "./index";

export type WorkspacePanel = "left" | "right" | "timeline";
export type WorkspaceMode = "edit" | "preview" | "focus";

export interface UiSlice {
  /** Canvas zoom (existing) — clamped 0.1–8, consumed by <Viewport>'s fit transform. */
  zoom: number;
  setZoom(zoom: number): void;

  /** Workspace — panel sizing & visibility (view-only). */
  leftWidth: number;
  rightWidth: number;
  timelineHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  timelineCollapsed: boolean;

  /** Set a panel's pixel size (clamped). Re-expands the panel if it was collapsed. */
  setPanelSize(panel: WorkspacePanel, size: number): void;
  /** Show/hide a panel. */
  togglePanel(panel: WorkspacePanel): void;
  /** Apply a workspace preset (Editing / Preview / Focus). */
  setWorkspaceMode(mode: WorkspaceMode): void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export const PANEL_LIMITS = {
  left: { min: 180, max: 560, default: 274 },
  right: { min: 180, max: 560, default: 322 },
  timeline: { min: 120, max: 620, default: 288 },
} as const;

const WS_KEY = "seabytes.workspace.v1";

interface WorkspaceState {
  leftWidth: number;
  rightWidth: number;
  timelineHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  timelineCollapsed: boolean;
}

const WS_DEFAULTS: WorkspaceState = {
  leftWidth: PANEL_LIMITS.left.default,
  rightWidth: PANEL_LIMITS.right.default,
  timelineHeight: PANEL_LIMITS.timeline.default,
  leftCollapsed: false,
  rightCollapsed: false,
  timelineCollapsed: false,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

function loadWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(WS_KEY);
    if (!raw) return { ...WS_DEFAULTS };
    const p = JSON.parse(raw) as Partial<WorkspaceState>;
    return {
      leftWidth: clamp(Number(p.leftWidth ?? WS_DEFAULTS.leftWidth), PANEL_LIMITS.left.min, PANEL_LIMITS.left.max),
      rightWidth: clamp(Number(p.rightWidth ?? WS_DEFAULTS.rightWidth), PANEL_LIMITS.right.min, PANEL_LIMITS.right.max),
      timelineHeight: clamp(Number(p.timelineHeight ?? WS_DEFAULTS.timelineHeight), PANEL_LIMITS.timeline.min, PANEL_LIMITS.timeline.max),
      leftCollapsed: Boolean(p.leftCollapsed ?? false),
      rightCollapsed: Boolean(p.rightCollapsed ?? false),
      timelineCollapsed: Boolean(p.timelineCollapsed ?? false),
    };
  } catch {
    return { ...WS_DEFAULTS };
  }
}

function saveWorkspace(ws: WorkspaceState): void {
  try {
    localStorage.setItem(WS_KEY, JSON.stringify(ws));
  } catch {
    /* storage unavailable (private mode / quota) — workspace just won't persist */
  }
}

export const createUiSlice: StateCreator<EditorState, [], [], UiSlice> = (set, get) => {
  function persist(): void {
    const s = get();
    saveWorkspace({
      leftWidth: s.leftWidth,
      rightWidth: s.rightWidth,
      timelineHeight: s.timelineHeight,
      leftCollapsed: s.leftCollapsed,
      rightCollapsed: s.rightCollapsed,
      timelineCollapsed: s.timelineCollapsed,
    });
  }

  return {
    zoom: 1,
    setZoom(zoom) {
      set({ zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) });
    },

    ...loadWorkspace(),

    setPanelSize(panel, size) {
      const lim = PANEL_LIMITS[panel];
      const v = clamp(size, lim.min, lim.max);
      if (panel === "left") set({ leftWidth: v, leftCollapsed: false });
      else if (panel === "right") set({ rightWidth: v, rightCollapsed: false });
      else set({ timelineHeight: v, timelineCollapsed: false });
      persist();
    },

    togglePanel(panel) {
      if (panel === "left") set((s) => ({ leftCollapsed: !s.leftCollapsed }));
      else if (panel === "right") set((s) => ({ rightCollapsed: !s.rightCollapsed }));
      else set((s) => ({ timelineCollapsed: !s.timelineCollapsed }));
      persist();
    },

    setWorkspaceMode(mode) {
      if (mode === "edit") set({ leftCollapsed: false, rightCollapsed: false, timelineCollapsed: false });
      else if (mode === "preview") set({ leftCollapsed: true, rightCollapsed: true, timelineCollapsed: true });
      else set({ leftCollapsed: true, rightCollapsed: true, timelineCollapsed: false });
      persist();
    },
  };
};

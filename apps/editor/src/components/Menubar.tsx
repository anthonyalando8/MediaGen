// apps/editor/src/components/Menubar.tsx
//
// Application menubar (UI/UX redesign). A thin bar that sits ABOVE the
// toolbar and consolidates the standard menus — File / Edit / View / Insert /
// Help — plus the brand mark, save indicator, theme toggle, and the headline
// Preview / Export actions. It REPLACES the old <Header>: the brand identity
// and Preview/Export affordances move here so the chrome stays two rows
// (menubar + toolbar) instead of three.
//
// Every menu item that has a backing command calls the SAME store/command
// API the old Toolbar used (addNode / appendNodeOp / groupNodes /
// ungroupNode / precompose / deleteSelection / undo / redo / setWorkspaceMode
// / togglePanel / setZoom / resetView / select). Items without an existing
// pipeline (Open / Save / Export / Cut / Copy / Paste / Duplicate / Keyboard
// Shortcuts) are intentionally inert affordances — wire them to your
// file/clipboard/export systems when they exist. No document/store logic is
// changed here.

import { useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, Moon, Play, Sun, Waves } from "lucide-react";
import type { Id, NodeKindId } from "core";
import { addNode, appendNodeOp } from "../commands/add-node";
import { groupNodes } from "../commands/group-nodes";
import { ungroupNode } from "../commands/ungroup-node";
import { precompose } from "../commands/precompose";
import { useRegistry } from "../bootstrap/registry-context";
import { deleteSelection } from "../store/delete-selection";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { exportToMp4, defaultExportDeps } from "export";
import type { ExportMediaService } from "export";

interface MenubarProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

type MenuId = "file" | "edit" | "view" | "insert" | "help";

/** A single dropdown row. `shortcut` renders right-aligned; `check` shows a
 *  leading tick (used by the View toggles). Disabled rows are inert. */
function Item({
  label,
  shortcut,
  onClick,
  disabled,
  check,
}: {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  check?: boolean;
}) {
  return (
    <button
      type="button"
      className="menubar__item"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
    >
      {check !== undefined && (
        <span className="menubar__item-check">{check && <Check size={14} />}</span>
      )}
      <span className="menubar__item-label">{label}</span>
      {shortcut && <span className="menubar__item-shortcut">{shortcut}</span>}
    </button>
  );
}

function Sep() {
  return <div className="menubar__sep" role="separator" />;
}

export function Menubar({ theme, onToggleTheme }: MenubarProps) {
  const store = useEditorStoreApi();
  const registry = useRegistry();
  const [open, setOpen] = useState<MenuId | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const [exportState, setExportState] = useState<{ inProgress: boolean; progress: number } | null>(null);

  // Selection / history / panel state for enabled-states + checkmarks.
  const canUndo = useEditorStore((s) => s.canUndo());
  const canRedo = useEditorStore((s) => s.canRedo());
  const selection = useEditorStore((s) => s.selection);
  const leftCollapsed = useEditorStore((s) => s.leftCollapsed);
  const rightCollapsed = useEditorStore((s) => s.rightCollapsed);
  const timelineCollapsed = useEditorStore((s) => s.timelineCollapsed);
  const selectedKind = useEditorStore((s) => {
    if (s.selection.length !== 1) return undefined;
    return activeComp(s).root.find((n) => n.id === s.selection[0])?.kind;
  });

  // Close on outside click / Escape.
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Run an action, then close the menu. */
  function run(fn: () => void) {
    return () => {
      fn();
      setOpen(null);
    };
  }

  // ── Export ──────────────────────────────────────────────────────────────
  //
  // Mirrors Viewport.tsx's `createMediaService` but INVERTS the proxy/master
  // preference: preview wants `proxy` (fast, low-res) while export wants
  // `master` (full quality) — see apps/api/src/transcode/worker.ts's own
  // "master — full quality, used only at export time" note, and
  // ExportMediaService's doc in the export package.
  async function handleExportVideo(): Promise<void> {
    if (exportState?.inProgress) return;
    setExportState({ inProgress: true, progress: 0 });

    try {
      const state = store.getState();
      const comp = activeComp(state);
      const assets = state.document.project.assets;

      const media: ExportMediaService = {
        resolveAsset(assetId) {
          const asset = assets.find((a) => a.id === assetId);
          if (!asset) return undefined;
          return { id: asset.id, kind: asset.kind as "image" | "video" | "audio", url: asset.master ?? asset.proxy ?? "" };
        },
      };
      const resolveAudioUrl = (assetId: string): string | undefined => assets.find((a) => a.id === assetId)?.master;

      const blob = await exportToMp4(
        {
          comp,
          registry,
          resolveAudioUrl,
          onProgress: (done, total) => setExportState({ inProgress: true, progress: done / total }),
        },
        defaultExportDeps(media)
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${comp.name || "export"}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Menubar] export failed:", err);
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportState(null);
    }
  }

  // ── Command handlers (mirror the old Toolbar) ──────────────────────────
  function handleAdd(kind: NodeKindId): void {
    const state = store.getState();
    state.apply(addNode(activeComp(state), registry, kind));
  }
  function handleAddAdjustment(): void {
    const state = store.getState();
    state.apply(appendNodeOp(activeComp(state), registry, "shape", { isAdjustment: true, name: "Adjustment" }));
  }
  function handleGroup(): void {
    const state = store.getState();
    const op = groupNodes(activeComp(state), registry, selection);
    state.apply(op);
    const after = op.after as unknown as { group: { id: Id }; at: number };
    state.select([after.group.id]);
  }
  function handleUngroup(): void {
    const state = store.getState();
    const op = ungroupNode(activeComp(state), selection[0]);
    state.apply(op);
    const before = op.before as unknown as { group: { children: { id: Id }[] }; at: number };
    state.select(before.group.children.map((c) => c.id));
  }
  function handlePrecompose(): void {
    const state = store.getState();
    const result = precompose(activeComp(state), registry, selection);
    state.addComp(result.newComp);
    state.apply(result.op);
    state.select([result.compNodeId]);
  }
  function handleSelectAll(): void {
    const state = store.getState();
    state.select(activeComp(state).root.map((n) => n.id));
  }

  const noop = () => {};

  return (
    <header className="menubar" ref={barRef}>
      <div className="menubar__brand">
        <Waves size={20} />
        <span className="menubar__brand-name">SeaBytes</span>
      </div>
      <div className="menubar__rule" />

      <nav className="menubar__menus" role="menubar">
        {/* ── File ── */}
        <div className="menubar__menu">
          <button
            type="button"
            className="menubar__btn"
            aria-expanded={open === "file"}
            aria-haspopup="menu"
            onClick={() => setOpen((o) => (o === "file" ? null : "file"))}
          >
            File
          </button>
          {open === "file" && (
            <div className="menubar__dropdown" role="menu">
              <Item label="New Project" shortcut="⌘N" onClick={run(noop)} />
              <Item label="Open…" shortcut="⌘O" onClick={run(noop)} />
              <Item label="Save" shortcut="⌘S" onClick={run(noop)} />
              <Sep />
              <Item label="Export Video…" shortcut="⌘⇧E" onClick={run(() => { void handleExportVideo(); })} disabled={exportState?.inProgress} />
              <Item label="Export Frame…" onClick={run(noop)} />
            </div>
          )}
        </div>

        {/* ── Edit ── */}
        <div className="menubar__menu">
          <button
            type="button"
            className="menubar__btn"
            aria-expanded={open === "edit"}
            aria-haspopup="menu"
            onClick={() => setOpen((o) => (o === "edit" ? null : "edit"))}
          >
            Edit
          </button>
          {open === "edit" && (
            <div className="menubar__dropdown" role="menu">
              <Item label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={run(() => store.getState().undo())} />
              <Item label="Redo" shortcut="⌘⇧Z" disabled={!canRedo} onClick={run(() => store.getState().redo())} />
              <Sep />
              <Item label="Cut" shortcut="⌘X" disabled={selection.length === 0} onClick={run(noop)} />
              <Item label="Copy" shortcut="⌘C" disabled={selection.length === 0} onClick={run(noop)} />
              <Item label="Paste" shortcut="⌘V" onClick={run(noop)} />
              <Item label="Duplicate" shortcut="⌘D" disabled={selection.length === 0} onClick={run(noop)} />
              <Item label="Delete" shortcut="⌫" disabled={selection.length === 0} onClick={run(() => deleteSelection(store))} />
              <Sep />
              <Item label="Ungroup" shortcut="⌘⇧G" disabled={selectedKind !== "group"} onClick={run(handleUngroup)} />
              <Item label="Select All" shortcut="⌘A" onClick={run(handleSelectAll)} />
            </div>
          )}
        </div>

        {/* ── View ── */}
        <div className="menubar__menu">
          <button
            type="button"
            className="menubar__btn"
            aria-expanded={open === "view"}
            aria-haspopup="menu"
            onClick={() => setOpen((o) => (o === "view" ? null : "view"))}
          >
            View
          </button>
          {open === "view" && (
            <div className="menubar__dropdown" role="menu">
              <Item label="Zoom In" shortcut="⌘+" onClick={run(() => store.getState().setZoom(store.getState().zoom * 1.2))} />
              <Item label="Zoom Out" shortcut="⌘−" onClick={run(() => store.getState().setZoom(store.getState().zoom / 1.2))} />
              <Item label="Fit to Screen" shortcut="⇧0" onClick={run(() => store.getState().resetView())} />
              <Sep />
              <Item label="Toggle Timeline" check={!timelineCollapsed} onClick={run(() => store.getState().togglePanel("timeline"))} />
              <Item label="Toggle Layers" check={!leftCollapsed} onClick={run(() => store.getState().togglePanel("left"))} />
              <Item label="Toggle Inspector" check={!rightCollapsed} onClick={run(() => store.getState().togglePanel("right"))} />
              <Sep />
              <Item label="Fullscreen Preview" shortcut="`" onClick={run(() => store.getState().setWorkspaceMode("preview"))} />
            </div>
          )}
        </div>

        {/* ── Insert ── */}
        <div className="menubar__menu">
          <button
            type="button"
            className="menubar__btn"
            aria-expanded={open === "insert"}
            aria-haspopup="menu"
            onClick={() => setOpen((o) => (o === "insert" ? null : "insert"))}
          >
            Insert
          </button>
          {open === "insert" && (
            <div className="menubar__dropdown" role="menu">
              <Item label="Shape" shortcut="R" onClick={run(() => handleAdd("shape"))} />
              <Item label="Text" shortcut="T" onClick={run(() => handleAdd("text"))} />
              <Item label="Group" shortcut="⌘G" disabled={selection.length < 2} onClick={run(handleGroup)} />
              <Item label="Null" onClick={run(() => handleAdd("null"))} />
              <Item label="Adjustment Layer" onClick={run(handleAddAdjustment)} />
              <Item label="Precomp" shortcut="⌘⇧C" disabled={selection.length === 0} onClick={run(handlePrecompose)} />
            </div>
          )}
        </div>

        {/* ── Help ── */}
        <div className="menubar__menu">
          <button
            type="button"
            className="menubar__btn"
            aria-expanded={open === "help"}
            aria-haspopup="menu"
            onClick={() => setOpen((o) => (o === "help" ? null : "help"))}
          >
            Help
          </button>
          {open === "help" && (
            <div className="menubar__dropdown" role="menu">
              <Item label="Keyboard Shortcuts" shortcut="?" onClick={run(noop)} />
            </div>
          )}
        </div>
      </nav>

      <span className="menubar__spacer" />

      <div className="menubar__saved">
        <span className="menubar__saved-dot" />
        Saved
      </div>

      <button
        className="btn btn-icon btn-outline"
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label="Toggle theme"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
      </button>

      <button className="btn btn-outline" title="Preview playback">
        <Play size={14} />
        Preview
      </button>

      <button
        className="btn btn-primary"
        title={exportState?.inProgress ? `Exporting… ${Math.round((exportState.progress ?? 0) * 100)}%` : "Export / render"}
        disabled={exportState?.inProgress}
        onClick={() => void handleExportVideo()}
      >
        {exportState?.inProgress ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
        {exportState?.inProgress ? `Exporting… ${Math.round((exportState.progress ?? 0) * 100)}%` : "Export"}
      </button>
    </header>
  );
}
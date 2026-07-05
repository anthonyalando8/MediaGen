// apps/editor/src/components/LayerPanel.tsx
//
// TABBED LEFT PANEL — drop-in replacement.
//
// The old left column stacked Media (+ its embedded audio upload) ON TOP OF
// the layer tree ON TOP OF a collapsible audio sub-list — four scrolling
// regions fighting for one narrow column (the overcrowding in the blueprint).
//
// This version splits that column into THREE tabs — Media · Layers · Audio —
// so exactly one region owns the full panel height at a time. Every store
// call / command is unchanged; this is chrome + layout only:
//   • Media  → <MediaPalette /> (now image/video only)
//   • Layers → the original layer tree, byte-for-byte (select / drag-reorder /
//              hide / lock)
//   • Audio  → <AudioUploadPanel /> (upload + asset management) followed by
//              the placed-track list (mute / solo / select-into-inspector),
//              which used to be the crammed sub-list under Layers.
//
// Active tab is local view state (nothing persisted) — same stance as the
// effects-panel drop-in. Defaults to "media".

import type { DragEvent, MouseEvent } from "react";
import { useState } from "react";
import { Film, Layers as LayersIcon, Music, Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Headphones } from "lucide-react";
import type { Id } from "core";
import type { AudioTrack } from "core";
import { MediaPalette } from "./MediaPalette";
import { AudioUploadPanel } from "./AudioUploadPanel";
import { ADJUSTMENT_COLOR, getKindColor, getKindIcon } from "./kind-icons";
import { reorderNode } from "../commands/reorder";
import { setNodeHidden, setNodeLocked } from "../commands/toggle-node-flag";
import { setAudioTrackPropOp } from "../commands/audio-ops";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { audioKindMeta, getAudioTracks } from "./audio-kinds";
import { useAudioSelection } from "./audio-selection";

type LeftTab = "media" | "layers" | "audio";

const TABS: Array<{ id: LeftTab; label: string; Icon: typeof Film }> = [
  { id: "media", label: "Media", Icon: Film },
  { id: "layers", label: "Layers", Icon: LayersIcon },
  { id: "audio", label: "Audio", Icon: Music },
];

export function LayerPanel() {
  const [tab, setTab] = useState<LeftTab>("media");

  const root = useEditorStore((s) => activeComp(s).root);
  const audioTracks = useEditorStore((s) => getAudioTracks(activeComp(s)));

  return (
    <div className="panel panel--left">
      <div className="left-tabs" role="tablist">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`left-tab${tab === id ? " left-tab--active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === "media" && (
        <div className="left-pane left-pane--media">
          <MediaPalette />
        </div>
      )}

      {tab === "layers" && <LayersPane root={root} />}

      {tab === "audio" && (
        <div className="left-pane left-pane--audio">
          <AudioUploadPanel />
          <AudioTrackList tracks={audioTracks} />
        </div>
      )}
    </div>
  );
}

// ── Layers tab ────────────────────────────────────────────────────────────
// The original LayerPanel body, unchanged.

function LayersPane({ root }: { root: ReadonlyArray<{ id: Id; name: string; kind: string; hidden?: boolean; locked?: boolean; isAdjustment?: boolean }> }) {
  const store = useEditorStoreApi();
  const selection = useEditorStore((s) => s.selection);
  const [dragOverId, setDragOverId] = useState<Id | null>(null);

  function handleSelect(e: MouseEvent, nodeId: Id): void {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const next = selection.includes(nodeId) ? selection.filter((id) => id !== nodeId) : [...selection, nodeId];
      store.getState().select(next);
    } else {
      store.getState().select([nodeId]);
    }
  }

  function handleToggleHidden(nodeId: Id, hidden: boolean): void {
    const state = store.getState();
    state.apply(setNodeHidden(activeComp(state), nodeId, !hidden));
  }

  function handleToggleLocked(nodeId: Id, locked: boolean): void {
    const state = store.getState();
    state.apply(setNodeLocked(activeComp(state), nodeId, !locked));
  }

  function handleDragStart(e: DragEvent, nodeId: Id): void {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", nodeId);
  }

  function handleDragOver(e: DragEvent, nodeId: Id): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(nodeId);
  }

  function handleDrop(e: DragEvent, toIndex: number): void {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData("text/plain") as Id;
    if (!draggedId) return;
    const state = store.getState();
    state.apply(reorderNode(activeComp(state), draggedId, toIndex));
  }

  return (
    <div className="left-pane left-pane--layers">
      <div className="panel__header">
        Layers
        <span className="panel__count">{root.length}</span>
      </div>
      <div className="panel__body">
        {root.length === 0 ? (
          <p className="panel__empty">No layers yet — add one from the toolbar.</p>
        ) : (
          <ul className="layer-list">
            {root.map((node, index) => {
              const hidden = Boolean(node.hidden);
              const locked = Boolean(node.locked);
              const adjustment = Boolean(node.isAdjustment);
              const selected = selection.includes(node.id);
              const Icon = getKindIcon(node.kind);
              const color = adjustment ? ADJUSTMENT_COLOR : getKindColor(node.kind);
              const classes = ["layer-row", selected && "selected", hidden && "hidden-layer", dragOverId === node.id && "dragover"]
                .filter(Boolean)
                .join(" ");
              return (
                <li
                  key={node.id}
                  className={classes}
                  draggable={!locked}
                  onDragStart={(e) => handleDragStart(e, node.id)}
                  onDragOver={(e) => handleDragOver(e, node.id)}
                  onDragLeave={() => setDragOverId((id) => (id === node.id ? null : id))}
                  onDrop={(e) => handleDrop(e, index)}
                  onClick={(e) => handleSelect(e, node.id)}
                  style={{ cursor: locked ? "default" : "grab" }}
                >
                  <span className="kind-chip" style={{ background: `${color}22`, border: `1px solid ${color}` }}>
                    <Icon size={13} style={{ color }} />
                  </span>
                  <span className="layer-row__info">
                    <span className="layer-row__name">{node.name}</span>
                    <span className="layer-row__kind">{adjustment ? "adjustment" : node.kind}</span>
                  </span>
                  {adjustment && <span className="layer-row__badge">ADJ</span>}
                  <span className="layer-row__actions">
                    <button
                      className="layer-action"
                      aria-pressed={hidden}
                      title={hidden ? "Show layer" : "Hide layer"}
                      onClick={(e) => { e.stopPropagation(); handleToggleHidden(node.id, hidden); }}
                    >
                      {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      className="layer-action"
                      aria-pressed={locked}
                      title={locked ? "Unlock layer" : "Lock layer"}
                      onClick={(e) => { e.stopPropagation(); handleToggleLocked(node.id, locked); }}
                    >
                      {locked ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Placed-track list (Audio tab) ───────────────────────────────────────────
// Was the collapsible sub-list crammed under Layers; now a plain section in
// the Audio tab. Selects a track into the inspector (AudioInspectorPanel) via
// the audio-selection context; mute / solo unchanged.

function AudioTrackList({ tracks }: { tracks: AudioTrack[] }) {
  const store = useEditorStoreApi();
  const { selectedAudioId, selectAudio } = useAudioSelection();

  function toggle(track: AudioTrack, key: "muted" | "solo") {
    const state = store.getState();
    state.apply(setAudioTrackPropOp(activeComp(state), track.id, key, !track[key]));
  }

  return (
    <div className="audio-tracklist">
      <div className="panel__header">
        On Timeline
        <span className="panel__count">{tracks.length}</span>
      </div>
      {tracks.length === 0 ? (
        <p className="panel__empty">No tracks placed yet — add one from the audio above.</p>
      ) : (
        <ul className="layer-list" style={{ paddingTop: 0 }}>
          {tracks.map((track) => {
            const meta = audioKindMeta(track);
            const Icon = meta.icon;
            const selected = selectedAudioId === track.id;
            const classes = ["layer-row", selected && "selected", track.muted && "hidden-layer"].filter(Boolean).join(" ");
            return (
              <li key={track.id} className={classes} onClick={() => selectAudio(track.id)} style={{ cursor: "pointer" }}>
                <span className="kind-chip" style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}` }}>
                  <Icon size={13} style={{ color: meta.color }} />
                </span>
                <span className="layer-row__info">
                  <span className="layer-row__name">{track.name}</span>
                  <span className="layer-row__kind">{meta.label.toLowerCase()}</span>
                </span>
                <span className="layer-row__actions">
                  <button
                    className="layer-action"
                    aria-pressed={track.muted}
                    title={track.muted ? "Unmute" : "Mute"}
                    onClick={(e) => { e.stopPropagation(); toggle(track, "muted"); }}
                  >
                    {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  <button
                    className="layer-action"
                    aria-pressed={track.solo}
                    title={track.solo ? "Un-solo" : "Solo"}
                    onClick={(e) => { e.stopPropagation(); toggle(track, "solo"); }}
                  >
                    <Headphones size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// apps/editor/src/components/AudioPanel.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// AUDIO TIMELINE — split into HEADER column + CLIP column pieces
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors the existing layer-track split (TimelineTrackHeaders / TimelineTrack):
// the header (name + mute/solo/delete) belongs in the FIXED left header
// column; the clip (drag to move, drag edges to trim) belongs in the
// SCROLLABLE right track column. Rendering both halves of ONE row in the
// same flex container (as the previous version did) put the "head" inside
// the scrollable area — hence it appearing in the timeline instead of the
// side, and the row not respecting the shared row-height/scroll-sync system
// used by real layer rows (hence the overlap).
//
// INTEGRATION
// -----------
// Render <AudioTrackHeaders /> wherever TimelineTrackHeaders renders its
// per-node rows (same fixed-width column, same row height convention).
// Render <AudioTrackClips /> wherever TimelineTrack renders its per-node
// rows (same scrollable container, sharing horizontal scroll position).
// Both consume the SAME `tracks` array so row order/count always matches.
//
// ROW HEIGHT: 32px — set this to match whatever ROW_HEIGHT your
// TimelineTrackHeaders/TimelineTrack already use, so audio rows align
// pixel-for-pixel with layer rows rather than overlapping them.

import { useCallback, useState } from "react";
import {
  Volume2, VolumeX, Headphones, Trash2, Music,
} from "lucide-react";
import type { Id } from "core";
import type { AudioTrack } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { removeAudioTrackOp, setAudioTrackPropOp } from "../commands/audio-ops";
import { RangeSlider } from "./RangeSlider";

// Must match the real layer row height so audio rows align, not overlap.
export const AUDIO_ROW_HEIGHT = 32;

function getAudioTracks(comp: unknown): AudioTrack[] {
  return (comp as { audioTracks?: AudioTrack[] }).audioTracks ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER COLUMN — one row per track, same width as TimelineTrackHeaders
// ─────────────────────────────────────────────────────────────────────────────

export function AudioTrackHeaders() {
  const store  = useEditorStoreApi();
  const tracks = useEditorStore((s) => getAudioTracks(activeComp(s)));

  if (tracks.length === 0) return null;

  function toggleMute(t: AudioTrack) {
    const state = store.getState();
    state.apply(setAudioTrackPropOp(activeComp(state), t.id, "muted", !t.muted));
  }
  function toggleSolo(t: AudioTrack) {
    const state = store.getState();
    state.apply(setAudioTrackPropOp(activeComp(state), t.id, "solo", !t.solo));
  }
  function handleRemove(id: Id) {
    const state = store.getState();
    state.apply(removeAudioTrackOp(activeComp(state), id));
  }

  return (
    <div className="audio-headers">
      {tracks.map((track) => (
        <div key={track.id} className="audio-header-row" style={{ height: AUDIO_ROW_HEIGHT }}>
          <Music size={11} className="audio-header-row__icon" />
          <span className="audio-header-row__name" title={track.name}>
            {track.name}
          </span>
          <div className="audio-header-row__actions">
            <button
              className={`audio-btn${track.muted ? " audio-btn--active" : ""}`}
              title={track.muted ? "Unmute" : "Mute"}
              onClick={() => toggleMute(track)}
            >
              {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
            </button>
            <button
              className={`audio-btn${track.solo ? " audio-btn--active audio-btn--solo" : ""}`}
              title={track.solo ? "Un-solo" : "Solo"}
              onClick={() => toggleSolo(track)}
            >
              <Headphones size={11} />
            </button>
            <button
              className="audio-btn audio-btn--danger"
              title="Delete track"
              onClick={() => handleRemove(track.id)}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIP COLUMN — scrollable area, one row per track, drag to move + trim
// ─────────────────────────────────────────────────────────────────────────────

interface AudioTrackClipsProps {
  pixelsPerFrame: number;
  fps: number;
}

type DragMode = "move" | "trim-start" | "trim-end";

export function AudioTrackClips({ pixelsPerFrame, fps }: AudioTrackClipsProps) {
  const store  = useEditorStoreApi();
  const tracks = useEditorStore((s) => getAudioTracks(activeComp(s)));
  const [drag, setDrag] = useState<{ id: Id; mode: DragMode } | null>(null);

  const commit = useCallback((id: Id, patch: Partial<AudioTrack>) => {
    const state = store.getState();
    for (const [key, value] of Object.entries(patch)) {
      state.apply(setAudioTrackPropOp(activeComp(state), id, key as keyof AudioTrack, value as never));
    }
  }, [store]);

  if (tracks.length === 0) return null;

  function startDrag(e: React.PointerEvent, track: AudioTrack, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: track.id, mode });

    const startX      = e.clientX;
    const origStart    = track.startFrame;
    const origEnd       = track.endFrame ?? (track.startFrame + 150); // fallback width
    const origTrimIn   = track.trimIn;
    const origTrimOut  = track.trimOut;

    function onMove(ev: PointerEvent) {
      const deltaFrames = Math.round((ev.clientX - startX) / pixelsPerFrame);

      if (mode === "move") {
        const newStart = Math.max(0, origStart + deltaFrames);
        const duration = origEnd - origStart;
        commit(track.id, { startFrame: newStart, endFrame: newStart + duration });
      } else if (mode === "trim-start") {
        // Dragging the LEFT edge: changes startFrame AND trimIn together
        // so the audio content itself shifts (trim from the source file).
        const newStart = Math.min(origEnd - 1, Math.max(0, origStart + deltaFrames));
        const frameDelta = newStart - origStart;
        const newTrimIn  = Math.max(0, origTrimIn + frameDelta / fps);
        commit(track.id, { startFrame: newStart, trimIn: newTrimIn });
      } else if (mode === "trim-end") {
        // Dragging the RIGHT edge: changes endFrame AND trimOut together.
        const newEnd = Math.max(origStart + 1, origEnd + deltaFrames);
        const frameDelta = newEnd - origEnd;
        const newTrimOut = origTrimOut !== undefined
          ? Math.max(origTrimIn + 0.1, origTrimOut + frameDelta / fps)
          : undefined;
        commit(track.id, { endFrame: newEnd, trimOut: newTrimOut });
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="audio-clips">
      {tracks.map((track) => {
        const width = ((track.endFrame ?? track.startFrame + 150) - track.startFrame) * pixelsPerFrame;
        const left  = track.startFrame * pixelsPerFrame;
        const audible = !track.muted;
        const isDragging = drag?.id === track.id;

        return (
          <div key={track.id} className="audio-clip-row" style={{ height: AUDIO_ROW_HEIGHT }}>
            <div
              className={`audio-clip${audible ? "" : " audio-clip--muted"}${isDragging ? " audio-clip--dragging" : ""}`}
              style={{ left, width: Math.max(width, 24) }}
              onPointerDown={(e) => startDrag(e, track, "move")}
            >
              {/* Left trim handle */}
              <div
                className="audio-clip__handle audio-clip__handle--start"
                onPointerDown={(e) => startDrag(e, track, "trim-start")}
              />

              <div className="audio-clip__waveform" />
              <span className="audio-clip__label">{track.name}</span>

              {/* Right trim handle */}
              <div
                className="audio-clip__handle audio-clip__handle--end"
                onPointerDown={(e) => startDrag(e, track, "trim-end")}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INSPECTOR PANEL — unchanged from previous version
// ─────────────────────────────────────────────────────────────────────────────

interface AudioInspectorPanelProps {
  track: AudioTrack;
  audioDuration?: number;
}

export function AudioInspectorPanel({ track, audioDuration }: AudioInspectorPanelProps) {
  const store = useEditorStoreApi();

  function set<K extends keyof AudioTrack>(key: K, value: AudioTrack[K]) {
    const state = store.getState();
    state.apply(setAudioTrackPropOp(activeComp(state), track.id, key, value as never));
  }

  function handleRemove() {
    const state = store.getState();
    state.apply(removeAudioTrackOp(activeComp(state), track.id));
  }

  const maxTrim = audioDuration ?? 3600;

  return (
    <div className="audio-inspector">
      <div className="audio-inspector__row">
        <label className="audio-inspector__label">Name</label>
        <input
          className="insp-text"
          value={track.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <RangeSlider label="Volume" value={track.volume} min={0} max={2} step={0.01}
        onChange={(v) => set("volume", v as number)} />
      <RangeSlider label="Fade In" value={track.fadeIn} min={0} max={10} step={0.1} unit="s"
        onChange={(v) => set("fadeIn", v as number)} />
      <RangeSlider label="Fade Out" value={track.fadeOut} min={0} max={10} step={0.1} unit="s"
        onChange={(v) => set("fadeOut", v as number)} />

      <div className="audio-inspector__section-label">Source Trim</div>
      <RangeSlider label="Trim In" value={track.trimIn} min={0} max={maxTrim} step={0.1} unit="s"
        onChange={(v) => set("trimIn", v as number)} />
      <RangeSlider label="Trim Out" value={track.trimOut ?? maxTrim} min={0} max={maxTrim} step={0.1} unit="s"
        onChange={(v) => set("trimOut", v as number)} />

      <div className="audio-inspector__toggles">
        <label className="audio-inspector__toggle">
          <input type="checkbox" checked={track.loop} onChange={(e) => set("loop", e.target.checked)} />
          Loop
        </label>
        <label className="audio-inspector__toggle">
          <input type="checkbox" checked={track.muted} onChange={(e) => set("muted", e.target.checked)} />
          Mute
        </label>
        <label className="audio-inspector__toggle">
          <input type="checkbox" checked={track.solo} onChange={(e) => set("solo", e.target.checked)} />
          Solo
        </label>
      </div>

      <button className="btn btn-sm btn-danger" style={{ width: "100%", marginTop: 8 }} onClick={handleRemove}>
        <Trash2 size={13} /> Remove Track
      </button>
    </div>
  );
}
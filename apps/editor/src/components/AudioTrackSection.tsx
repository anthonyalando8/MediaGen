// apps/editor/src/components/AudioTrackSection.tsx
//
// AUDIO SECTION of the unified timeline. Split, like the layer timeline, into
// a FIXED header column (<AudioTrackHeaderRows/>) and a SCROLLABLE clip column
// (<AudioClipRows/>), both consuming getAudioTracks(comp) at AUDIO_ROW_HEIGHT.
//
// ── FIX IN THIS REVISION: clips can now be MOVED, not just resized ──────────
// The drag `commit` used to loop the patch keys and fire ONE op PER key, all
// computed from a single captured store snapshot. Since every op rewrites the
// whole `/audioTracks` array from that (now stale) snapshot, the 2nd key
// reverted the 1st. For a MOVE (startFrame + endFrame) startFrame snapped back
// and only endFrame changed — the clip appeared to resize from the right edge
// instead of moving. Now `commit` applies ONE combined op via
// `setAudioTrackPropsOp`, so startFrame + endFrame land together (and each
// drag tick is a single undo entry). Trim-start (startFrame + trimIn) is fixed
// by the same change. All store/command calls are otherwise unchanged.

import { useCallback, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight, Volume2, VolumeX, Headphones } from "lucide-react";
import type { Id } from "core";
import type { AudioTrack } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { setAudioTrackPropOp, setAudioTrackPropsOp } from "../commands/audio-ops";
import {
  audioKindMeta, getAudioTracks, trackDurationFrames, buildWaveformPoints, waveSeed,
} from "./audio-kinds";

/** MUST equal TimelineTrack's TRACK_H (34) so audio rows align with layer rows. */
export const AUDIO_ROW_HEIGHT = 34;
/** Height of the "Audio"/"Layers" section divider row (both columns share it). */
export const SECTION_DIVIDER_HEIGHT = 26;

// ── Section divider (rendered in BOTH columns so heights stay in lockstep) ──

export function SectionDivider({
  label, count, open, onToggle, variant,
}: {
  label: string;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
  /** "header" renders in the fixed column (interactive); "lane" is the matching
   *  spacer in the scroll column so clip rows line up with header rows. */
  variant: "header" | "lane";
}) {
  if (variant === "lane") {
    return <div className="sb-tl-divider sb-tl-divider--lane" style={{ height: SECTION_DIVIDER_HEIGHT }} />;
  }
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className="sb-tl-divider sb-tl-divider--header"
      style={{ height: SECTION_DIVIDER_HEIGHT }}
      onClick={onToggle}
      disabled={!onToggle}
    >
      {onToggle && <Chevron size={12} className="sb-tl-divider__chev" />}
      <span className="sb-tl-divider__label">{label}</span>
      {count != null && <span className="sb-tl-divider__count">{count}</span>}
    </button>
  );
}

// ── Header column ───────────────────────────────────────────────────────────

export function AudioTrackHeaderRows({
  selectedAudioId, onSelect,
}: {
  selectedAudioId: Id | null;
  onSelect: (id: Id) => void;
}) {
  const store  = useEditorStoreApi();
  const tracks = useEditorStore((s) => getAudioTracks(activeComp(s)));

  function toggle(track: AudioTrack, key: "muted" | "solo") {
    const state = store.getState();
    state.apply(setAudioTrackPropOp(activeComp(state), track.id, key, !track[key]));
  }

  return (
    <>
      {tracks.map((track) => {
        const meta = audioKindMeta(track);
        const Icon = meta.icon;
        const selected = selectedAudioId === track.id;
        return (
          <div
            key={track.id}
            className={`sb-audio-header${selected ? " sb-audio-header--selected" : ""}${track.muted ? " sb-audio-header--muted" : ""}`}
            style={{ height: AUDIO_ROW_HEIGHT }}
            onClick={() => onSelect(track.id)}
          >
            <span className="sb-audio-header__chip" style={{ color: meta.color, background: `${meta.color}22` }}>
              <Icon size={12} />
            </span>
            <span className="sb-audio-header__name" title={`${track.name} · ${meta.label}`}>{track.name}</span>
            <button
              className={`sb-audio-btn${track.muted ? " sb-audio-btn--mute" : ""}`}
              title={track.muted ? "Unmute" : "Mute"}
              onClick={(e) => { e.stopPropagation(); toggle(track, "muted"); }}
            >
              {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <button
              className={`sb-audio-btn${track.solo ? " sb-audio-btn--solo" : ""}`}
              title={track.solo ? "Un-solo" : "Solo"}
              onClick={(e) => { e.stopPropagation(); toggle(track, "solo"); }}
            >
              <Headphones size={12} />
            </button>
          </div>
        );
      })}
    </>
  );
}

// ── Clip column ─────────────────────────────────────────────────────────────

type DragMode = "move" | "trim-start" | "trim-end";

export function AudioClipRows({
  pixelsPerFrame, fps, selectedAudioId, onSelect,
}: {
  pixelsPerFrame: number;
  fps: number;
  selectedAudioId: Id | null;
  onSelect: (id: Id) => void;
}) {
  const store  = useEditorStoreApi();
  const tracks = useEditorStore((s) => getAudioTracks(activeComp(s)));
  const [dragId, setDragId] = useState<Id | null>(null);

  // Apply the whole patch in ONE op so multi-field edits (move / trim) are
  // atomic — see setAudioTrackPropsOp. (The old per-key loop reverted itself.)
  const commit = useCallback((id: Id, patch: Partial<AudioTrack>) => {
    const state = store.getState();
    state.apply(setAudioTrackPropsOp(activeComp(state), id, patch));
  }, [store]);

  function startDrag(e: ReactPointerEvent, track: AudioTrack, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(track.id);
    setDragId(track.id);

    const startX     = e.clientX;
    const origStart  = track.startFrame;
    const origEnd    = track.endFrame ?? track.startFrame + 150;
    const origTrimIn = track.trimIn;
    const origTrimOut = track.trimOut;

    function onMove(ev: PointerEvent) {
      const deltaFrames = Math.round((ev.clientX - startX) / pixelsPerFrame);
      if (mode === "move") {
        const newStart = Math.max(0, origStart + deltaFrames);
        commit(track.id, { startFrame: newStart, endFrame: newStart + (origEnd - origStart) });
      } else if (mode === "trim-start") {
        const newStart = Math.min(origEnd - 1, Math.max(0, origStart + deltaFrames));
        const newTrimIn = Math.max(0, origTrimIn + (newStart - origStart) / fps);
        commit(track.id, { startFrame: newStart, trimIn: newTrimIn });
      } else {
        const newEnd = Math.max(origStart + 1, origEnd + deltaFrames);
        const newTrimOut = origTrimOut !== undefined
          ? Math.max(origTrimIn + 0.1, origTrimOut + (newEnd - origEnd) / fps)
          : undefined;
        commit(track.id, newTrimOut !== undefined ? { endFrame: newEnd, trimOut: newTrimOut } : { endFrame: newEnd });
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragId(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <>
      {tracks.map((track) => {
        const meta = audioKindMeta(track);
        const left  = track.startFrame * pixelsPerFrame;
        const width = Math.max(24, trackDurationFrames(track) * pixelsPerFrame);
        const selected = selectedAudioId === track.id;
        const points = buildWaveformPoints(waveSeed(track.id));
        return (
          <div key={track.id} className="sb-audio-lane" style={{ height: AUDIO_ROW_HEIGHT }}>
            <div
              className={`sb-audio-clip${selected ? " sb-audio-clip--selected" : ""}${track.muted ? " sb-audio-clip--muted" : ""}${dragId === track.id ? " sb-audio-clip--dragging" : ""}`}
              style={{
                left, width,
                background: `linear-gradient(180deg, ${meta.color}3a, ${meta.color}1f)`,
                borderColor: selected ? "var(--accent)" : `${meta.color}99`,
                color: meta.color,
              }}
              onPointerDown={(e) => startDrag(e, track, "move")}
              onClick={(e) => { e.stopPropagation(); onSelect(track.id); }}
            >
              <div
                className="sb-audio-clip__handle sb-audio-clip__handle--start"
                onPointerDown={(e) => startDrag(e, track, "trim-start")}
              />
              <svg className="sb-audio-clip__wave" viewBox="0 0 100 20" preserveAspectRatio="none">
                <polygon points={points} fill="currentColor" />
              </svg>
              <span className="sb-audio-clip__label">{track.name}</span>
              <div
                className="sb-audio-clip__handle sb-audio-clip__handle--end"
                onPointerDown={(e) => startDrag(e, track, "trim-end")}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

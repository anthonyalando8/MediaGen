// apps/editor/src/components/TimelinePlaceholder.tsx
//
// Transport (skip / play-pause / timecode) + the clip-arrangement timeline
// (TimelineTrackHeaders / TimelineRuler / TimelineTrack). Filename kept
// as-is (it's referenced from App.tsx) even though this is no longer a
// placeholder — it hosts a real per-layer timeline with drag-to-move,
// drag-to-trim, and transition-boundary markers.
//
// UI/UX redesign:
//  - The timeline gains a sticky left TRACK-HEADER column (layer name +
//    kind chip + hide/lock), aligned 1:1 with the clip lanes — the single
//    biggest readability win over bars that floated with no row labels.
//  - `pixelsPerFrame` is now LOCAL UI state driven by a zoom slider
//    (previously a fixed constant; the original even flagged a zoom control
//    as "a natural follow-up"). Pure view-state — no document/store change.
//  - Transport adds skip-to-start / skip-to-end (existing `setPlayhead`)
//    and a timecode readout (existing `playhead` / `duration` / `fps`).

import { useState } from "react";
import { Pause, Play, SkipBack, SkipForward, ZoomIn, ZoomOut } from "lucide-react";
import { toFrame } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { TimelineTrackHeaders } from "./TimelineTrackHeaders";

const DEFAULT_PX_PER_FRAME = 4;
const MIN_PX_PER_FRAME = 1.5;
const MAX_PX_PER_FRAME = 11;

function timecode(frame: number, fps: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const safeFps = fps > 0 ? fps : 30;
  return `00:${pad(Math.floor(frame / safeFps))}:${pad(Math.floor(frame % safeFps))}`;
}

export function TimelinePlaceholder() {
  const store = useEditorStoreApi();
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);
  const duration = useEditorStore((s) => activeComp(s).duration);
  const fps = useEditorStore((s) => activeComp(s).fps);

  const [pixelsPerFrame, setPixelsPerFrame] = useState(DEFAULT_PX_PER_FRAME);

  return (
    <div className="timeline-panel">
      <div className="transport">
        <div className="btn-group">
          <button className="btn btn-icon" title="Jump to start" onClick={() => store.getState().setPlayhead(toFrame(0))}>
            <SkipBack size={15} />
          </button>
          <button
            className="transport__play"
            title={playing ? "Pause" : "Play"}
            onClick={() => (playing ? store.getState().pause() : store.getState().play())}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            className="btn btn-icon"
            title="Jump to end"
            onClick={() => store.getState().setPlayhead(toFrame(Math.max(0, (duration as number) - 1)))}
          >
            <SkipForward size={15} />
          </button>
        </div>
        <span className="transport__time">
          <span className="transport__time-now">{timecode(playhead as number, fps as number)}</span>{" "}
          <span className="transport__time-total">/ {timecode(duration as number, fps as number)}</span>
        </span>

        <span className="transport__spacer" />

        <div className="transport__zoom">
          <ZoomOut size={14} />
          <input
            type="range"
            min={MIN_PX_PER_FRAME}
            max={MAX_PX_PER_FRAME}
            step={0.5}
            value={pixelsPerFrame}
            onChange={(e) => setPixelsPerFrame(Number(e.target.value))}
            title="Timeline zoom"
            aria-label="Timeline zoom"
          />
          <ZoomIn size={14} />
        </div>
      </div>

      <div className="timeline-body">
        <TimelineTrackHeaders />
        <div className="timeline-scroll">
          <TimelineRuler pixelsPerFrame={pixelsPerFrame} />
          <TimelineTrack pixelsPerFrame={pixelsPerFrame} />
        </div>
      </div>
    </div>
  );
}

// apps/editor/src/components/TimelinePlaceholder.tsx
//
// Transport (skip / play-pause / timecode) + the clip-arrangement timeline
// (TimelineTrackHeaders / TimelineRuler / TimelineTrack) in "Clips" mode,
// or the keyframe graph editor (CurveEditor) in "Graph" mode (Phase 2 §9.2).
//
// UI/UX redesign:
//  - The timeline gains a sticky left TRACK-HEADER column (layer name +
//    kind chip + hide/lock), aligned 1:1 with the clip lanes.
//  - `pixelsPerFrame` is LOCAL UI state driven by a zoom slider.
//  - Transport adds skip-to-start / skip-to-end and a timecode readout.
//  - WK 9: a "Clips | Graph" mode toggle in the transport bar switches to
//    the CurveEditor when the selected node has channels.

import { useState } from "react";
import { Pause, Play, SkipBack, SkipForward, ZoomIn, ZoomOut } from "lucide-react";
import { toFrame } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { TimelineTrackHeaders } from "./TimelineTrackHeaders";
import { CurveEditor } from "./CurveEditor";

const DEFAULT_PX_PER_FRAME = 4;
const MIN_PX_PER_FRAME = 1.5;
const MAX_PX_PER_FRAME = 11;

type TimelineMode = "clips" | "graph";

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
  const [mode, setMode] = useState<TimelineMode>("clips");

  const selectedNode = useEditorStore((s) => {
    if (s.selection.length !== 1) return undefined;
    return activeComp(s).root.find((n) => n.id === s.selection[0]);
  });
  const hasChannels = (selectedNode?.channels.length ?? 0) > 0;

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

        {/* WK 9 — Clips / Graph mode toggle */}
        <div className="btn-group" style={{ marginRight: 8 }}>
          <button
            className="btn btn-sm"
            aria-pressed={mode === "clips"}
            onClick={() => setMode("clips")}
            title="Clip arrangement view"
          >
            Clips
          </button>
          <button
            className="btn btn-sm"
            aria-pressed={mode === "graph"}
            disabled={!hasChannels && mode !== "graph"}
            onClick={() => setMode("graph")}
            title="Keyframe graph view — select a layer with channels first"
          >
            Graph
          </button>
        </div>

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

      {mode === "clips" ? (
        <div className="timeline-body">
          <TimelineTrackHeaders />
          <div className="timeline-scroll">
            <TimelineRuler pixelsPerFrame={pixelsPerFrame} />
            <TimelineTrack pixelsPerFrame={pixelsPerFrame} />
          </div>
        </div>
      ) : (
        <div className="timeline-body">
          <TimelineTrackHeaders />
          <div className="timeline-scroll">
            <TimelineRuler pixelsPerFrame={pixelsPerFrame} />
            {selectedNode ? (
              <CurveEditor node={selectedNode} pixelsPerFrame={pixelsPerFrame} />
            ) : (
              <p className="panel__empty" style={{ padding: "12px 16px", fontSize: "12px" }}>
                Select a layer with channels to edit keyframes.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
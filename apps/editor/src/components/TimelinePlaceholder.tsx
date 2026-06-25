// apps/editor/src/components/TimelinePlaceholder.tsx
//
// Transport + clip timeline (Clips mode) or keyframe graph (Graph mode).
//
// Production-grade additions:
//  - Keyboard shortcuts: Space = play/pause, Left/Right = step ±1 frame,
//    Shift+Left/Right = ±10 frames, Home/End = jump to start/end.
//  - Scroll-to-playhead button + auto-follow during playback.
//  - scrollContainerRef passed to Ruler and Track so they share one scroll
//    position (ruler scrub correctly accounts for scroll offset).
//  - Vertical sync between track headers and lanes via scrollTop mirror.
//  - Timecode display in HH:MM:SS:FF format.
//  - FPS readout in transport.

import { useEffect, useRef, useState } from "react";
import {
  Pause, Play, SkipBack, SkipForward,
  ZoomIn, ZoomOut, Navigation
} from "lucide-react";
import { toFrame } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { TimelineTrackHeaders } from "./TimelineTrackHeaders";
import { TimelineGrid } from "./TimelineGrid";
import { TimelineSnapContext } from "./TimelineSnapContext";
import { CurveEditor } from "./CurveEditor";

const DEFAULT_PX_PER_FRAME = 4;
const MIN_PX_PER_FRAME = 1;
const MAX_PX_PER_FRAME = 24;

type TimelineMode = "clips" | "graph";

/** HH:MM:SS:FF timecode string. */
function timecode(frame: number, fps: number): string {
  const safeFps = Math.max(1, fps);
  const totalSecs = Math.floor(frame / safeFps);
  const ff = frame % safeFps;
  const ss = totalSecs % 60;
  const mm = Math.floor(totalSecs / 60) % 60;
  const hh = Math.floor(totalSecs / 3600);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

export function TimelinePlaceholder() {
  const store = useEditorStoreApi();
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);
  const duration = useEditorStore((s) => activeComp(s).duration);
  const fps = useEditorStore((s) => activeComp(s).fps);

  const [pixelsPerFrame, setPixelsPerFrame] = useState(DEFAULT_PX_PER_FRAME);
  const [mode, setMode] = useState<TimelineMode>("clips");
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [litFrame, setLitFrame] = useState<number | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const snapCtx = { litFrame, setLitFrame };

  // Derive tick interval (same logic as ruler) to align grid lines with ticks
  function pickTickInterval(ppf: number): number {
    const candidates = [1, 2, 5, 10, 15, 30, 60, 90, 150, 300, 600];
    for (const f of candidates) {
      if (f * ppf >= 48) return f;
    }
    return 600;
  }
  const tickInterval = pickTickInterval(pixelsPerFrame);

  const selectedNode = useEditorStore((s) => {
    if (s.selection.length !== 1) return undefined;
    return activeComp(s).root.find((n) => n.id === s.selection[0]);
  });
  const hasChannels = (selectedNode?.channels.length ?? 0) > 0;
  const trackCount = useEditorStore((s) => activeComp(s).root.length);
  const visibleDuration = useEditorStore((s) => {
    const comp = activeComp(s);
    const maxEnd = comp.root.reduce(
      (max, n) => Math.max(max, (n.time.start as number) + (n.time.duration as number)),
      comp.duration as number
    );
    return Math.max(comp.duration as number, maxEnd) + 30;
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

      const state = store.getState();
      const ph = state.playhead as number;
      const dur = activeComp(state).duration as number;
      const step = e.shiftKey ? 10 : 1;

      switch (e.key) {
        case " ":
          e.preventDefault();
          playing ? state.pause() : state.play();
          break;
        case "ArrowLeft":
          e.preventDefault();
          state.setPlayhead(toFrame(Math.max(0, ph - step)));
          break;
        case "ArrowRight":
          e.preventDefault();
          state.setPlayhead(toFrame(Math.min(dur - 1, ph + step)));
          break;
        case "Home":
          e.preventDefault();
          state.setPlayhead(toFrame(0));
          break;
        case "End":
          e.preventDefault();
          state.setPlayhead(toFrame(Math.max(0, dur - 1)));
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, playing]);

  // ── Scroll-to-playhead ─────────────────────────────────────────────────
  useEffect(() => {
    if (!followPlayhead) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const ph = playhead as number;
    const x = ph * pixelsPerFrame;
    const { scrollLeft, clientWidth } = el;
    const margin = clientWidth * 0.2;
    if (x < scrollLeft + margin || x > scrollLeft + clientWidth - margin) {
      el.scrollTo({ left: Math.max(0, x - clientWidth / 2), behavior: "smooth" });
    }
  }, [playhead, pixelsPerFrame, followPlayhead]);

  function scrollToPlayhead() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const x = (playhead as number) * pixelsPerFrame;
    el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: "smooth" });
  }

  return (
    <div className="timeline-panel">
      {/* ── Transport bar ─────────────────────────────────────────────── */}
      <div className="transport">
        <div className="btn-group">
          <button className="btn btn-icon" title="Jump to start (Home)" onClick={() => store.getState().setPlayhead(toFrame(0))}>
            <SkipBack size={14} />
          </button>
          <button
            className="transport__play"
            title={playing ? "Pause (Space)" : "Play (Space)"}
            onClick={() => (playing ? store.getState().pause() : store.getState().play())}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            className="btn btn-icon"
            title="Jump to end (End)"
            onClick={() => store.getState().setPlayhead(toFrame(Math.max(0, (duration as number) - 1)))}
          >
            <SkipForward size={14} />
          </button>
        </div>

        <span className="transport__time">
          <span className="transport__time-now">{timecode(playhead as number, fps as number)}</span>
          <span className="transport__time-sep"> / </span>
          <span className="transport__time-total">{timecode(duration as number, fps as number)}</span>
        </span>

        <span className="transport__fps">{fps as number} fps</span>

        <span className="transport__spacer" />

        {/* Follow-playhead toggle */}
        <button
          className={`btn btn-icon${followPlayhead ? " btn-active" : ""}`}
          title={followPlayhead ? "Following playhead (click to lock)" : "Scroll to playhead"}
          onClick={() => { setFollowPlayhead((v) => !v); scrollToPlayhead(); }}
        >
          <Navigation size={14} />
        </button>

        {/* Clips / Graph mode toggle */}
        <div className="btn-group" style={{ marginRight: 4 }}>
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
            title="Keyframe graph — select a layer with channels first"
          >
            Graph
          </button>
        </div>

        {/* Zoom slider */}
        <div className="transport__zoom">
          <ZoomOut size={13} />
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
          <ZoomIn size={13} />
        </div>
      </div>

      {/* ── Timeline body ──────────────────────────────────────────────── */}
      {mode === "clips" ? (
        <TimelineSnapContext.Provider value={snapCtx}>
          <div className="timeline-body">
            <TimelineTrackHeaders />
            <div
              ref={scrollContainerRef}
              className="timeline-scroll"
              onScroll={() => setFollowPlayhead(false)}
            >
              <TimelineRuler
                pixelsPerFrame={pixelsPerFrame}
                scrollContainerRef={scrollContainerRef}
                litFrame={litFrame}
                tickInterval={tickInterval}
              />
              <div className="timeline-tracks-area">
                <TimelineGrid
                  pixelsPerFrame={pixelsPerFrame}
                  trackCount={trackCount}
                  totalFrames={visibleDuration as number}
                  litFrame={litFrame}
                  tickInterval={tickInterval}
                />
                <TimelineTrack
                  pixelsPerFrame={pixelsPerFrame}
                  scrollContainerRef={scrollContainerRef}
                />
              </div>
            </div>
          </div>
        </TimelineSnapContext.Provider>
      ) : (
        <div className="timeline-body">
          <TimelineTrackHeaders />
          <div ref={scrollContainerRef} className="timeline-scroll">
            <TimelineRuler
              pixelsPerFrame={pixelsPerFrame}
              scrollContainerRef={scrollContainerRef}
            />
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
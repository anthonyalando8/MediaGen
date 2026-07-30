// apps/editor/src/components/TimelinePlaceholder.tsx
//
// Drop-in replacement. Transport + graph mode + the unified layers/audio body
// are unchanged; this revision fixes TIMELINE ZOOM RANGE and PLAYHEAD FOLLOW.
//
//   fixed header column  →  <TimelineTrackHeaders/>  (layers)
//                           ── Audio ── divider
//                           <AudioTrackHeaderRows/>  (audio)
//   scrollable column    →  <TimelineRuler/>
//                           <TimelineTrack/>         (layer lanes)
//                           ── Audio ── divider (lane spacer)
//                           <AudioClipRows/>         (audio clips)
//                           <playhead>               (one line, both sections)
//
// ─────────────────────────────────────────────────────────────────────────
// FIX 1 — zoom could not reach "whole timeline in one glance"
// ─────────────────────────────────────────────────────────────────────────
// `MIN_PX_PER_FRAME` was a hardcoded 1. A 5-minute comp at 30fps is 9 000
// frames, so fully zoomed OUT the lane area was still 9 000px wide against a
// ~1 200px viewport — you could never see more than ~13% of the video at once.
// The floor has to be a FUNCTION OF CONTENT, not a constant:
//
//   • `fitPxPerFrame` = (measured viewport width − gutter) / visibleDuration,
//     remeasured on resize via ResizeObserver. That is by definition the zoom
//     at which the entire timeline is visible.
//   • The slider's minimum is that fit value (never above it), so the extreme
//     left of the slider ALWAYS means "everything fits".
//   • The slider is LOG-scaled. With a linear scale and a 0.05–24 range, 99%
//     of the travel would sit in the unusable high end and the first pixel of
//     movement would jump several hundred percent.
//   • A "Fit" button jumps straight there, and long comps open fitted (see
//     `didAutoFitRef`) instead of opening 8× too deep and looking broken.
//
// ─────────────────────────────────────────────────────────────────────────
// FIX 2 — following the playhead stalled during playback
// ─────────────────────────────────────────────────────────────────────────
// Three separate defects compounded:
//
//   (a) SMOOTH SCROLL FOUGHT ITSELF. The effect ran on every playhead tick
//       (~33ms at 30fps) and re-tested against `el.scrollLeft`, which is
//       MID-ANIMATION during a smooth scroll. The playhead stays outside the
//       margin until the animation finishes, so each tick issued a fresh
//       `scrollTo`, restarting the animation from a new position ~30 times a
//       second. The result reads as stuttering or completely stuck scrolling.
//       Fix: during playback scroll INSTANTLY (`behavior: "auto"`) — the
//       playhead is already moving smoothly, so the viewport doesn't need to
//       animate as well — and keep smooth behaviour only for the paused/manual
//       "Scroll to playhead" case.
//
//   (b) VERTICAL SCROLL CANCELLED FOLLOWING. `handleScroll` fires for BOTH
//       axes, and any non-programmatic event called `setFollowPlayhead(false)`.
//       Scrolling down to see a lower track silently turned following off.
//       Fix: compare `scrollLeft` against the previous value and only treat a
//       HORIZONTAL delta as an intent to take manual control.
//
//   (c) THE PROGRAMMATIC-SCROLL FLAG WAS TIME-BASED. It cleared on a 600ms
//       timeout, so a user scroll inside that window was swallowed, while a
//       smooth scroll running long could still be misread as user input. With
//       instant scrolling during playback we can instead record the exact
//       scrollLeft we asked for and compare against it — deterministic, no
//       timers involved in the playback path.
//
// Also: following now re-centres with LOOKAHEAD (playhead parked at 30% from
// the left, not 50%), so more of the timeline ahead of the playhead is visible
// — which is the part you actually want to see while it plays.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Pause, Play, SkipBack, SkipForward, ZoomIn, ZoomOut, Navigation, Maximize2,
} from "lucide-react";
import { toFrame } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { TimelineTrackHeaders } from "./TimelineTrackHeaders";
import { TimelineGrid } from "./TimelineGrid";
import { TimelineSnapContext } from "./TimelineSnapContext";
import { SpanLaneContext } from "./SpanLaneContext";
import { CurveEditor } from "./CurveEditor";
import {
  AudioTrackHeaderRows, AudioClipRows, SectionDivider,
} from "./AudioTrackSection";
import { getAudioTracks, trackDurationFrames } from "./audio-kinds";
import { useAudioSelection } from "./audio-selection";

const DEFAULT_PX_PER_FRAME = 4;
const MAX_PX_PER_FRAME = 24;

// Absolute floor, only to stop a degenerate 0/NaN before first measure. The
// REAL minimum is `fitPxPerFrame` below.
const ABSOLUTE_MIN_PX_PER_FRAME = 0.02;

// Width reserved so the last frame isn't flush against the right edge at fit.
const FIT_GUTTER_PX = 24;

// Where the playhead sits after a follow re-centre, as a fraction of viewport
// width. 0.3 keeps 70% of the visible span AHEAD of the playhead.
const FOLLOW_ANCHOR = 0.3;

// A comp is auto-fitted on open when it would otherwise overflow the viewport
// by more than this factor at the default zoom.
const AUTOFIT_OVERFLOW_FACTOR = 2;

type TimelineMode = "clips" | "graph";

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
  const audioCount = useEditorStore((s) => getAudioTracks(activeComp(s)).length);

  const { selectedAudioId, selectAudio } = useAudioSelection();

  const [pixelsPerFrame, setPixelsPerFrame] = useState(DEFAULT_PX_PER_FRAME);
  const [mode, setMode] = useState<TimelineMode>("clips");
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [litFrame, setLitFrame] = useState<number | null>(null);
  const [spanExpanded, setSpanExpanded] = useState<Set<string>>(new Set());
  const [audioOpen, setAudioOpen] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(0);

  function toggleSpanLane(nodeId: string) {
    setSpanExpanded((prev) => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });
  }

  const spanLaneCtx = useMemo(() => ({ expanded: spanExpanded, toggle: toggleSpanLane }), [spanExpanded]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerColRef = useRef<HTMLDivElement>(null);
  const snapCtx = useMemo(() => ({ litFrame, setLitFrame }), [litFrame]);

  function pickTickInterval(ppf: number): number {
    // Extended upward: at fit zoom on a long comp `ppf` can be ~0.1, where even
    // a 600-frame tick is only 60px apart. Without these larger candidates the
    // ruler would draw thousands of overlapping ticks when zoomed fully out.
    const candidates = [1, 2, 5, 10, 15, 30, 60, 90, 150, 300, 600, 900, 1800, 3600, 9000, 18000];
    for (const f of candidates) if (f * ppf >= 48) return f;
    return candidates[candidates.length - 1];
  }
  const tickInterval = pickTickInterval(pixelsPerFrame);

  const selectedNode = useEditorStore((s) => {
    if (s.selection.length !== 1) return undefined;
    return activeComp(s).root.find((n) => n.id === s.selection[0]);
  });
  const hasChannels = (selectedNode?.channels.length ?? 0) > 0;
  const trackCount = useEditorStore((s) => {
    const comp = activeComp(s);
    const laneIds = new Set(comp.root.map((n) => n.lane ?? `__solo__${n.id}`));
    return Math.max(1, laneIds.size);
  });
  // Visible duration now also spans audio clips, so the lane area is wide
  // enough for the furthest-right audio clip too.
  const visibleDuration = useEditorStore((s) => {
    const comp = activeComp(s);
    const nodeEnd = comp.root.reduce(
      (max, n) => Math.max(max, (n.time.start as number) + (n.time.duration as number)),
      comp.duration as number,
    );
    const audioEnd = getAudioTracks(comp).reduce(
      (max, t) => Math.max(max, t.startFrame + trackDurationFrames(t)),
      nodeEnd,
    );
    return Math.max(comp.duration as number, audioEnd) + 30;
  });

  // ── Zoom range ─────────────────────────────────────────────────────────
  // Measure the scroll viewport so "fit" is a real number rather than a guess.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setViewportWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  /** The zoom at which the ENTIRE timeline is visible in the viewport. */
  const fitPxPerFrame = useMemo(() => {
    const frames = Math.max(1, visibleDuration as number);
    if (viewportWidth <= 0) return ABSOLUTE_MIN_PX_PER_FRAME;
    return Math.max(ABSOLUTE_MIN_PX_PER_FRAME, (viewportWidth - FIT_GUTTER_PX) / frames);
  }, [viewportWidth, visibleDuration]);

  // Never let the floor rise above the default, or short comps would be unable
  // to zoom out at all (fit on a 2-second comp is a huge px-per-frame).
  const minPxPerFrame = Math.min(fitPxPerFrame, DEFAULT_PX_PER_FRAME);

  const clampZoom = useCallback(
    (v: number) => Math.min(MAX_PX_PER_FRAME, Math.max(minPxPerFrame, v)),
    [minPxPerFrame],
  );

  // Keep the current zoom legal when the comp or viewport changes size.
  useEffect(() => {
    setPixelsPerFrame((v) => clampZoom(v));
  }, [clampZoom]);

  // Open long comps fitted. Runs once, after the first real measurement — a
  // 5-minute comp opening at 4px/frame looks broken, and "zoom out until it
  // fits" is the first thing anyone does.
  const didAutoFitRef = useRef(false);
  useEffect(() => {
    if (didAutoFitRef.current || viewportWidth <= 0) return;
    didAutoFitRef.current = true;
    const contentWidth = (visibleDuration as number) * DEFAULT_PX_PER_FRAME;
    if (contentWidth > viewportWidth * AUTOFIT_OVERFLOW_FACTOR) {
      setPixelsPerFrame(fitPxPerFrame);
    }
  }, [viewportWidth, visibleDuration, fitPxPerFrame]);

  // Log-scaled slider: linear travel over a 0.05–24 range would bunch every
  // useful zoom into the last few percent of the track.
  const zoomSliderPos = useMemo(() => {
    const lo = Math.log(minPxPerFrame);
    const hi = Math.log(MAX_PX_PER_FRAME);
    if (hi <= lo) return 1;
    return (Math.log(clampZoom(pixelsPerFrame)) - lo) / (hi - lo);
  }, [pixelsPerFrame, minPxPerFrame, clampZoom]);

  function zoomFromSliderPos(pos: number): number {
    const lo = Math.log(minPxPerFrame);
    const hi = Math.log(MAX_PX_PER_FRAME);
    return Math.exp(lo + (hi - lo) * pos);
  }

  /**
   * Zoom while keeping `anchorFrame` pinned under the same screen x, so the
   * timeline expands around the playhead (or the viewport centre) instead of
   * around frame 0 — otherwise every zoom step throws away your position.
   */
  const zoomAround = useCallback((nextPpf: number, anchorFrame?: number) => {
    const el = scrollContainerRef.current;
    const target = clampZoom(nextPpf);
    setPixelsPerFrame((prev) => {
      if (!el) return target;
      const frame = anchorFrame ?? (el.scrollLeft + el.clientWidth / 2) / prev;
      const screenX = frame * prev - el.scrollLeft;
      // Applied after React commits the new width.
      requestAnimationFrame(() => {
        const nextScroll = Math.max(0, frame * target - screenX);
        lastProgrammaticLeftRef.current = nextScroll;
        el.scrollLeft = nextScroll;
      });
      return target;
    });
  }, [clampZoom]);

  const zoomToFit = useCallback(() => {
    const el = scrollContainerRef.current;
    setPixelsPerFrame(fitPxPerFrame);
    if (el) {
      requestAnimationFrame(() => {
        lastProgrammaticLeftRef.current = 0;
        el.scrollLeft = 0;
      });
    }
  }, [fitPxPerFrame]);

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
        case " ": e.preventDefault(); playing ? state.pause() : state.play(); break;
        case "ArrowLeft": e.preventDefault(); state.setPlayhead(toFrame(Math.max(0, ph - step))); break;
        case "ArrowRight": e.preventDefault(); state.setPlayhead(toFrame(Math.min(dur - 1, ph + step))); break;
        case "Home": e.preventDefault(); state.setPlayhead(toFrame(0)); break;
        case "End": e.preventDefault(); state.setPlayhead(toFrame(Math.max(0, dur - 1))); break;
        // Timeline zoom, anchored on the playhead. Bare keys (no modifier) so
        // they don't collide with the browser's own page zoom.
        case "-": case "_": e.preventDefault(); zoomAround(pixelsPerFrame / 1.4, ph); break;
        case "=": case "+": e.preventDefault(); zoomAround(pixelsPerFrame * 1.4, ph); break;
        case "0": e.preventDefault(); zoomToFit(); break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, playing, pixelsPerFrame, zoomAround, zoomToFit]);

  // ── Scroll-to-playhead ─────────────────────────────────────────────────
  // We record the exact scrollLeft we asked for. `handleScroll` compares the
  // incoming value against it to tell OUR scroll from the USER's — no timers,
  // and correct even when several scrolls land in the same frame.
  const lastProgrammaticLeftRef = useRef<number | null>(null);
  const lastScrollLeftRef = useRef(0);

  /** Scroll so the playhead sits at FOLLOW_ANCHOR across the viewport. */
  const scrollToPlayhead = useCallback((smooth: boolean) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const x = (store.getState().playhead as number) * pixelsPerFrame;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const target = Math.min(maxLeft, Math.max(0, x - el.clientWidth * FOLLOW_ANCHOR));
    lastProgrammaticLeftRef.current = target;
    if (smooth) {
      el.scrollTo({ left: target, behavior: "smooth" });
    } else {
      el.scrollLeft = target;   // instant — see FIX 2(a)
    }
  }, [pixelsPerFrame, store]);

  useEffect(() => {
    if (!followPlayhead) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    // Everything already fits — there is nothing to follow.
    if (el.scrollWidth <= el.clientWidth) return;

    const x = (playhead as number) * pixelsPerFrame;
    const { scrollLeft, clientWidth } = el;
    const margin = Math.min(80, clientWidth * 0.1);

    if (x < scrollLeft + margin || x > scrollLeft + clientWidth - margin) {
      // Instant while playing: a smooth animation would be restarted by the
      // next playhead tick before it ever completed.
      scrollToPlayhead(!playing);
    }
  }, [playhead, pixelsPerFrame, followPlayhead, playing, scrollToPlayhead]);

  // Mirror vertical scroll onto the fixed header column so rows stay aligned.
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (headerColRef.current) headerColRef.current.scrollTop = el.scrollTop;

    const left = el.scrollLeft;
    const movedHorizontally = Math.abs(left - lastScrollLeftRef.current) > 0.5;
    lastScrollLeftRef.current = left;

    // Only a HORIZONTAL scroll means "I want manual control" — scrolling down
    // to reach another track must not switch following off (FIX 2b).
    if (!movedHorizontally) return;

    // Was this our own scroll? (FIX 2c — position-based, not time-based.)
    const expected = lastProgrammaticLeftRef.current;
    if (expected !== null && Math.abs(left - expected) < 1.5) return;
    // A smooth scroll emits intermediate positions; treat anything still
    // heading toward the target as ours.
    if (expected !== null && !playing) return;

    setFollowPlayhead(false);
  }

  const atFit = Math.abs(pixelsPerFrame - fitPxPerFrame) < fitPxPerFrame * 0.02;

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

        <button
          className={`btn btn-icon${followPlayhead ? " btn-active" : ""}`}
          title={followPlayhead ? "Following playhead (click to lock)" : "Scroll to playhead"}
          onClick={() => {
            const next = !followPlayhead;
            setFollowPlayhead(next);
            scrollToPlayhead(true);
          }}
        >
          <Navigation size={14} />
        </button>

        <div className="btn-group" style={{ marginRight: 4 }}>
          <button className="btn btn-sm" aria-pressed={mode === "clips"} onClick={() => setMode("clips")} title="Clip arrangement view">Clips</button>
          <button className="btn btn-sm" aria-pressed={mode === "graph"} disabled={!hasChannels && mode !== "graph"} onClick={() => setMode("graph")} title="Keyframe graph — select a layer with channels first">Graph</button>
        </div>

        <div className="transport__zoom">
          <button
            className="btn btn-icon"
            title="Zoom out (−)"
            disabled={pixelsPerFrame <= minPxPerFrame * 1.001}
            onClick={() => zoomAround(pixelsPerFrame / 1.4, playhead as number)}
          >
            <ZoomOut size={13} />
          </button>
          <input
            type="range" min={0} max={1} step={0.001}
            value={zoomSliderPos}
            onChange={(e) => zoomAround(zoomFromSliderPos(Number(e.target.value)), playhead as number)}
            title={`Timeline zoom — ${pixelsPerFrame.toFixed(2)} px/frame`}
            aria-label="Timeline zoom"
          />
          <button
            className="btn btn-icon"
            title="Zoom in (+)"
            disabled={pixelsPerFrame >= MAX_PX_PER_FRAME * 0.999}
            onClick={() => zoomAround(pixelsPerFrame * 1.4, playhead as number)}
          >
            <ZoomIn size={13} />
          </button>
          <button
            className={`btn btn-icon${atFit ? " btn-active" : ""}`}
            title="Fit whole timeline (0)"
            aria-label="Fit whole timeline"
            onClick={zoomToFit}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Timeline body ──────────────────────────────────────────────── */}
      {mode === "clips" ? (
        <TimelineSnapContext.Provider value={snapCtx}>
          <SpanLaneContext.Provider value={spanLaneCtx}>
            <div className="timeline-body sb-tl-body">
              {/* FIXED header column — layers + audio, one vertical scroll */}
              <div className="sb-tl-col-headers" ref={headerColRef}>
                <TimelineTrackHeaders />
                <SectionDivider
                  variant="header" label="Audio" count={audioCount}
                  open={audioOpen} onToggle={() => setAudioOpen((v) => !v)}
                />
                {audioOpen && (
                  <AudioTrackHeaderRows selectedAudioId={selectedAudioId} onSelect={selectAudio} />
                )}
              </div>

              {/* SCROLLABLE column — ruler + layer lanes + audio clips */}
              <div className="sb-tl-col-scroll timeline-scroll" ref={scrollContainerRef} onScroll={handleScroll}>
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
                  <TimelineTrack pixelsPerFrame={pixelsPerFrame} scrollContainerRef={scrollContainerRef} />
                  <SectionDivider variant="lane" label="Audio" />
                  {audioOpen && (
                    <AudioClipRows
                      pixelsPerFrame={pixelsPerFrame}
                      fps={fps as number}
                      selectedAudioId={selectedAudioId}
                      onSelect={selectAudio}
                    />
                  )}
                  {/* Continuous playhead across Layers + Audio */}
                  <div className="sb-tl-playhead-full" style={{ left: (playhead as number) * pixelsPerFrame }} />
                </div>
              </div>
            </div>
          </SpanLaneContext.Provider>
        </TimelineSnapContext.Provider>
      ) : (
        <div className="timeline-body">
          <TimelineTrackHeaders />
          <div ref={scrollContainerRef} className="timeline-scroll">
            <TimelineRuler pixelsPerFrame={pixelsPerFrame} scrollContainerRef={scrollContainerRef} />
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

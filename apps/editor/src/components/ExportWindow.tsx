// apps/editor/src/components/ExportWindow.tsx
//
// Full-screen "render page" that REPLACES the old fire-and-forget export
// (Menubar.tsx's original inline `handleExportVideo`, which just spun the
// button and auto-downloaded). It opens over the whole editor and shows the
// render happening live — the real export canvas is mounted right in the
// preview, so the frames you see ARE the frames being encoded.
//
// It owns the export session end-to-end and walks five states:
//   setup      — pick resolution / format / quality, see size estimate
//   rendering  — live canvas + progress + filmstrip, Cancel
//   done       — playable <video> of the result, Download / Play / Export again
//   error      — encoder stalled / timed out, Retry / Back to settings
//   (cancel)   — abort mid-render, returns to setup with settings intact
//
// Wiring to the pipeline is unchanged in spirit from the old Menubar code —
// same `exportToMp4()` + `defaultExportDeps(media)` + `setIsExporting()` —
// with three additions this window relies on (all additive, see
// packages/export/src/index.ts):
//   • deps.createCanvas is overridden to mount the render canvas into the
//     preview instead of a detached node → the live preview.
//   • ExportOptions.outputSize scales the render to the chosen resolution.
//   • ExportOptions.signal (AbortSignal) makes Cancel abort between frames.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ArrowDownToLine, Check, Download, Pause, Play, RotateCcw, Square, Waves, X } from "lucide-react";
import type { ExportMediaService } from "export";
import { exportToMp4, defaultExportDeps } from "export";
import { useRegistry } from "../bootstrap/registry-context";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { closeExportWindow, getExportWindowState, subscribeExportWindow } from "../store/export-window-handle";

type Phase = "setup" | "rendering" | "done" | "error";

interface ResPreset {
  id: string;
  label: string;
  /** Target height in px; "source" uses the composition's own height. */
  targetH: number | "source";
}
const RES_PRESETS: ResPreset[] = [
  { id: "source", label: "Source", targetH: "source" },
  { id: "1080p", label: "1080p", targetH: 1080 },
  { id: "720p", label: "720p", targetH: 720 },
  { id: "480p", label: "480p", targetH: 480 },
];

interface FmtOption {
  id: string;
  label: string;
  tag: string;
  enabled: boolean;
}
const FMT_OPTIONS: FmtOption[] = [
  { id: "mp4", label: "MP4", tag: "H.264", enabled: true },
  { id: "webm", label: "WebM", tag: "Soon", enabled: false },
  { id: "gif", label: "GIF", tag: "Soon", enabled: false },
];

// How long WITHOUT any frame-progress callback before we call it a genuine
// stall. Video-heavy compositions are legitimately slow (each video b-roll
// frame needs a real <video> seek — see docs/adr/README.md ADR-016) but
// still land progress every frame; only an actual hang (WebGL context lost,
// encoder queue stuck) goes quiet for this long.
const STALL_TIMEOUT_MS = 60_000;
const STALL_CHECK_INTERVAL_MS = 5_000;

interface QualOption {
  id: string;
  label: string;
  desc: string;
  /** Reference bitrate in Mbps at 1920×1080; scaled by output pixel count. */
  mbps1080: number;
}
const QUAL_OPTIONS: QualOption[] = [
  { id: "high", label: "High", desc: "Best clarity", mbps1080: 16 },
  { id: "medium", label: "Medium", desc: "Balanced", mbps1080: 8 },
  { id: "low", label: "Low", desc: "Small file", mbps1080: 4 },
];

const THUMB_COUNT = 24;

/** even integer — H.264 requires even dimensions. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ExportWindow() {
  const { open } = useSyncExternalStore(subscribeExportWindow, getExportWindowState, getExportWindowState);
  if (!open) return null;
  return <ExportWindowInner />;
}

function ExportWindowInner() {
  const store = useEditorStoreApi();
  const registry = useRegistry();

  // Composition facts (read once on open; the window is modal over the editor).
  const comp = useEditorStore((s) => activeComp(s));
  const srcSize = comp.size;
  const fps = comp.fps;
  const totalFrames = comp.duration; // frames (see export virtual-clock)
  const durationSec = totalFrames / fps;

  const [phase, setPhase] = useState<Phase>("setup");
  const [resId, setResId] = useState("1080p");
  const [formatId, setFormatId] = useState("mp4");
  const [qualId, setQualId] = useState("high");
  const [canceledNote, setCanceledNote] = useState(false);

  // Progress (updated from onProgress — roughly every 4 frames).
  const [frame, setFrame] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [errorFrame, setErrorFrame] = useState(0);

  const previewHostRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const resultUrlRef = useRef<string | null>(null);
  // Stall watchdog — see `start()`. Tracks wall-clock time of the last
  // frame-progress callback; if no progress lands for STALL_TIMEOUT_MS, the
  // export is aborted and reported as stalled. Replaces a FIXED total-
  // duration timeout, which killed video-heavy exports that were slow but
  // genuinely still working (frame 412 in 5 minutes isn't a stall).
  const lastProgressAtRef = useRef(0);
  const stalledRef = useRef(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBytes, setResultBytes] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const locked = phase === "rendering";

  // ── Derived output geometry / bitrate ─────────────────────────────────
  const outSize = useMemo(() => {
    const preset = RES_PRESETS.find((r) => r.id === resId) ?? RES_PRESETS[1];
    if (preset.targetH === "source") return { width: even(srcSize.width), height: even(srcSize.height) };
    const scale = preset.targetH / srcSize.height;
    return { width: even(srcSize.width * scale), height: even(srcSize.height * scale) };
  }, [resId, srcSize.width, srcSize.height]);

  const bitrateBps = useMemo(() => {
    const q = QUAL_OPTIONS.find((x) => x.id === qualId) ?? QUAL_OPTIONS[0];
    const pixelRatio = (outSize.width * outSize.height) / (1920 * 1080);
    return Math.round(q.mbps1080 * 1_000_000 * pixelRatio);
  }, [qualId, outSize.width, outSize.height]);

  const estSizeMB = (bitrateBps * durationSec) / 8 / 1_000_000;
  const fileName = `${comp.name || "export"}.${formatId}`;

  // ── Cleanup object URL on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const clearResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
    setResultUrl(null);
    setResultBytes(0);
    setPlaying(false);
  }, []);

  // ── Start the real export ─────────────────────────────────────────────
  const start = useCallback(async () => {
    if (phase === "rendering") return;
    clearResult();
    setCanceledNote(false);
    setFrame(0);
    setElapsedMs(0);
    setPhase("rendering");
    store.getState().setIsExporting(true);

    const controller = new AbortController();
    abortRef.current = controller;
    startedAtRef.current = performance.now();
    lastProgressAtRef.current = performance.now();
    stalledRef.current = false;
    const stallInterval = setInterval(() => {
      if (performance.now() - lastProgressAtRef.current > STALL_TIMEOUT_MS) {
        stalledRef.current = true;
        controller.abort();
      }
    }, STALL_CHECK_INTERVAL_MS);

    // Snapshot settings for this run (state may change if user reopens).
    const runOut = outSize;
    const runBitrate = bitrateBps;

    try {
      const state = store.getState();
      const c = activeComp(state);
      const assets = state.document.project.assets;

      const media: ExportMediaService = {
        resolveAsset(assetId) {
          const asset = assets.find((a) => a.id === assetId);
          if (!asset) return undefined;
          return {
            id: asset.id,
            kind: asset.kind as "image" | "video" | "audio",
            // export wants full-quality master (proxy is a preview shortcut)
            url: asset.master ?? asset.proxy ?? "",
          };
        },
      };
      const resolveAudioUrl = (assetId: string): string | undefined =>
        assets.find((a) => a.id === assetId)?.master;

      // Override createCanvas so the render target is a VISIBLE canvas inside
      // the preview — this is what makes the export "play" as it encodes.
      const deps = {
        ...defaultExportDeps(media),
        createCanvas: (width: number, height: number): HTMLCanvasElement => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.className = "xport__canvas";
          const host = previewHostRef.current;
          if (host) {
            host.querySelector(".xport__canvas")?.remove();
            host.appendChild(canvas);
          }
          return canvas;
        },
      };

      const blob = await exportToMp4(
        {
          comp: c,
          registry,
          resolveAudioUrl,
          outputSize: runOut,
          videoBitrate: runBitrate,
          signal: controller.signal,
          onProgress: (done, total) => {
            lastProgressAtRef.current = performance.now();
            setFrame(done);
            setElapsedMs(performance.now() - startedAtRef.current);
          },
        },
        deps
      );

      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      setResultUrl(url);
      setResultBytes(blob.size);
      setFrame(totalFrames);
      setElapsedMs(performance.now() - startedAtRef.current);
      setPhase("done");
    } catch (err) {
      if (stalledRef.current) {
        // No frame progress for STALL_TIMEOUT_MS — genuinely stuck, not just
        // slow (a slow-but-working video-heavy export keeps landing progress
        // and never trips this).
        console.error("[ExportWindow] export stalled (no progress):", err);
        setErrorFrame(frame);
        setErrorMsg(
          `Export stalled — no progress for ${STALL_TIMEOUT_MS / 1000}s. The encoder likely hung; check the console for a WebGL/WebCodecs error.`
        );
        setPhase("error");
      } else if (controller.signal.aborted) {
        // User cancelled — return to setup, keep settings.
        setPhase("setup");
        setCanceledNote(true);
        setFrame(0);
      } else {
        // eslint-disable-next-line no-console
        console.error("[ExportWindow] export failed:", err);
        setErrorFrame(frame);
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    } finally {
      clearInterval(stallInterval);
      abortRef.current = null;
      store.getState().setIsExporting(false);
    }
  }, [phase, clearResult, store, registry, outSize, bitrateBps, totalFrames, frame]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const backToSetup = useCallback(() => {
    clearResult();
    setCanceledNote(false);
    setFrame(0);
    setElapsedMs(0);
    setPhase("setup");
  }, [clearResult]);

  const close = useCallback(() => {
    if (phase === "rendering") return; // finish or cancel first
    clearResult();
    closeExportWindow();
    setPhase("setup");
  }, [phase, clearResult]);

  const download = useCallback(() => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = fileName;
    a.click();
  }, [resultUrl, fileName]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  // Esc closes (setup/done/error only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // ── Derived UI values ─────────────────────────────────────────────────
  const progress = totalFrames ? frame / totalFrames : 0;
  const elapsedSec = elapsedMs / 1000;
  const encFps = elapsedSec > 0.25 ? frame / elapsedSec : 0;
  const etaSec = encFps > 0 ? (totalFrames - frame) / encFps : 0;

  const status = {
    setup: { text: "Ready to export", cls: "is-idle" },
    rendering: { text: "Rendering…", cls: "is-active" },
    done: { text: "Export ready", cls: "is-active" },
    error: { text: "Export failed", cls: "is-error" },
  }[phase];

  return (
    <div className="xport" role="dialog" aria-modal="true" aria-label="Export video">
      {/* ── Top bar ── */}
      <header className="xport__bar">
        <div className="xport__brand">
          <Waves size={20} />
          <span className="xport__brand-name">SeaBytes</span>
        </div>
        <div className="xport__rule" />
        <div className="xport__title">
          <span className="xport__eyebrow">Export</span>
          <span className="xport__comp">{comp.name || "Untitled"}</span>
        </div>
        <div className="xport__spacer" />
        <div className={`xport__status ${status.cls}`}>
          <span className="xport__status-dot" />
          {status.text}
        </div>
        <button type="button" className="xport__close" onClick={close} disabled={phase === "rendering"} title="Close export" aria-label="Close">
          <X size={16} />
        </button>
      </header>

      <div className="xport__body">
        {/* ── Stage ── */}
        <div className="xport__stage">
          <div className="xport__frame">
            <div ref={previewHostRef} className="xport__preview">
              {phase === "done" && resultUrl ? (
                <video
                  ref={videoRef}
                  className="xport__video"
                  src={resultUrl}
                  loop
                  autoPlay
                  playsInline
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
              ) : phase === "setup" ? (
                <div className="xport__poster">
                  <ArrowDownToLine size={30} />
                  <span>Ready to render {outSize.width}×{outSize.height}</span>
                </div>
              ) : null}
              {/* the render canvas is imperatively appended here during export */}
            </div>

            {phase === "rendering" && (
              <div className="xport__scan" aria-hidden="true">
                <div className="xport__scan-line" />
              </div>
            )}

            {phase === "done" && (
              <button type="button" className={`xport__play-overlay${playing ? " is-hidden" : ""}`} onClick={togglePlay} aria-label="Play result">
                <span className="xport__play-btn"><Play size={26} /></span>
              </button>
            )}

            {phase === "error" && (
              <div className="xport__error-overlay">
                <span className="xport__error-badge"><AlertTriangle size={26} /></span>
                <div className="xport__error-title">Export stalled</div>
                <div className="xport__error-text">{errorMsg}</div>
              </div>
            )}

            <div className="xport__badges">
              <span className="xport__badge">{outSize.width}×{outSize.height}</span>
              <span className="xport__badge xport__badge--accent">{formatId.toUpperCase()}</span>
            </div>
          </div>

          {/* Filmstrip */}
          <div className="xport__strip-wrap">
            <div className="xport__strip-head">
              <span className="xport__strip-label">Frames</span>
              <span className="xport__strip-count">{frame} / {totalFrames}</span>
            </div>
            <div className="xport__strip" style={{ gridTemplateColumns: `repeat(${THUMB_COUNT}, 1fr)` }}>
              {Array.from({ length: THUMB_COUNT }, (_, i) => {
                const cellEnd = (i + 1) / THUMB_COUNT;
                const filledBy = phase === "done" ? 1 : phase === "error" ? errorFrame / totalFrames : progress;
                const filled = cellEnd <= filledBy + 1e-6;
                const cursor = phase === "rendering" && !filled && i / THUMB_COUNT <= progress + 1e-6 && (i + 1) / THUMB_COUNT > progress;
                const errCell = phase === "error" && Math.abs(cellEnd - errorFrame / totalFrames) < 1 / THUMB_COUNT;
                const cls = errCell ? "is-error" : cursor ? "is-cursor" : filled ? "is-filled" : "is-empty";
                return <div key={i} className={`xport__cell ${cls}`} />;
              })}
            </div>
          </div>
        </div>

        {/* ── Settings / control rail ── */}
        <aside className="xport__rail">
          <div className="xport__rail-scroll">
            <div className="xport__section-label">Output settings</div>

            {/* Resolution */}
            <div className="xport__group">
              <div className="xport__group-title">Resolution</div>
              <div className="xport__grid xport__grid--2">
                {RES_PRESETS.map((r) => {
                  const dims = r.targetH === "source"
                    ? { width: even(srcSize.width), height: even(srcSize.height) }
                    : { width: even(srcSize.width * (r.targetH / srcSize.height)), height: even(r.targetH) };
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`xport__opt xport__opt--stack${r.id === resId ? " is-active" : ""}${locked ? " is-locked" : ""}`}
                      onClick={() => !locked && setResId(r.id)}
                    >
                      <span className="xport__opt-label">{r.label}</span>
                      <span className="xport__opt-sub">{dims.width}×{dims.height}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Format */}
            <div className="xport__group">
              <div className="xport__group-title">Format</div>
              <div className="xport__grid xport__grid--3">
                {FMT_OPTIONS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`xport__opt xport__opt--center${f.id === formatId ? " is-active" : ""}${!f.enabled || locked ? " is-locked" : ""}`}
                    onClick={() => !locked && f.enabled && setFormatId(f.id)}
                    disabled={!f.enabled}
                  >
                    <span className="xport__opt-label">{f.label}</span>
                    <span className="xport__opt-tag">{f.tag}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quality */}
            <div className="xport__group">
              <div className="xport__group-title">Quality</div>
              <div className="xport__col">
                {QUAL_OPTIONS.map((q) => {
                  const ratio = (outSize.width * outSize.height) / (1920 * 1080);
                  const mbps = q.mbps1080 * ratio;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`xport__opt xport__opt--row${q.id === qualId ? " is-active" : ""}${locked ? " is-locked" : ""}`}
                      onClick={() => !locked && setQualId(q.id)}
                    >
                      <span className="xport__opt-rowtext">
                        <span className="xport__opt-label">{q.label}</span>
                        <span className="xport__opt-sub">{q.desc}</span>
                      </span>
                      <span className="xport__opt-rate">{mbps < 10 ? mbps.toFixed(1) : mbps.toFixed(0)} Mb/s</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Estimate strip */}
            <div className="xport__estimate">
              <div className="xport__estimate-cell">
                <span className="xport__estimate-k">Duration</span>
                <span className="xport__estimate-v">0:{String(Math.round(durationSec)).padStart(2, "0")}</span>
              </div>
              <div className="xport__estimate-sep" />
              <div className="xport__estimate-cell">
                <span className="xport__estimate-k">Est. size</span>
                <span className="xport__estimate-v">{estSizeMB < 10 ? estSizeMB.toFixed(1) : estSizeMB.toFixed(0)} MB</span>
              </div>
              <div className="xport__estimate-sep" />
              <div className="xport__estimate-cell">
                <span className="xport__estimate-k">Frames</span>
                <span className="xport__estimate-v">{totalFrames}</span>
              </div>
            </div>

            {/* Progress (rendering) */}
            {phase === "rendering" && (
              <div className="xport__panel">
                <div className="xport__panel-head">
                  <span className="xport__pct">{Math.round(progress * 100)}%</span>
                  <span className="xport__encoding"><span className="xport__encoding-dot" />Encoding</span>
                </div>
                <div className="xport__progress"><div className="xport__progress-bar" style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
                <div className="xport__stats">
                  <div className="xport__stat"><span className="xport__stat-k">Elapsed</span><span className="xport__stat-v">{fmtClock(elapsedMs)}</span></div>
                  <div className="xport__stat"><span className="xport__stat-k">Remaining</span><span className="xport__stat-v">{encFps > 0 ? `~${fmtClock(etaSec * 1000)}` : "—"}</span></div>
                  <div className="xport__stat"><span className="xport__stat-k">Speed</span><span className="xport__stat-v">{encFps.toFixed(0)} fps</span></div>
                </div>
              </div>
            )}

            {/* Done summary */}
            {phase === "done" && (
              <div className="xport__panel">
                <div className="xport__done-head">
                  <span className="xport__done-check"><Check size={16} /></span>
                  <span className="xport__done-title">Render complete</span>
                </div>
                <div className="xport__kv"><span>File</span><span className="xport__mono">{fileName}</span></div>
                <div className="xport__kv"><span>Size</span><span className="xport__mono">{(resultBytes / 1_000_000).toFixed(1)} MB</span></div>
                <div className="xport__kv"><span>Resolution</span><span className="xport__mono">{outSize.width}×{outSize.height}</span></div>
                <div className="xport__kv"><span>Render time</span><span className="xport__mono">{fmtClock(elapsedMs)}</span></div>
              </div>
            )}

            {/* Error detail */}
            {phase === "error" && (
              <div className="xport__panel xport__panel--error">
                <div className="xport__err-head">Failed at frame {errorFrame}</div>
                <div className="xport__err-body">{errorMsg}</div>
              </div>
            )}
          </div>

          {/* ── Action footer ── */}
          <div className="xport__footer">
            {phase === "setup" && (
              <div className="xport__actions-col">
                {canceledNote && <div className="xport__note">Export canceled — settings preserved.</div>}
                <button type="button" className="xport__btn xport__btn--primary xport__btn--lg" onClick={() => void start()}>
                  <ArrowDownToLine size={17} />
                  Start Export
                </button>
              </div>
            )}

            {phase === "rendering" && (
              <button type="button" className="xport__btn xport__btn--ghost-danger xport__btn--lg" onClick={cancel}>
                <Square size={15} />
                Cancel
              </button>
            )}

            {phase === "done" && (
              <div className="xport__actions-col">
                <button type="button" className="xport__btn xport__btn--primary xport__btn--lg" onClick={download}>
                  <Download size={17} />
                  Download {formatId.toUpperCase()}
                </button>
                <div className="xport__actions-row">
                  <button type="button" className="xport__btn xport__btn--ghost" onClick={togglePlay}>
                    {playing ? <Pause size={15} /> : <Play size={15} />}
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button type="button" className="xport__btn xport__btn--ghost" onClick={backToSetup}>
                    <RotateCcw size={15} />
                    Export again
                  </button>
                </div>
              </div>
            )}

            {phase === "error" && (
              <div className="xport__actions-row">
                <button type="button" className="xport__btn xport__btn--ghost" onClick={backToSetup}>Back to settings</button>
                <button type="button" className="xport__btn xport__btn--primary" onClick={() => void start()}>
                  <RotateCcw size={16} />
                  Retry
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

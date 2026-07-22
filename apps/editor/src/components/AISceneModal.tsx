// apps/editor/src/components/AISceneModal.tsx
//
// "Generate AI Scene" modal — three phases:
//   input    → format picker (+ per-format voice/motion/media summary) +
//              media-mode override + topic entry
//   running  → real per-step progress (label + detail + bar) with Cancel
//   preview  → STORYBOARD + asset review: per-beat thumb (image or video),
//              relevance score, keyword + duration, sequential voiceover
//              playback, and per-beat ↺ Reroll / → Video·Image / ✕ Reject
//              (POST /api/scene/reroll — server excludes whatever was
//              already shown so it never repeats) — then Import / Discard.
//              Nothing touches the editor until Import.
//
// The scene comes back RAW from scene-generate.ts; we compile + load it only
// on Import (compileGeneratedScene → loadProjectDocument), the same path as
// manual Import Scene… / Open….
//
// The format picker is populated from GET /api/scene/formats so it reflects
// whatever recipes exist under prompts/formats/ — no hardcoded list. If the
// server is unreachable, it falls back to a single default so the user can
// still generate.
//
// Styled inline with the SeaBytes theme CSS variables (theme.css).

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Download, Film, ImageIcon, Loader2, Play, RotateCcw, Sparkles, Square, Trash2, X, XCircle,
} from "lucide-react";
import { useEditorStoreApi } from "../store/context";
import {
  generateScene,
  compileGeneratedScene,
  listFormats,
  rerollVisual,
  SceneGenerateError,
  DEFAULT_FORMAT,
} from "../persistence/scene-generate";
import type { GenerateProgress, MediaMode, SceneAsset, SceneFormat, SceneVisual } from "../persistence/scene-generate";
import { closeAIScene, getAISceneState, subscribeAIScene } from "../store/ai-scene-handle";

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 210, display: "flex",
  alignItems: "center", justifyContent: "center",
  background: "rgba(4, 8, 10, 0.6)", backdropFilter: "blur(3px)",
};

const FALLBACK_FORMATS: SceneFormat[] = [
  { id: DEFAULT_FORMAT, label: "Short-form (TikTok / Reels)", description: "High-retention creator opinion." },
];

const MEDIA_MODES: { id: MediaMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "hybrid", label: "Hybrid" },
];

/** Patches one beat's visual + its asset into a raw scene object (reroll response) — returns a new scene, never mutates the input. */
function patchSceneVisual(scene: any, beatIndex: number, visual: SceneVisual, asset: SceneAsset): any {
  const oldAssetId = scene.beats[beatIndex]?.visual?.asset_id;
  const assets = (scene.assets ?? []).filter((a: SceneAsset) => a.id !== oldAssetId && a.id !== asset.id);
  assets.push(asset);
  const beats = scene.beats.map((b: any, i: number) => (i === beatIndex ? { ...b, visual } : b));
  return { ...scene, assets, beats };
}

export function AISceneModal() {
  const { open } = useSyncExternalStore(subscribeAIScene, getAISceneState, getAISceneState);
  if (!open) return null;
  return <AISceneModalInner />;
}

type Phase = "input" | "running" | "preview";

interface StoryBeat {
  keyword: string;
  seconds: number;
  mediaUrl?: string;
  kind?: "image" | "video";
  relevance?: number;
}

function AISceneModalInner() {
  const store = useEditorStoreApi();
  const [phase, setPhase] = useState<Phase>("input");
  const [topic, setTopic] = useState("");
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [error, setError] = useState("");
  const [scene, setScene] = useState<any>(null);
  const [title, setTitle] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Format picker state.
  const [formats, setFormats] = useState<SceneFormat[]>(FALLBACK_FORMATS);
  const [format, setFormat] = useState<string>(DEFAULT_FORMAT);
  const [mediaMode, setMediaMode] = useState<MediaMode>("auto");

  // Asset review — which job this scene came from (for reroll), and which
  // beat (if any) currently has a reroll in flight.
  const [jobId, setJobId] = useState<string | null>(null);
  const [rerollingBeat, setRerollingBeat] = useState<number | null>(null);
  const rerollAbortRef = useRef<AbortController | null>(null);

  // Sequential voiceover playback for the preview.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => { if (phase === "input") inputRef.current?.focus(); }, [phase]);
  useEffect(() => () => { abortRef.current?.abort(); audioRef.current?.pause(); }, []);

  // Load the available formats once when the modal mounts.
  useEffect(() => {
    const ac = new AbortController();
    listFormats(ac.signal).then((fs) => {
      if (fs.length === 0) return; // keep fallback
      setFormats(fs);
      setFormat((cur) => (fs.some((f) => f.id === cur) ? cur : fs[0].id));
    });
    return () => ac.abort();
  }, []);

  const activeFormat = useMemo(
    () => formats.find((f) => f.id === format) ?? formats[0],
    [formats, format]
  );

  // ── Derived storyboard from the raw scene ────────────────────────────────
  const { beats, totalSec, voUrls } = useMemo(() => {
    const assets: any[] = scene?.assets ?? [];
    const byId = new Map<string, any>(assets.map((a) => [a.id, a]));
    const bs: StoryBeat[] = (scene?.beats ?? []).map((b: any) => ({
      keyword: b.keyword || b.hud_tag || "—",
      seconds: (b.duration_ms ?? 4000) / 1000,
      mediaUrl: b.visual?.asset_id ? byId.get(b.visual.asset_id)?.url : undefined,
      kind: b.visual?.kind,
      relevance: typeof b.visual?.relevance === "number" ? b.visual.relevance : undefined,
    }));
    const vo: string[] = (scene?.beats ?? [])
      .map((b: any) => (b.audio?.asset_id ? byId.get(b.audio.asset_id)?.url : undefined))
      .filter(Boolean) as string[];
    return { beats: bs, totalSec: bs.reduce((s, b) => s + b.seconds, 0), voUrls: vo };
  }, [scene]);

  const busy = phase === "running";

  const reset = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    rerollAbortRef.current?.abort();
    setPlaying(false);
    setScene(null);
    setProgress(null);
    setError("");
    setJobId(null);
    setRerollingBeat(null);
    setPhase("input");
  }, []);

  const close = useCallback(() => {
    if (busy) return; // cancel first
    audioRef.current?.pause();
    rerollAbortRef.current?.abort();
    closeAIScene();
    setPhase("input");
    setScene(null);
    setProgress(null);
    setJobId(null);
    setRerollingBeat(null);
  }, [busy]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase("input");
    setProgress(null);
  }, []);

  const run = useCallback(async () => {
    const t = topic.trim();
    if (!t || busy) return;
    setError("");
    setProgress({ state: "queued", step: 0, total_steps: 5, label: "Queued", pct: 0 });
    setPhase("running");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { scene: raw, title: tt, jobId: id } = await generateScene({
        topic: t,
        format,
        mediaMode,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setScene(raw);
      setJobId(id);
      setTitle(tt || (raw?.video_id ?? "Generated scene"));
      setPhase("preview");
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        e instanceof SceneGenerateError
          ? e.message
          : `Could not reach the scene server. Is it running on the configured port? (${e instanceof Error ? e.message : String(e)})`
      );
      setPhase("input");
      setProgress(null);
    } finally {
      abortRef.current = null;
    }
  }, [topic, busy, format, mediaMode]);

  // ── Asset review: reroll / convert / reject ──────────────────────────────
  const handleReroll = useCallback(async (beatIndex: number, mode?: "image" | "video") => {
    if (!jobId || rerollingBeat !== null) return;
    setRerollingBeat(beatIndex);
    setError("");
    const controller = new AbortController();
    rerollAbortRef.current = controller;
    try {
      const res = await rerollVisual(jobId, beatIndex, mode, controller.signal);
      setScene((prev: any) => patchSceneVisual(prev, res.beat_index, res.visual, res.asset));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        e instanceof SceneGenerateError ? e.message : `Could not reroll this beat: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      rerollAbortRef.current = null;
      setRerollingBeat(null);
    }
  }, [jobId, rerollingBeat]);

  const handleReject = useCallback((beatIndex: number) => {
    setScene((prev: any) => ({
      ...prev,
      beats: prev.beats.map((b: any, i: number) => (i === beatIndex ? { ...b, visual: undefined } : b)),
    }));
  }, []);

  const doImport = useCallback(() => {
    if (!scene) return;
    audioRef.current?.pause();
    try {
      const project = compileGeneratedScene(scene);
      store.getState().loadProjectDocument(project);
      closeAIScene();
      reset();
    } catch (e) {
      setError(`Could not import scene: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [scene, store, reset]);

  // Play the beat voiceovers back-to-back so the user can hear the narration.
  const togglePlay = useCallback(() => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (voUrls.length === 0) return;
    let i = 0;
    const el = new Audio(voUrls[0]);
    audioRef.current = el;
    el.onended = () => {
      i += 1;
      if (i < voUrls.length) { el.src = voUrls[i]; void el.play(); }
      else setPlaying(false);
    };
    void el.play();
    setPlaying(true);
  }, [playing, voUrls]);

  const pct = progress?.pct ?? 0;
  const wide = phase === "preview";

  const card: React.CSSProperties = {
    width: wide ? 760 : 480, maxWidth: "94vw", background: "var(--surface-1)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 10px)",
    boxShadow: "0 24px 70px rgba(0,0,0,0.55)", color: "var(--text-0)",
    fontFamily: "var(--font-ui)", overflow: "hidden",
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Generate AI scene" onMouseDown={close}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ color: "var(--accent)", display: "flex" }}><Sparkles size={18} /></span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{phase === "preview" ? "Preview scene" : "Generate AI Scene"}</span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={close} disabled={busy} aria-label="Close"
            style={{ display: "flex", width: 30, height: 30, alignItems: "center", justifyContent: "center",
              borderRadius: 7, border: "1px solid var(--border)", background: "transparent",
              color: "var(--text-1)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.4 : 1 }}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18 }}>
          {phase === "input" && (
            <>
              {/* Format picker */}
              <label style={{ fontSize: 12, color: "var(--text-2)", display: "block", marginBottom: 7 }}>
                Video format
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 6 }}>
                {formats.map((f) => {
                  const selected = f.id === format;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFormat(f.id)}
                      title={f.description}
                      style={{
                        padding: "7px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                        cursor: "pointer", fontFamily: "var(--font-ui)",
                        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                        background: selected ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface-0)",
                        color: selected ? "var(--accent)" : "var(--text-1)",
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5, margin: "0 2px 6px", minHeight: 16 }}>
                {activeFormat?.description || "\u00a0"}
              </p>
              {activeFormat?.profile_summary && (
                <p style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5, margin: "0 2px 16px",
                  fontFamily: "var(--font-mono)", opacity: 0.85 }}>
                  voice: {activeFormat.profile_summary.voice} \u00b7 motion: {activeFormat.profile_summary.motion} \u00b7 media: {activeFormat.profile_summary.media}
                </p>
              )}

              {/* Media mode */}
              <label style={{ fontSize: 12, color: "var(--text-2)", display: "block", marginBottom: 7 }}>
                Media
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                {MEDIA_MODES.map((m) => {
                  const selected = m.id === mediaMode;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMediaMode(m.id)}
                      style={{
                        padding: "6px 11px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                        cursor: "pointer", fontFamily: "var(--font-ui)",
                        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                        background: selected ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface-0)",
                        color: selected ? "var(--accent)" : "var(--text-1)",
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {/* Topic */}
              <label style={{ fontSize: 12, color: "var(--text-2)", display: "block", marginBottom: 7 }}>
                What should the video be about?
              </label>
              <input
                ref={inputRef}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
                placeholder="e.g. why linux beats windows for developers"
                style={{ width: "100%", height: 42, padding: "0 12px", boxSizing: "border-box",
                  borderRadius: 8, border: "1px solid var(--border-strong, var(--border))",
                  background: "var(--surface-0)", color: "var(--text-0)", fontSize: 14, fontFamily: "var(--font-ui)" }}
              />
              <p style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5, margin: "10px 2px 0" }}>
                Writes a script in the chosen format, generates the voiceover, fetches matching visuals,
                then shows a preview here before importing. Takes up to a couple of minutes.
              </p>
            </>
          )}

          {phase === "running" && progress && (
            <div style={{ padding: "6px 2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                <Loader2 size={16} className="spin" style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{progress.label}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" }}>
                  {progress.step}/{progress.total_steps} · {pct}%
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-2)", minHeight: 14, marginBottom: 10, fontFamily: "var(--font-mono)" }}>
                {progress.detail || "\u00a0"}
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--surface-0)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4,
                  background: "linear-gradient(90deg, var(--accent), var(--accent-strong, var(--accent)))",
                  transition: "width 300ms ease" }} />
              </div>
            </div>
          )}

          {phase === "preview" && scene && (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
                <span style={{ fontSize: 12, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
                  {beats.length} beats · {totalSec.toFixed(0)}s
                </span>
                {voUrls.length > 0 && (
                  <button type="button" onClick={togglePlay} className="btn btn-outline" style={{ marginLeft: "auto", gap: 6 }}>
                    {playing ? <Square size={13} /> : <Play size={13} />}
                    {playing ? "Stop" : "Play voiceover"}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
                {beats.map((b, i) => {
                  const rerolling = rerollingBeat === i;
                  const anyRerolling = rerollingBeat !== null;
                  const iconBtn: React.CSSProperties = {
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 24, height: 24, borderRadius: 6, border: "1px solid var(--border)",
                    background: "var(--surface-0)", color: "var(--text-1)",
                    cursor: anyRerolling ? "default" : "pointer", opacity: anyRerolling ? 0.4 : 1,
                  };
                  return (
                    <div key={i} style={{ flex: "0 0 168px", width: 168 }}>
                      <div style={{ position: "relative", width: 168, height: 94, borderRadius: 7, overflow: "hidden",
                        border: "1px solid var(--border)", background: "var(--surface-2)",
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {rerolling && (
                          <div style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex",
                            alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
                            <Loader2 size={18} className="spin" style={{ color: "#fff" }} />
                          </div>
                        )}
                        {b.mediaUrl && b.kind === "video" ? (
                          <video src={b.mediaUrl} muted loop autoPlay playsInline
                            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : b.mediaUrl ? (
                          <img src={b.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <span style={{ fontSize: 10, color: "var(--text-2)" }}>no visual</span>
                        )}
                        <span style={{ position: "absolute", left: 5, top: 5, fontSize: 9, fontFamily: "var(--font-mono)",
                          color: "#fff", background: "rgba(0,0,0,0.55)", padding: "1px 5px", borderRadius: 4 }}>{i + 1}</span>
                        {b.kind && (
                          <span style={{ position: "absolute", left: 5, bottom: 5, fontSize: 8.5, fontFamily: "var(--font-mono)",
                            fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase",
                            color: "#fff", background: "rgba(0,0,0,0.55)", padding: "1px 5px", borderRadius: 4 }}>{b.kind}</span>
                        )}
                        <span style={{ position: "absolute", right: 5, bottom: 5, fontSize: 9, fontFamily: "var(--font-mono)",
                          color: "#fff", background: "rgba(0,0,0,0.55)", padding: "1px 5px", borderRadius: 4 }}>{b.seconds.toFixed(1)}s</span>
                      </div>

                      {typeof b.relevance === "number" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                          <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--surface-0)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.round(Math.min(1, b.relevance) * 100)}%`, borderRadius: 2,
                              background: b.relevance < 0.4 ? "var(--danger, #f0654a)" : "var(--accent)" }} />
                          </div>
                          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>
                            {b.relevance.toFixed(2)}
                          </span>
                        </div>
                      )}

                      <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 5, lineHeight: 1.25,
                        overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{b.keyword}</div>

                      <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                        <button type="button" title="Reroll" disabled={anyRerolling} style={iconBtn}
                          onClick={() => void handleReroll(i)}>
                          <RotateCcw size={12} />
                        </button>
                        {b.kind && (
                          <button
                            type="button"
                            title={b.kind === "video" ? "Convert to image" : "Convert to video"}
                            disabled={anyRerolling}
                            style={iconBtn}
                            onClick={() => void handleReroll(i, b.kind === "video" ? "image" : "video")}
                          >
                            {b.kind === "video" ? <ImageIcon size={12} /> : <Film size={12} />}
                          </button>
                        )}
                        {b.mediaUrl && (
                          <button type="button" title="Reject" disabled={anyRerolling} style={iconBtn}
                            onClick={() => handleReject(i)}>
                            <XCircle size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8,
              background: "rgba(240,101,74,0.08)", border: "1px solid rgba(240,101,74,0.3)",
              color: "var(--text-1)", fontSize: 12, lineHeight: 1.5 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", padding: "14px 18px", borderTop: "1px solid var(--border)" }}>
          {phase === "running" ? (
            <button type="button" onClick={cancel} className="btn btn-outline">Cancel</button>
          ) : phase === "preview" ? (
            <>
              <button type="button" onClick={reset} className="btn btn-outline" style={{ gap: 6 }}>
                <Trash2 size={14} /> Discard
              </button>
              <button type="button" onClick={doImport} disabled={rerollingBeat !== null} className="btn btn-primary" style={{ gap: 6 }}>
                <Download size={14} /> Import to editor
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={close} className="btn btn-outline">Close</button>
              <button type="button" onClick={() => void run()} disabled={!topic.trim()} className="btn btn-primary" style={{ gap: 6 }}>
                <Sparkles size={14} /> Generate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

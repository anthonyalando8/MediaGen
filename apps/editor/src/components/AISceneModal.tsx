// apps/editor/src/components/AISceneModal.tsx
//
// "Generate AI Scene" modal — three phases:
//   input    → format picker + topic entry
//   running  → real per-step progress (label + detail + bar) with Cancel
//   preview  → STORYBOARD of the finished scene (title, per-beat image thumb +
//              keyword + duration, sequential voiceover playback) with
//              Import / Discard — nothing touches the editor until Import.
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
import { Download, Loader2, Play, Sparkles, Square, Trash2, X } from "lucide-react";
import { useEditorStoreApi } from "../store/context";
import {
  generateScene,
  compileGeneratedScene,
  listFormats,
  SceneGenerateError,
  DEFAULT_FORMAT,
} from "../persistence/scene-generate";
import type { GenerateProgress, SceneFormat } from "../persistence/scene-generate";
import { closeAIScene, getAISceneState, subscribeAIScene } from "../store/ai-scene-handle";

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 210, display: "flex",
  alignItems: "center", justifyContent: "center",
  background: "rgba(4, 8, 10, 0.6)", backdropFilter: "blur(3px)",
};

const FALLBACK_FORMATS: SceneFormat[] = [
  { id: DEFAULT_FORMAT, label: "Short-form (TikTok / Reels)", description: "High-retention creator opinion." },
];

export function AISceneModal() {
  const { open } = useSyncExternalStore(subscribeAIScene, getAISceneState, getAISceneState);
  if (!open) return null;
  return <AISceneModalInner />;
}

type Phase = "input" | "running" | "preview";

interface StoryBeat {
  keyword: string;
  seconds: number;
  imageUrl?: string;
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
      imageUrl: b.visual?.asset_id ? byId.get(b.visual.asset_id)?.url : undefined,
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
    setPlaying(false);
    setScene(null);
    setProgress(null);
    setError("");
    setPhase("input");
  }, []);

  const close = useCallback(() => {
    if (busy) return; // cancel first
    audioRef.current?.pause();
    closeAIScene();
    setPhase("input");
    setScene(null);
    setProgress(null);
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
      const { scene: raw, title: tt } = await generateScene({
        topic: t,
        format,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setScene(raw);
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
  }, [topic, busy, format]);

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
              <p style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5, margin: "0 2px 16px", minHeight: 16 }}>
                {activeFormat?.description || "\u00a0"}
              </p>

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
                {beats.map((b, i) => (
                  <div key={i} style={{ flex: "0 0 148px", width: 148 }}>
                    <div style={{ position: "relative", width: 148, height: 84, borderRadius: 7, overflow: "hidden",
                      border: "1px solid var(--border)", background: "var(--surface-2)",
                      display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {b.imageUrl
                        ? <img src={b.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ fontSize: 10, color: "var(--text-2)" }}>no visual</span>}
                      <span style={{ position: "absolute", left: 5, top: 5, fontSize: 9, fontFamily: "var(--font-mono)",
                        color: "#fff", background: "rgba(0,0,0,0.55)", padding: "1px 5px", borderRadius: 4 }}>{i + 1}</span>
                      <span style={{ position: "absolute", right: 5, bottom: 5, fontSize: 9, fontFamily: "var(--font-mono)",
                        color: "#fff", background: "rgba(0,0,0,0.55)", padding: "1px 5px", borderRadius: 4 }}>{b.seconds.toFixed(1)}s</span>
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 6, lineHeight: 1.25,
                      overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{b.keyword}</div>
                  </div>
                ))}
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
              <button type="button" onClick={doImport} className="btn btn-primary" style={{ gap: 6 }}>
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

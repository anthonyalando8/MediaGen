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
  Download, FileText, Film, ImageIcon, Loader2, Play, RotateCcw, Sparkles, Square,
  Trash2, Upload, Wand2, X, XCircle,
} from "lucide-react";
import { useEditorStoreApi } from "../store/context";
import {
  generateScene,
  compileGeneratedScene,
  listFormats,
  listVoices,
  previewVoice,
  rerollVisual,
  SceneGenerateError,
  DEFAULT_FORMAT,
} from "../persistence/scene-generate";
import type { GenerateProgress, MediaMode, SceneAsset, SceneFormat, SceneVisual, SourceKind, VoiceOption } from "../persistence/scene-generate";
import { closeAIScene, getAISceneState, subscribeAIScene } from "../store/ai-scene-handle";

// Full-viewport, fixed-inset-0 flex-column — the same pattern
// ExportWindow.tsx uses for its "render page" (header bar pinned top, a
// scrollable body filling the rest, footer pinned bottom). Was previously a
// small centered modal; with long scripts (20+ beats) that cramped preview
// strip was the whole reason the dialog felt sluggish/hard to scroll —
// fullscreen gives the beat grid room to breathe instead of fighting a
// fixed card size.
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 210,
  display: "flex", flexDirection: "column",
  background: "var(--surface-1)",
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

/** ArrayBuffer -> base64, chunked so a multi-MB PDF doesn't blow the call
 * stack on `String.fromCharCode(...bytes)` (spreading a huge typed array as
 * call args is the actual failure mode this avoids). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

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

  // Source mode: a short topic phrase (default, unchanged) vs. existing
  // content (article/blog/markdown/own script, or an uploaded file) that
  // generation should be based on instead — see ingest.py server-side.
  const [inputMode, setInputMode] = useState<"topic" | "content">("topic");
  const [sourceText, setSourceText] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("plain_text");
  const [sourcePdfBase64, setSourcePdfBase64] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [sourceFileError, setSourceFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Format picker state. `autoFormat` (content mode only) means "let the
  // server pick from the content's length" (ingest._suggest_format) instead
  // of forcing whatever chip happens to be selected.
  const [formats, setFormats] = useState<SceneFormat[]>(FALLBACK_FORMATS);
  const [format, setFormat] = useState<string>(DEFAULT_FORMAT);
  const [autoFormat, setAutoFormat] = useState(true);
  const [mediaMode, setMediaMode] = useState<MediaMode>("auto");

  // Voice picker state. voiceId === "" means "Automatic" (today's genre/LLM-driven choice).
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Asset review — which job this scene came from (for reroll), and which
  // beat (if any) currently has a reroll in flight.
  const [jobId, setJobId] = useState<string | null>(null);
  const [rerollingBeat, setRerollingBeat] = useState<number | null>(null);
  const rerollAbortRef = useRef<AbortController | null>(null);

  // Sequential voiceover playback for the preview.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => { if (phase === "input" && inputMode === "topic") inputRef.current?.focus(); }, [phase, inputMode]);
  useEffect(() => () => { abortRef.current?.abort(); audioRef.current?.pause(); previewAudioRef.current?.pause(); }, []);

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

  // Load the English voice catalog once when the modal mounts. Empty list on
  // failure just means the picker shows only "Automatic" — generation still works.
  useEffect(() => {
    const ac = new AbortController();
    listVoices(ac.signal).then(setVoices);
    return () => ac.abort();
  }, []);

  const activeFormat = useMemo(
    () => formats.find((f) => f.id === format) ?? formats[0],
    [formats, format]
  );

  const voiceGroups = useMemo(() => {
    const groups: { label: string; voices: VoiceOption[] }[] = [
      { label: "American — female", voices: [] },
      { label: "American — male", voices: [] },
      { label: "British — female", voices: [] },
      { label: "British — male", voices: [] },
    ];
    for (const v of voices) {
      const idx = (v.accent === "American" ? 0 : 2) + (v.gender === "male" ? 1 : 0);
      groups[idx].voices.push(v);
    }
    return groups.filter((g) => g.voices.length > 0);
  }, [voices]);

  const previewSelectedVoice = useCallback(async () => {
    if (!voiceId || previewingVoice) return;
    setPreviewingVoice(true);
    try {
      const { url } = await previewVoice(voiceId);
      previewAudioRef.current?.pause();
      const el = new Audio(url);
      previewAudioRef.current = el;
      void el.play();
      el.onended = () => setPreviewingVoice(false);
      el.onerror = () => setPreviewingVoice(false);
    } catch {
      setPreviewingVoice(false);
    }
  }, [voiceId, previewingVoice]);

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
    previewAudioRef.current?.pause();
    setPreviewingVoice(false);
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
    previewAudioRef.current?.pause();
    setPreviewingVoice(false);
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

  // Reads a dropped/picked file client-side: .pdf -> base64 (server extracts
  // text via pypdf), anything else -> read as text with the kind guessed
  // from extension (.md/.markdown -> markdown, else -> plain_text; the user
  // can still override the kind dropdown after).
  const handleFileChosen = useCallback(async (file: File) => {
    setSourceFileError("");
    setSourceFileName(file.name);
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".pdf")) {
        const buf = await file.arrayBuffer();
        setSourcePdfBase64(arrayBufferToBase64(buf));
        setSourceText("");
      } else {
        const text = await file.text();
        setSourceText(text);
        setSourcePdfBase64(null);
        setSourceKind(lower.endsWith(".md") || lower.endsWith(".markdown") ? "markdown" : "plain_text");
      }
    } catch (e) {
      setSourceFileError(`Could not read "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
      setSourceFileName(null);
      setSourcePdfBase64(null);
    }
  }, []);

  const clearSourceFile = useCallback(() => {
    setSourceFileName(null);
    setSourcePdfBase64(null);
    setSourceText("");
    setSourceFileError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const hasContent = inputMode === "content" && !!(sourcePdfBase64 || sourceText.trim());

  const run = useCallback(async () => {
    const t = topic.trim();
    if (busy) return;
    if (inputMode === "topic" ? !t : !hasContent) return;
    setError("");
    setProgress({ state: "queued", step: 0, total_steps: 5, label: "Queued", pct: 0 });
    setPhase("running");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { scene: raw, title: tt, jobId: id } = await generateScene({
        topic: inputMode === "topic" ? t : undefined,
        ...(inputMode === "content" && sourcePdfBase64 ? { sourcePdfBase64 } : {}),
        ...(inputMode === "content" && !sourcePdfBase64 && sourceText.trim()
          ? { sourceText, sourceKind } : {}),
        format: inputMode === "content" && autoFormat ? undefined : format,
        mediaMode,
        voiceId: voiceId || undefined,
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
  }, [topic, busy, format, mediaMode, voiceId, inputMode, hasContent, sourceText, sourceKind, sourcePdfBase64, autoFormat]);

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
  // Preview's beat grid wants the full viewport width to breathe; the
  // input/running forms read better capped like a normal form instead of
  // stretching edge-to-edge on a wide monitor.
  const contentStyle: React.CSSProperties | undefined =
    phase === "preview" ? undefined : { maxWidth: 720, margin: "0 auto" };

  const card: React.CSSProperties = {
    width: "100%", height: "100%",
    display: "flex", flexDirection: "column",
    background: "var(--surface-1)", color: "var(--text-0)",
    fontFamily: "var(--font-ui)", overflow: "hidden",
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Generate AI scene">
      <div style={card}>
        {/* Header — pinned; body scrolls independently below */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
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

        {/* Body — the scrollable region. flex:1 + minHeight:0 is load-bearing:
            without minHeight:0 a flex child never shrinks below its content
            size, so overflowY:auto would never actually kick in. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 24 }}>
        <div style={contentStyle}>
          {phase === "input" && (
            <>
              {/* Source mode: a short topic phrase vs. existing content */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16, padding: 3,
                background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 9 }}>
                {([
                  { id: "topic" as const, label: "Topic", icon: Wand2 },
                  { id: "content" as const, label: "Your own content", icon: FileText },
                ]).map(({ id, label, icon: Icon }) => {
                  const selected = inputMode === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setInputMode(id)}
                      style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        padding: "7px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                        cursor: "pointer", fontFamily: "var(--font-ui)", border: "none",
                        background: selected ? "var(--surface-1)" : "transparent",
                        color: selected ? "var(--text-0)" : "var(--text-2)",
                        boxShadow: selected ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                      }}
                    >
                      <Icon size={13} /> {label}
                    </button>
                  );
                })}
              </div>

              {/* Format picker */}
              <label style={{ fontSize: 12, color: "var(--text-2)", display: "block", marginBottom: 7 }}>
                Video format
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 6 }}>
                {inputMode === "content" && (
                  <button
                    type="button"
                    onClick={() => setAutoFormat(true)}
                    title="Let the server pick a format from how long your content is"
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "7px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                      cursor: "pointer", fontFamily: "var(--font-ui)",
                      border: `1px solid ${autoFormat ? "var(--accent)" : "var(--border)"}`,
                      background: autoFormat ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface-0)",
                      color: autoFormat ? "var(--accent)" : "var(--text-1)",
                    }}
                  >
                    <Wand2 size={12} /> Auto
                  </button>
                )}
                {formats.map((f) => {
                  const selected = f.id === format && !(inputMode === "content" && autoFormat);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => { setFormat(f.id); setAutoFormat(false); }}
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
                {inputMode === "content" && autoFormat
                  ? "Picked automatically once generation starts, based on how long your content is."
                  : activeFormat?.description || "\u00a0"}
              </p>
              {!(inputMode === "content" && autoFormat) && activeFormat?.profile_summary && (
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

              {/* Voice */}
              <label style={{ fontSize: 12, color: "var(--text-2)", display: "block", marginBottom: 7 }}>
                Voice
              </label>
              <div style={{ display: "flex", gap: 7, marginBottom: 16 }}>
                <select
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  style={{ flex: 1, height: 34, padding: "0 10px", borderRadius: 8,
                    border: "1px solid var(--border)", background: "var(--surface-0)",
                    color: "var(--text-0)", fontSize: 12.5, fontFamily: "var(--font-ui)" }}
                >
                  <option value="">Automatic (genre decides)</option>
                  {voiceGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.voices.map((v) => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  title="Preview voice"
                  onClick={() => void previewSelectedVoice()}
                  disabled={!voiceId || previewingVoice}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center",
                    width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)",
                    background: "var(--surface-0)", color: "var(--text-1)",
                    cursor: !voiceId || previewingVoice ? "default" : "pointer",
                    opacity: !voiceId || previewingVoice ? 0.4 : 1 }}
                >
                  {previewingVoice ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                </button>
              </div>

              {inputMode === "topic" ? (
                <>
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
              ) : (
                <>
                  {/* Existing content: paste text, or upload a file */}
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                    <label style={{ fontSize: 12, color: "var(--text-2)" }}>
                      Paste an article, blog post, or your own script
                    </label>
                    <select
                      value={sourceKind}
                      onChange={(e) => setSourceKind(e.target.value as SourceKind)}
                      disabled={!!sourcePdfBase64}
                      title="How to read the pasted/uploaded text"
                      style={{ height: 24, padding: "0 6px", borderRadius: 6, fontSize: 11,
                        border: "1px solid var(--border)", background: "var(--surface-0)",
                        color: "var(--text-1)", fontFamily: "var(--font-ui)",
                        opacity: sourcePdfBase64 ? 0.5 : 1 }}
                    >
                      <option value="plain_text">Article / blog</option>
                      <option value="markdown">Markdown</option>
                      <option value="script">My own script (line per beat)</option>
                    </select>
                  </div>

                  {sourcePdfBase64 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 42, padding: "0 12px",
                      borderRadius: 8, border: "1px solid var(--border-strong, var(--border))", background: "var(--surface-0)" }}>
                      <FileText size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: "var(--text-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {sourceFileName}
                      </span>
                      <button type="button" onClick={clearSourceFile} title="Remove file"
                        style={{ display: "flex", background: "transparent", border: "none", color: "var(--text-2)", cursor: "pointer", padding: 2 }}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <textarea
                      value={sourceText}
                      onChange={(e) => { setSourceText(e.target.value); setSourceFileName(null); }}
                      placeholder="Paste the full text here — the AI restructures it into beats, it doesn't just read it verbatim…"
                      rows={6}
                      style={{ width: "100%", padding: "10px 12px", boxSizing: "border-box", resize: "vertical",
                        borderRadius: 8, border: "1px solid var(--border-strong, var(--border))",
                        background: "var(--surface-0)", color: "var(--text-0)", fontSize: 13, lineHeight: 1.5,
                        fontFamily: "var(--font-ui)" }}
                    />
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="btn btn-outline"
                      style={{ gap: 6, fontSize: 12 }}
                    >
                      <Upload size={13} /> {sourcePdfBase64 || sourceFileName ? "Replace file" : "Upload a file instead"}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--text-2)" }}>.txt · .md · .pdf</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.markdown,.pdf"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileChosen(f); }}
                      style={{ display: "none" }}
                    />
                  </div>
                  {sourceFileError && (
                    <p style={{ fontSize: 11.5, color: "var(--danger, #f0654a)", margin: "8px 2px 0" }}>{sourceFileError}</p>
                  )}
                  <p style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5, margin: "10px 2px 0" }}>
                    Restructures your content into a video script (same meaning, video-ready pacing),
                    then generates voiceover + visuals same as the Topic mode.
                  </p>
                </>
              )}
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
                          // Paused by default (shows the first frame as a static
                          // thumbnail via preload="metadata") — with 20+ beats,
                          // autoplaying every card's video at once was the actual
                          // cause of the dialog going sluggish (concurrent decode/
                          // compositor load), not React re-renders. Play only the
                          // card actually being looked at.
                          <video
                            src={b.mediaUrl} muted loop playsInline preload="metadata"
                            onMouseEnter={(e) => { void e.currentTarget.play(); }}
                            onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
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
        </div>

        {/* Footer — pinned, same as the header */}
        <div style={{ flexShrink: 0, display: "flex", gap: 9, justifyContent: "flex-end", padding: "14px 24px", borderTop: "1px solid var(--border)" }}>
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
              <button
                type="button"
                onClick={() => void run()}
                disabled={inputMode === "topic" ? !topic.trim() : !hasContent}
                className="btn btn-primary"
                style={{ gap: 6 }}
              >
                <Sparkles size={14} /> Generate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

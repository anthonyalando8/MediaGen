// apps/editor/src/components/AISceneModal.tsx
//
// "Generate AI Scene" modal. Takes a topic, runs the Python pipeline via
// scene-generate.ts (generate → poll progress → fetch scene.json), then
// auto-imports the finished project with the SAME store action the manual
// Import Scene… and Open… paths use (loadProjectDocument) — so the generated
// scene lands as a fresh, fully editable project.
//
// Styled inline with the SeaBytes theme CSS variables (theme.css) so it needs
// no extra stylesheet and follows the light/dark theme automatically.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { useEditorStoreApi } from "../store/context";
import { generateScene, SceneGenerateError } from "../persistence/scene-generate";
import type { GenerateProgress } from "../persistence/scene-generate";
import { closeAIScene, getAISceneState, subscribeAIScene } from "../store/ai-scene-handle";

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 210, display: "flex",
  alignItems: "center", justifyContent: "center",
  background: "rgba(4, 8, 10, 0.6)", backdropFilter: "blur(3px)",
};
const card: React.CSSProperties = {
  width: 480, maxWidth: "92vw", background: "var(--surface-1)",
  border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 10px)",
  boxShadow: "0 24px 70px rgba(0,0,0,0.55)", color: "var(--text-0)",
  fontFamily: "var(--font-ui)", overflow: "hidden",
};

export function AISceneModal() {
  const { open } = useSyncExternalStore(subscribeAIScene, getAISceneState, getAISceneState);
  if (!open) return null;
  return <AISceneModalInner />;
}

function AISceneModalInner() {
  const store = useEditorStoreApi();
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const close = useCallback(() => {
    if (busy) return; // cancel first
    closeAIScene();
  }, [busy]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
    setProgress(null);
  }, []);

  const run = useCallback(async () => {
    const t = topic.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    setProgress({ state: "queued", step: 0, total_steps: 5, label: "Queued", pct: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { project } = await generateScene({
        topic: t,
        signal: controller.signal,
        onProgress: setProgress,
      });
      store.getState().loadProjectDocument(project);
      closeAIScene();
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        e instanceof SceneGenerateError
          ? e.message
          : `Could not reach the scene server. Is it running on the configured port? (${e instanceof Error ? e.message : String(e)})`
      );
      setBusy(false);
      setProgress(null);
    } finally {
      abortRef.current = null;
    }
  }, [topic, busy, store]);

  const pct = progress?.pct ?? 0;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Generate AI scene" onMouseDown={close}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ color: "var(--accent)", display: "flex" }}><Sparkles size={18} /></span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Generate AI Scene</span>
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
          {!busy && (
            <>
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
                Writes a script, generates the voiceover, fetches matching visuals, and imports the
                whole scene here — ready to edit. Takes up to a couple of minutes.
              </p>
            </>
          )}

          {busy && progress && (
            <div style={{ padding: "6px 2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                <Loader2 size={16} className="spin" style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{progress.label}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" }}>
                  {progress.step}/{progress.total_steps}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--surface-0)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4,
                  background: "linear-gradient(90deg, var(--accent), var(--accent-strong, var(--accent)))",
                  transition: "width 300ms ease" }} />
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
          {busy ? (
            <button type="button" onClick={cancel} className="btn btn-outline">Cancel</button>
          ) : (
            <>
              <button type="button" onClick={close} className="btn btn-outline">Close</button>
              <button type="button" onClick={() => void run()} disabled={!topic.trim()} className="btn btn-primary">
                <Sparkles size={14} />
                Generate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

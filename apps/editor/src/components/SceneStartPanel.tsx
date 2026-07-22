// apps/editor/src/components/SceneStartPanel.tsx
//
// Empty-state launcher, shown centered over the viewport ONLY while the active
// composition has no user layers (a fresh/blank project). It makes the two AI
// entry points impossible to miss on an empty canvas — "Generate with AI" and
// "Import a scene" — while the same actions also live permanently under File
// (openAIScene / the Import Scene… picker) for when the canvas is populated.
//
// Discoverability rule the user asked for: the moment the project has ANY
// user-authored node (they've started building, OR a scene was imported), this
// panel returns null and gets out of the way. It reappears only on a truly
// empty comp (e.g. after File ▸ New Project). Non-interactive pointer-through
// except on the card itself, so it never blocks canvas tools.

import { useCallback } from "react";
import { FilePlus2, Sparkles, Upload, X } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { openAIScene } from "../store/ai-scene-handle";
import { pickSceneFile, readSceneFile, SceneFileError } from "../persistence/scene-import";

export function SceneStartPanel() {
  const store = useEditorStoreApi();
  // Re-renders when the root layer count crosses 0↔1 — cheap and exact.
  const isEmpty = useEditorStore((s) => activeComp(s).root.length === 0);
  const dismissed = useEditorStore((s) => s.startPanelDismissed ?? false);
  if (!isEmpty || dismissed) return null;

  return <SceneStartPanelInner store={store} />;
}

function SceneStartPanelInner({ store }: { store: ReturnType<typeof useEditorStoreApi> }) {
  const dismiss = useCallback(() => {
    // Soft-dismiss for this session (start blank); reappears on New Project,
    // which resets the flag. Guarded so it's a no-op if the store predates it.
    store.getState().setStartPanelDismissed?.(true);
  }, [store]);

  const importScene = useCallback(async () => {
    const file = await pickSceneFile();
    if (!file) return;
    try {
      const project = await readSceneFile(file);
      store.getState().loadProjectDocument(project);
    } catch (e) {
      window.alert(e instanceof SceneFileError ? e.message : `Could not import scene: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [store]);

  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 40, display: "flex",
        alignItems: "center", justifyContent: "center",
        pointerEvents: "none", // canvas tools stay usable around the card
      }}
    >
      <div
        style={{
          pointerEvents: "auto", width: 560, maxWidth: "80%",
          background: "var(--surface-1)", border: "1px solid var(--border)",
          borderRadius: 14, padding: "30px 30px 26px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)", position: "relative",
          fontFamily: "var(--font-ui)", color: "var(--text-0)",
        }}
      >
        <button
          type="button" onClick={dismiss} aria-label="Start blank"
          style={{
            position: "absolute", top: 14, right: 14, width: 30, height: 30,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 7, border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-2)", cursor: "pointer",
          }}
        >
          <X size={15} />
        </button>

        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-2)", marginBottom: 6 }}>
          New project
        </div>
        <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>Start your video</h2>
        <p style={{ margin: "0 0 22px", fontSize: 13.5, color: "var(--text-1)", lineHeight: 1.5 }}>
          Generate a complete scene from a topic — script, voiceover and visuals — or bring in a
          scene file. You can also just start placing layers on the canvas.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Primary: Generate with AI */}
          <button
            type="button" onClick={() => openAIScene()}
            style={{
              display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start",
              textAlign: "left", padding: "16px 16px 14px", cursor: "pointer",
              borderRadius: 11, border: "1px solid var(--accent)",
              background: "var(--accent-soft, rgba(53,214,193,0.12))", color: "var(--text-0)",
            }}
          >
            <span style={{ display: "flex", width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 9, background: "var(--accent)", color: "var(--accent-text, #06201d)" }}>
              <Sparkles size={18} />
            </span>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>Generate with AI</span>
            <span style={{ fontSize: 12, color: "var(--text-1)", lineHeight: 1.4 }}>Type a topic, get an editable scene.</span>
          </button>

          {/* Secondary: Import a scene */}
          <button
            type="button" onClick={() => void importScene()}
            style={{
              display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start",
              textAlign: "left", padding: "16px 16px 14px", cursor: "pointer",
              borderRadius: 11, border: "1px solid var(--border-strong, var(--border))",
              background: "var(--surface-2)", color: "var(--text-0)",
            }}
          >
            <span style={{ display: "flex", width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 9, background: "var(--surface-3)", color: "var(--text-0)" }}>
              <Upload size={18} />
            </span>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>Import a scene</span>
            <span style={{ fontSize: 12, color: "var(--text-1)", lineHeight: 1.4 }}>Load a scene.json / .seabytes file.</span>
          </button>
        </div>

        <button
          type="button" onClick={dismiss}
          style={{
            marginTop: 16, display: "inline-flex", alignItems: "center", gap: 7,
            background: "transparent", border: "none", color: "var(--text-2)",
            fontSize: 12.5, cursor: "pointer", padding: 0,
          }}
        >
          <FilePlus2 size={14} /> Start with a blank canvas
        </button>
      </div>
    </div>
  );
}

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
    <div className="scene-start-overlay">
      <div className="scene-start-card">
        <button
          type="button" onClick={dismiss} aria-label="Start blank"
          className="scene-start-card__close"
        >
          <X size={15} />
        </button>

        <div className="scene-start-card__eyebrow">New project</div>
        <h2 className="scene-start-card__heading">Start your video</h2>
        <p className="scene-start-card__sub">
          Generate a complete scene from a topic — script, voiceover and visuals — or bring in a
          scene file. You can also just start placing layers on the canvas.
        </p>

        <div className="scene-start-card__options">
          <button
            type="button" onClick={() => openAIScene()}
            className="scene-start-option scene-start-option--primary"
          >
            <span className="scene-start-option__icon">
              <Sparkles size={18} />
            </span>
            <span className="scene-start-option__label">Generate with AI</span>
            <span className="scene-start-option__desc">Type a topic, get an editable scene.</span>
          </button>

          <button
            type="button" onClick={() => void importScene()}
            className="scene-start-option"
          >
            <span className="scene-start-option__icon">
              <Upload size={18} />
            </span>
            <span className="scene-start-option__label">Import a scene</span>
            <span className="scene-start-option__desc">Load a scene.json / .seabytes file.</span>
          </button>
        </div>

        <button type="button" onClick={dismiss} className="scene-start-card__skip">
          <FilePlus2 size={14} /> Start with a blank canvas
        </button>
      </div>
    </div>
  );
}

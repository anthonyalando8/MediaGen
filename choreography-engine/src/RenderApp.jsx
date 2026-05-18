import { useState, useRef, useEffect, useCallback } from "react";
import { gsap }      from "gsap";
import SceneRenderer from "./runtime/SceneRenderer.jsx";

/**
 * RenderApp.jsx — Python render pipeline entry point
 * Loaded at /?render=1
 *
 * Window contract:
 *   window.gsap                          — GSAP instance (for Python: gsap.updateRoot, gsap.ticker)
 *   window.__setRenderScene__(sceneJSON) — load a scene
 *   window.__sceneRenderer__             — SceneRenderer ref (available after __SCENE_BUILT__)
 *   window.__SCENE_BUILT__               — true when MasterTimeline is ready
 *   window.__lastError__                 — last uncaught JS error string
 */
export default function RenderApp() {
  const rendererRef = useRef(null);
  const [scene, setScene] = useState(null);

  useEffect(() => {
    // ── Expose GSAP on window ─────────────────────────────────
    // Python calls: window.gsap.ticker.sleep(), window.gsap.updateRoot(t)
    window.gsap = gsap;

    // Error capture for Python diagnostics
    window.__lastError__ = null;
    const onError = (e) => {
      window.__lastError__ = `${e.message} (${e.filename}:${e.lineno})`;
      console.error("[RenderApp]", e.message);
    };
    window.addEventListener("error", onError);

    // State flags
    window.__SCENE_BUILT__   = false;
    window.__DETERMINISTIC__ = true;

    // Scene loader — Python calls this
    window.__setRenderScene__ = (sceneJSON) => {
      console.log("[RenderApp] Loading:", sceneJSON?.meta?.id);
      window.__SCENE_BUILT__   = false;
      window.__sceneRenderer__ = null;
      setScene(sceneJSON);
    };

    // Pick up pre-injected scene (set before React mounted)
    if (window.__RENDER_SCENE__) {
      window.__setRenderScene__(window.__RENDER_SCENE__);
    }

    console.log("[RenderApp] Ready — window.gsap and window.__setRenderScene__ available");

    return () => {
      window.removeEventListener("error", onError);
      delete window.__setRenderScene__;
    };
  }, []);

  const onReady = useCallback(() => {
    window.__sceneRenderer__ = rendererRef.current;
    window.__SCENE_BUILT__   = true;
    console.log("[RenderApp] __SCENE_BUILT__ = true");
  }, []);

  if (!scene) {
    return (
      <div style={{
        background: "#000", color: "#ffffff25", fontFamily: "monospace",
        fontSize: 11, padding: 20, minHeight: "100vh", whiteSpace: "pre",
      }}>
        {`[RenderApp] waiting for scene\ncall: window.__setRenderScene__(sceneJSON)\n`}
      </div>
    );
  }

  return (
    <div style={{ margin: 0, padding: 0, background: "#000", display: "inline-block" }}>
      <SceneRenderer
        ref={rendererRef}
        scene={scene}
        autoPlay={false}
        width={window.__RENDER_WIDTH__ ?? 1080}
        showDebug={false}
        onReady={onReady}
      />
    </div>
  );
}
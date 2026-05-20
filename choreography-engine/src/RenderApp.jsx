import { useState, useRef, useEffect, useCallback } from "react";
import { gsap }      from "gsap";
import SceneRenderer from "./runtime/SceneRenderer.jsx";

/**
 * RenderApp.jsx — Python render pipeline entry point
 * Loaded at /?render=1
 *
 * Key window exports:
 *   window.gsap                          — GSAP instance
 *   window.__setRenderScene__(sceneJSON) — load a scene
 *   window.__sceneRenderer__             — imperative ref
 *   window.__SCENE_BUILT__               — true when ready
 *   window.__captureFrame__()            — returns base64 PNG of current frame
 *                                          via canvas serialisation (no screenshot API)
 */
export default function RenderApp() {
  const rendererRef  = useRef(null);
  const stageElRef   = useRef(null);   // the Stage outer div
  const [scene, setScene] = useState(null);

  useEffect(() => {
    // ── Expose GSAP ───────────────────────────────────────────
    window.gsap = gsap;

    // ── Error capture ─────────────────────────────────────────
    window.__lastError__ = null;
    const onError = (e) => {
      window.__lastError__ = `${e.message} (${e.filename}:${e.lineno})`;
    };
    window.addEventListener("error", onError);

    // ── State flags ───────────────────────────────────────────
    window.__SCENE_BUILT__   = false;
    window.__DETERMINISTIC__ = true;

    // ── Scene loader ──────────────────────────────────────────
    window.__setRenderScene__ = (sceneJSON) => {
      console.log("[RenderApp] Loading:", sceneJSON?.meta?.id);
      window.__SCENE_BUILT__   = false;
      window.__sceneRenderer__ = null;
      setScene(sceneJSON);
    };

    if (window.__RENDER_SCENE__) {
      window.__setRenderScene__(window.__RENDER_SCENE__);
    }

    // ── Frame capture via canvas ──────────────────────────────
    // This is the ONLY reliable way to capture SVG frames in headless
    // Chromium. All screenshot APIs block waiting for compositor flush
    // which never comes when SVG CSS transforms are active.
    //
    // Process:
    //   1. Find the SVG element inside the Stage div
    //   2. Serialize it to an SVG string with all inline styles
    //   3. Create a Blob + object URL
    //   4. Draw onto an offscreen canvas via drawImage()
    //   5. Return canvas.toDataURL('image/png') → base64 string
    //   6. Python decodes and writes to disk
    window.__captureFrame__ = () => {
      return new Promise((resolve, reject) => {
        // Find the stage SVG — it's the first <svg> inside [data-stage]
        const stageDiv = document.querySelector('[data-stage]');
        const svg      = stageDiv?.querySelector('svg');

        if (!svg) {
          reject(new Error('Stage SVG not found'));
          return;
        }

        // Get rendered dimensions from the SVG element
        const rect = svg.getBoundingClientRect();
        const w    = Math.round(rect.width)  || (window.__RENDER_WIDTH__ ?? 1080);
        const h    = Math.round(rect.height) || Math.round(w * 420 / 360);

        // Serialize SVG to string — includes all inline GSAP transforms
        const svgData  = new XMLSerializer().serializeToString(svg);
        const svgBlob  = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url      = URL.createObjectURL(svgBlob);

        // Draw onto canvas
        const canvas   = document.createElement('canvas');
        canvas.width   = w;
        canvas.height  = h;
        const ctx      = canvas.getContext('2d');

        // Fill background from stage div background color
        const bgColor  = stageDiv
          ? window.getComputedStyle(stageDiv).backgroundColor
          : '#000000';
        ctx.fillStyle  = bgColor || '#000000';
        ctx.fillRect(0, 0, w, h);

        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          // Return as base64 PNG (strip the data:image/png;base64, prefix)
          const dataUrl = canvas.toDataURL('image/png');
          resolve(dataUrl.split(',')[1]);
        };
        img.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(new Error('SVG→canvas render failed: ' + e));
        };
        img.src = url;
      });
    };

    console.log("[RenderApp] Ready — window.__captureFrame__ available");

    return () => {
      window.removeEventListener("error", onError);
      delete window.__setRenderScene__;
      delete window.__captureFrame__;
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
        {`[RenderApp] waiting\ncall: window.__setRenderScene__(sceneJSON)\n`}
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
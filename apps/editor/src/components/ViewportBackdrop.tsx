// apps/editor/src/components/ViewportBackdrop.tsx
//
// Premium viewport atmosphere — the environment/depth behind & around the
// composition canvas WITHOUT touching the pixels the WebGL renderer draws.
//
//   • <ViewportBackdrop/>     — atmosphere, render BEHIND the canvas
//   • <ViewportEmptyOverlay/> — empty-project HINT, render ABOVE the canvas
//
// ── CHANGES IN THIS REVISION ────────────────────────────────────────────────
// 1. The composition SETUP (frame-size presets + New/Import) moved OUT of this
//    overlay into the right inspector panel (<CompSetupPanel/>). An empty
//    project now reads as an empty stage, so the atmosphere is the hero.
// 2. The overlay is now a light, non-blocking centered hint that points to the
//    inspector — no config controls, nothing that competes with the mesh.
// 3. The mesh/glow/vignette were being hidden by the opaque `.viewport-stage`
//    background; that's fixed in viewport-backdrop.css (stage → transparent).

import { useEditorStore } from "../store/context";
import { activeComp } from "../store/selectors";
import { getAudioTracks } from "./audio-kinds";

/** Atmosphere layers — render as the FIRST child of `.app-shell__viewport`. */
export function ViewportBackdrop() {
  return (
    <div className="sb-vp-backdrop">
      <div className="sb-vp-vignette" />
      <div className="sb-vp-grid" />
      <div className="sb-vp-mesh" />
      <div className="sb-vp-glow sb-vp-glow--a" />
      <div className="sb-vp-glow sb-vp-glow--b" />
    </div>
  );
}

/** Empty-project hint — render as a LATER child of `.app-shell__viewport`
 *  (above `.viewport-stage`). Renders nothing when the comp has content. */
export function ViewportEmptyOverlay() {
  const isEmpty = useEditorStore(
    (s) => activeComp(s).root.length === 0 && getAudioTracks(activeComp(s)).length === 0,
  );
  // Mirror the chosen frame's aspect ratio in the placeholder, so picking 9:16
  // shows a tall frame (not a fixed square) — clear feedback, always contained.
  const size = useEditorStore((s) => {
    const sz = (activeComp(s) as unknown as { size?: { width: number; height: number } }).size;
    return { w: sz?.width ?? 1920, h: sz?.height ?? 1080 };
  });
  if (!isEmpty) return null;

  const ar = size.w / size.h;
  const CAP = 150; // px — the longer edge of the placeholder frame
  const frameW = ar >= 1 ? CAP : Math.round(CAP * ar);
  const frameH = ar >= 1 ? Math.round(CAP / ar) : CAP;

  return (
    <div className="sb-vp-empty-overlay">
      <div className="sb-vp-hint">
        <div className="sb-vp-hint__frame" style={{ width: frameW, height: frameH }} aria-hidden="true" />
        <div className="sb-vp-hint__title">Empty composition</div>
        <div className="sb-vp-hint__sub">
          Drop media onto the canvas, add a layer from the toolbar,
          or set a frame size in the panel on the right.
        </div>
      </div>
    </div>
  );
}

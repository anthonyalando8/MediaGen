// apps/editor/src/components/ViewportBackdrop.tsx
//
// Premium viewport atmosphere — the environment/depth behind & around the
// composition canvas WITHOUT touching the pixels the WebGL renderer draws.
// Render as the FIRST child of `.app-shell__viewport`, behind the canvas.
//
// There used to also be a `ViewportEmptyOverlay` here: a ghosted frame +
// dimension label shown only on an empty comp. It was removed — `Viewport`
// already mounts `<ViewportFrame/>` unconditionally, which draws the real,
// zoom/pan-aware comp boundary plus a resolution label at every zoom level,
// not just when empty. The overlay duplicated that at a fixed placeholder
// size that didn't line up with the real frame, which is exactly the kind
// of redundant, misaligned chrome that made an empty project look
// unfinished. The atmosphere below is the only empty-state treatment left;
// onboarding copy lives in <SceneStartPanel/> and <CompSetupPanel/>.

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

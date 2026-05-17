import { forwardRef, useImperativeHandle, useRef } from "react";
import {
  StageManager,
  STAGE_VIEWBOX, STAGE_VB_X, STAGE_VB_Y, STAGE_VB_W, STAGE_VB_H,
  BACKGROUND_PRESETS, LIGHTING_PRESETS, LAYER,
} from "./StageManager.js";

/**
 * Stage.jsx
 * ---------
 * The full rendering stage. Composes:
 *   - Background gradient layers
 *   - Environment / prop layers (extensible)
 *   - Character layer (children slotted here)
 *   - Foreground / lighting overlay
 *   - Debug grid (optional)
 *
 * The outer <div ref={stageRef}> is what CameraRig transforms.
 * The inner <svg> uses the fixed coordinate space.
 *
 * Props:
 *   width        — pixel width (height = width × 420/360)
 *   background   — preset name ("default"|"city_night"|"dawn"|"midday"|"studio"|"void")
 *   lighting     — preset name ("neutral"|"dramatic_side"|"warm_key"|...)
 *   showDebug    — show floor line, axis, viewBox info
 *   children     — SVGPuppet components (placed inside the character layer)
 *
 * Ref handle:
 *   ref.stageEl    — the outer div (for CameraRig)
 *   ref.svgEl      — the SVG element
 *   ref.manager    — the StageManager instance
 */
const Stage = forwardRef(function Stage(
  {
    width      = 360,
    background = "default",
    lighting   = "neutral",
    showDebug  = false,
    children,
    style = {},
  },
  ref
) {
  const stageRef = useRef(null);
  const svgRef   = useRef(null);

  const manager  = new StageManager({ width, background, lighting });
  const height   = manager.height;
  const bgConfig = manager.backgroundConfig;
  const ltConfig = manager.lightingConfig;

  // ── Sky gradient stops ─────────────────────────────────────────
  const skyColors = bgConfig.sky ?? ["#1a1a2e", "#0f0f1a"];
  const gradId    = `sky_grad_${background}`;

  useImperativeHandle(ref, () => ({
    stageEl: stageRef.current,
    svgEl:   svgRef.current,
    manager,
  }));

  return (
    <div
      ref={stageRef}
      data-stage
      style={{
        width,
        height,
        position:     "relative",
        overflow:     "hidden",
        borderRadius: 12,
        flexShrink:   0,
        ...style,
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={STAGE_VIEWBOX}
        preserveAspectRatio="xMidYMax meet"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", position: "absolute", inset: 0 }}
      >
        {/* ── Gradient defs ─────────────────────────────────── */}
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            {skyColors.map((color, i) => (
              <stop
                key={i}
                offset={`${(i / (skyColors.length - 1)) * 100}%`}
                stopColor={color}
              />
            ))}
          </linearGradient>

          {/* Lighting overlay gradient */}
          {ltConfig.tint && (
            <linearGradient id="lighting_overlay" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ltConfig.tint} stopOpacity="0" />
              <stop offset="100%" stopColor={ltConfig.tint} stopOpacity={ltConfig.opacity} />
            </linearGradient>
          )}

          {/* Vignette */}
          <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
            <stop offset="60%" stopColor="black" stopOpacity="0" />
            <stop offset="100%" stopColor="black" stopOpacity="0.4" />
          </radialGradient>
        </defs>

        {/* ── Layer 0: Sky background ────────────────────────── */}
        <rect
          x={STAGE_VB_X} y={STAGE_VB_Y}
          width={STAGE_VB_W} height={STAGE_VB_H}
          fill={`url(#${gradId})`}
        />

        {/* ── Layer 1: Far background (environment) ─────────── */}
        {background === "city_night" && (
          <g data-layer="far_bg">
            {/* Simplified city skyline silhouette */}
            <rect x="-180" y="-320" width="30"  height="120" fill="#0a0a18" />
            <rect x="-140" y="-370" width="20"  height="170" fill="#0a0a18" />
            <rect x="-110" y="-300" width="40"  height="100" fill="#0a0a18" />
            <rect x="-60"  y="-350" width="25"  height="150" fill="#0a0a18" />
            <rect x="-25"  y="-280" width="50"  height="80"  fill="#0a0a18" />
            <rect x="40"   y="-340" width="30"  height="140" fill="#0a0a18" />
            <rect x="80"   y="-290" width="40"  height="90"  fill="#0a0a18" />
            <rect x="130"  y="-360" width="25"  height="160" fill="#0a0a18" />
            <rect x="160"  y="-310" width="20"  height="110" fill="#0a0a18" />
            {/* Building lights */}
            {[
              [-130, -360], [-125, -345], [-55, -340], [-50, -320],
              [45, -330], [85, -280], [135, -350], [165, -300],
            ].map(([bx, by], i) => (
              <rect key={i} x={bx} y={by} width="3" height="3"
                    fill="#ffdd88" opacity="0.6" />
            ))}
          </g>
        )}

        {/* ── Layer 3: Floor ────────────────────────────────── */}
        <rect
          x={STAGE_VB_X} y="-8"
          width={STAGE_VB_W} height="28"
          fill={bgConfig.floor ?? "#0a0a12"}
        />

        {/* Floor shadow line */}
        <line
          x1={STAGE_VB_X} y1="0" x2={-STAGE_VB_X} y2="0"
          stroke="#ffffff08" strokeWidth="1"
        />

        {/* ── Layer 4: Character layer ────────────────────────── */}
        <g data-layer="characters">
          {children}
        </g>

        {/* ── Layer 5: Vignette overlay ─────────────────────── */}
        <rect
          x={STAGE_VB_X} y={STAGE_VB_Y}
          width={STAGE_VB_W} height={STAGE_VB_H}
          fill="url(#vignette)"
          style={{ pointerEvents: "none" }}
        />

        {/* ── Layer 6: Lighting overlay ─────────────────────── */}
        {ltConfig.tint && (
          <rect
            x={STAGE_VB_X} y={STAGE_VB_Y}
            width={STAGE_VB_W} height={STAGE_VB_H}
            fill={`url(#lighting_overlay)`}
            opacity={ltConfig.opacity}
            style={{ pointerEvents: "none" }}
          />
        )}

        {/* ── Debug overlay ─────────────────────────────────── */}
        {showDebug && (
          <g data-layer="debug" style={{ pointerEvents: "none" }}>
            {/* Floor line */}
            <line x1={STAGE_VB_X} y1="0" x2={-STAGE_VB_X} y2="0"
                  stroke="#00ff8840" strokeWidth="1" strokeDasharray="4 4"/>
            {/* Center axis */}
            <line x1="0" y1={STAGE_VB_Y} x2="0" y2="20"
                  stroke="#ff880040" strokeWidth="1" strokeDasharray="4 4"/>
            {/* ViewBox labels */}
            <text x={STAGE_VB_X + 4} y={STAGE_VB_Y + 12}
                  fill="#ffffff30" fontSize="8" fontFamily="monospace">
              {STAGE_VIEWBOX}
            </text>
            <text x={STAGE_VB_X + 4} y="-4"
                  fill="#00ff8860" fontSize="8" fontFamily="monospace">
              y=0 floor
            </text>
          </g>
        )}
      </svg>
    </div>
  );
});

export default Stage;
import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import SVGPuppet          from "../characters/SVGPuppet.jsx";
import { MasterTimeline } from "./MasterTimeline.js";
import EventBus           from "./EventBus.js";

/**
 * SceneRenderer.jsx
 * -----------------
 * Renders a scene from JSON. Mounts SVGPuppets, builds MasterTimeline,
 * exposes playback API via ref.
 *
 * ── Coordinate system ─────────────────────────────────────────────
 * The SVG stage uses a FIXED coordinate space — never changes:
 *   x: -180 to +180  (360 units wide, centered at 0)
 *   y: -400 to  +20  (420 units tall; feet at y=0, head at y=-310)
 *
 * viewBox = "-180 -400 360 420"
 *
 * The SVG element scales to fill the container via preserveAspectRatio.
 * This decouples pixel size from the coordinate system completely.
 *
 * Props:
 *   scene        — scene JSON object
 *   autoPlay     — start on mount (default: true)
 *   onComplete   — callback({ sceneId }) when scene ends
 *   onTick       — callback({ time, progress }) every GSAP update
 *   width        — pixel width of stage (height auto from aspect)
 *   showDebug    — show floor line and axis markers
 */

// ── Fixed stage coordinate space ──────────────────────────────────
// These constants match the proven interactive viewBox in App.jsx.
// Change only if character proportions change.
const STAGE_VB_X = -180;
const STAGE_VB_Y = -400;   // enough room for head (-310) + jump (-90 more)
const STAGE_VB_W = 360;
const STAGE_VB_H = 420;    // 400 above floor + 20 below
const STAGE_VIEWBOX = `${STAGE_VB_X} ${STAGE_VB_Y} ${STAGE_VB_W} ${STAGE_VB_H}`;

const SceneRenderer = forwardRef(function SceneRenderer(
  {
    scene,
    autoPlay   = true,
    onComplete = null,
    onTick     = null,
    width      = 390,
    showDebug  = false,
  },
  ref
) {
  // Pixel height proportional to coordinate space aspect
  const height = Math.round(STAGE_VB_H * (width / STAGE_VB_W));

  const stageRef  = useRef(null);
  const masterRef = useRef(null);
  const rigRefs   = useRef({});
  const [built, setBuilt] = useState(false);

  // Register rig refs as SVGPuppets mount
  const registerRig = useCallback((id, rigRef) => {
    if (rigRef) rigRefs.current[id] = rigRef;
  }, []);

  // Build + optionally play after mount
  useEffect(() => {
    if (!scene) return;

    // Wait one tick for all SVGPuppet forwardRef callbacks to fire
    const timer = setTimeout(() => {
      const master = new MasterTimeline(scene, rigRefs.current, stageRef.current);
      master.build();
      masterRef.current = master;
      setBuilt(true);

      const unsubDone = EventBus.on("scene:complete", ({ sceneId }) => {
        onComplete?.({ sceneId });
      });
      const unsubTick = EventBus.on("scene:tick", ({ time, progress }) => {
        onTick?.({ time, progress });
      });

      if (autoPlay) master.play();

      // Return inner cleanup (runs when the timeout callback reruns, not on unmount)
      return () => { unsubDone(); unsubTick(); };
    }, 50);

    return () => {
      clearTimeout(timer);
      masterRef.current?.destroy();
      masterRef.current = null;
    };
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps

  // Imperative handle for Python render pipeline and external control
  useImperativeHandle(ref, () => ({
    play:                    ()      => masterRef.current?.play(),
    pause:                   ()      => masterRef.current?.pause(),
    resume:                  ()      => masterRef.current?.resume(),
    seekTo:                  (t)     => masterRef.current?.seekTo(t),
    setProgress:             (p)     => masterRef.current?.setProgress(p),
    enableDeterministicMode: ()      => masterRef.current?.enableDeterministicMode(),
    tick:                    (dt)    => masterRef.current?.tick(dt),
    tickToFrame:             (f,fps) => masterRef.current?.tickToFrame(f, fps),
    destroy:                 ()      => masterRef.current?.destroy(),
    get time()     { return masterRef.current?.time     ?? 0; },
    get progress() { return masterRef.current?.progress ?? 0; },
    get duration() { return masterRef.current?.duration ?? 0; },
    isBuilt: () => built,
  }));

  if (!scene) return null;

  const characters = scene.characters ?? [];

  return (
    <div
      ref={stageRef}
      data-scene-id={scene.meta?.id}
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        background: scene.stage?.background ?? "#1a1a2e",
        borderRadius: 12,
        flexShrink: 0,
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={STAGE_VIEWBOX}
        preserveAspectRatio="xMidYMax meet"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", position: "absolute", inset: 0 }}
        aria-label={`Scene: ${scene.meta?.id ?? "unnamed"}`}
      >
        {/* Debug floor line at y=0 */}
        {showDebug && (
          <>
            <line x1={STAGE_VB_X} y1="0" x2={-STAGE_VB_X} y2="0"
                  stroke="#ffffff25" strokeWidth="1" strokeDasharray="6 6"/>
            <text x={STAGE_VB_X + 4} y="-4"
                  fill="#ffffff20" fontSize="10" fontFamily="monospace">
              y=0 (floor)
            </text>
          </>
        )}

        {/* One SVGPuppet per character */}
        {characters.map((charDef) => {
          const pos = charDef.position ?? {};
          return (
            <SVGPuppet
              key={charDef.id}
              characterId={charDef.id}
              ref={(r) => registerRig(charDef.id, r)}
              x={pos.x ?? 0}
              y={pos.y ?? 0}
              scale={charDef.scale ?? 1}
              facingRight={charDef.facingRight !== false}
            />
          );
        })}
      </svg>

      {/* Debug character labels */}
      {showDebug && characters.map((charDef) => (
        <div key={charDef.id} style={{
          position: "absolute", bottom: 6, left: "50%",
          transform: "translateX(-50%)",
          fontSize: 10, color: "#ffffff35",
          fontFamily: "monospace", pointerEvents: "none",
          whiteSpace: "nowrap",
        }}>
          {charDef.id}
        </div>
      ))}
    </div>
  );
});

export default SceneRenderer;
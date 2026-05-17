import { useRef, useEffect, useCallback, useState } from "react";
import { gsap }           from "gsap";
import SVGPuppet          from "../characters/SVGPuppet.jsx";
import { MasterTimeline } from "./MasterTimeline.js";
import EventBus           from "./EventBus.js";

/**
 * SceneRenderer.jsx
 * -----------------
 * React component that drives the full scene lifecycle:
 *
 *   1. Renders a 9:16 SVG stage at the configured resolution
 *   2. Mounts one SVGPuppet per character defined in scene JSON
 *   3. After mount (useEffect), builds MasterTimeline with all rig refs
 *   4. Auto-plays or waits for external play() call
 *   5. Exposes imperative handle (ref) for Python render pipeline control
 *
 * Props:
 *   scene        — scene JSON object (see /scenes/example_scene.json)
 *   autoPlay     — start immediately on mount (default: true)
 *   onComplete   — callback when scene finishes
 *   onTick       — callback({ time, progress }) every frame (for scrubber UI)
 *   width        — stage render width in px (default: 390 = iPhone width)
 *   showDebug    — show floor line + character IDs (default: false)
 *
 * Imperative ref handle:
 *   ref.play()
 *   ref.pause()
 *   ref.resume()
 *   ref.seekTo(seconds)
 *   ref.setProgress(0-1)
 *   ref.enableDeterministicMode()
 *   ref.tick(frameDelta)
 *   ref.tickToFrame(frameIndex, fps)
 *   ref.destroy()
 */

import { forwardRef, useImperativeHandle } from "react";

const SceneRenderer = forwardRef(function SceneRenderer(
  {
    scene,
    autoPlay    = true,
    onComplete  = null,
    onTick      = null,
    width       = 390,
    showDebug   = false,
  },
  ref
) {
  // Stage aspect: 9:16
  const height      = Math.round(width * (16 / 9));

  // ── Refs ─────────────────────────────────────────────────────
  const stageRef    = useRef(null);   // DOM element for camera transforms
  const masterRef   = useRef(null);   // MasterTimeline instance
  const rigRefs     = useRef({});     // { characterId: rigRef }

  const [built, setBuilt] = useState(false);

  // ── Viewport math ─────────────────────────────────────────────
  // Scene coordinate system: origin (0,0) = screen center, Y up
  // Characters place themselves relative to stage center
  const viewBox = `${-width/2} ${-height} ${width} ${height + 20}`;

  // ── Register rig ref callback ─────────────────────────────────
  // Called by SVGPuppet via a render-time ref callback
  const registerRig = useCallback((id, rigRef) => {
    if (rigRef) rigRefs.current[id] = rigRef;
  }, []);

  // ── Build + play on mount ─────────────────────────────────────
  useEffect(() => {
    if (!scene) return;

    // Small delay to ensure all SVGPuppet refs are populated
    const buildTimer = setTimeout(() => {
      const master = new MasterTimeline(scene, rigRefs.current, stageRef.current);
      master.build();
      masterRef.current = master;
      setBuilt(true);

      // Wire EventBus callbacks
      const unsubComplete = EventBus.on("scene:complete", ({ sceneId }) => {
        onComplete?.({ sceneId });
      });
      const unsubTick = EventBus.on("scene:tick", ({ time, progress }) => {
        onTick?.({ time, progress });
      });

      if (autoPlay) master.play();

      return () => {
        unsubComplete();
        unsubTick();
      };
    }, 50);

    return () => {
      clearTimeout(buildTimer);
      masterRef.current?.destroy();
      masterRef.current = null;
    };
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Imperative handle for Python pipeline ─────────────────────
  useImperativeHandle(ref, () => ({
    play:                    ()    => masterRef.current?.play(),
    pause:                   ()    => masterRef.current?.pause(),
    resume:                  ()    => masterRef.current?.resume(),
    seekTo:                  (t)   => masterRef.current?.seekTo(t),
    setProgress:             (p)   => masterRef.current?.setProgress(p),
    enableDeterministicMode: ()    => masterRef.current?.enableDeterministicMode(),
    tick:                    (dt)  => masterRef.current?.tick(dt),
    tickToFrame:             (f,fps)=> masterRef.current?.tickToFrame(f, fps),
    destroy:                 ()    => masterRef.current?.destroy(),
    get time()     { return masterRef.current?.time     ?? 0; },
    get progress() { return masterRef.current?.progress ?? 0; },
    get duration() { return masterRef.current?.duration ?? 0; },
    isBuilt:                 ()    => built,
  }));

  // ── Render ────────────────────────────────────────────────────
  if (!scene) return null;

  const characters = scene.characters ?? [];

  return (
    <div
      ref={stageRef}
      data-scene-id={scene.meta?.id}
      style={{
        width,
        height,
        position:  "relative",
        overflow:  "hidden",
        background: scene.stage?.background ?? "#1a1a2e",
        borderRadius: 12,
        flexShrink: 0,
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={viewBox}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", position: "absolute", inset: 0 }}
        aria-label={`Scene: ${scene.meta?.id ?? "unnamed"}`}
      >
        {/* Debug floor line */}
        {showDebug && (
          <line
            x1={-width / 2} y1="0" x2={width / 2} y2="0"
            stroke="#ffffff20" strokeWidth="1" strokeDasharray="6 6"
          />
        )}

        {/* Render one SVGPuppet per character */}
        {characters.map((charDef) => {
          const pos = charDef.position ?? {};
          return (
            <SVGPuppet
              key={charDef.id}
              characterId={charDef.id}
              ref={(rigRef) => registerRig(charDef.id, rigRef)}
              x={pos.x ?? 0}
              y={pos.y ?? 0}
              scale={charDef.scale ?? 1}
              facingRight={charDef.facingRight !== false}
            />
          );
        })}
      </svg>

      {/* Debug: character ID labels */}
      {showDebug && characters.map((charDef) => (
        <div key={charDef.id} style={{
          position: "absolute",
          bottom: 8, left: "50%", transform: "translateX(-50%)",
          fontSize: 10, color: "#ffffff40",
          fontFamily: "monospace", pointerEvents: "none",
        }}>
          {charDef.id}
        </div>
      ))}
    </div>
  );
});

export default SceneRenderer;
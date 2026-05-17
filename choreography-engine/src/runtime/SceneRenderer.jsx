import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import SVGPuppet          from "../characters/SVGPuppet.jsx";
import Stage              from "../stage/Stage.jsx";
import { MasterTimeline } from "./MasterTimeline.js";
import { AssetLoader }    from "../assets/AssetLoader.js";
import EventBus           from "./EventBus.js";

/**
 * SceneRenderer.jsx  — Layer 4 upgrade
 * -------------------------------------
 * Full scene lifecycle:
 *   mount → preload → build → ready → play → complete → teardown
 *
 * Now uses Stage.jsx for layered background + environment rendering.
 * CameraRig is instantiated inside MasterTimeline.build() and targets
 * the Stage's outer div (stageEl ref).
 *
 * Props:
 *   scene        — scene JSON object
 *   autoPlay     — start on mount (default: true)
 *   onComplete   — callback({ sceneId }) when scene ends
 *   onTick       — callback({ time, progress }) every GSAP update
 *   onReady      — callback() when built and ready to play
 *   width        — pixel width of stage
 *   showDebug    — show floor line and axis markers
 *
 * Ref handle: play / pause / resume / seekTo / setProgress /
 *             enableDeterministicMode / tick / tickToFrame / destroy
 */

const SceneRenderer = forwardRef(function SceneRenderer(
  {
    scene,
    autoPlay    = true,
    onComplete  = null,
    onTick      = null,
    onReady     = null,
    width       = 360,
    showDebug   = false,
  },
  ref
) {
  const stageRef  = useRef(null);   // Stage component ref → { stageEl, svgEl, manager }
  const masterRef = useRef(null);
  const rigRefs   = useRef({});
  const [built,   setBuilt]   = useState(false);
  const [loading, setLoading] = useState(true);

  // Register rig refs from SVGPuppets
  const registerRig = useCallback((id, rigRef) => {
    if (rigRef) rigRefs.current[id] = rigRef;
  }, []);

  // ── Full scene lifecycle ───────────────────────────────────────
  useEffect(() => {
    if (!scene) return;

    let timer;
    let unsubDone, unsubTick;

    const init = async () => {
      // 1. Preload scene assets
      setLoading(true);
      try {
        await AssetLoader.preloadScene(scene);
      } catch (e) {
        console.warn("[SceneRenderer] Asset preload partial failure:", e);
      }
      setLoading(false);

      // 2. Wait one tick for SVGPuppet forwardRef callbacks to populate
      timer = setTimeout(() => {
        // 3. Get the outer div from Stage component for CameraRig targeting
        const stageEl = stageRef.current?.stageEl ?? null;

        // 4. Build MasterTimeline with CameraRig wired to stageEl
        const master = new MasterTimeline(scene, rigRefs.current, stageEl);
        master.build();
        masterRef.current = master;
        setBuilt(true);
        onReady?.();

        // 5. Wire EventBus
        unsubDone = EventBus.on("scene:complete", ({ sceneId }) => {
          onComplete?.({ sceneId });
        });
        unsubTick = EventBus.on("scene:tick", ({ time, progress }) => {
          onTick?.({ time, progress });
        });

        // 6. Optionally auto-play
        if (autoPlay) master.play();
      }, 50);
    };

    init();

    return () => {
      clearTimeout(timer);
      unsubDone?.();
      unsubTick?.();
      masterRef.current?.destroy();
      masterRef.current = null;
    };
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Imperative API ─────────────────────────────────────────────
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
    camera:                  ()      => masterRef.current?.camera,
    get time()     { return masterRef.current?.time     ?? 0; },
    get progress() { return masterRef.current?.progress ?? 0; },
    get duration() { return masterRef.current?.duration ?? 0; },
    isBuilt:  () => built,
    isLoading: () => loading,
  }));

  if (!scene) return null;

  const characters   = scene.characters ?? [];
  const bgPreset     = scene.stage?.background ?? "default";
  const lightPreset  = scene.stage?.lighting   ?? "neutral";

  return (
    <Stage
      ref={stageRef}
      width={width}
      background={bgPreset}
      lighting={lightPreset}
      showDebug={showDebug}
      data-scene-id={scene.meta?.id}
    >
      {/* One SVGPuppet per character — rendered into Stage's character layer */}
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
    </Stage>
  );
});

export default SceneRenderer;
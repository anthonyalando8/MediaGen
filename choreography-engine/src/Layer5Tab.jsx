import { useRef, useEffect, useState, useCallback } from "react";
import SceneRenderer      from "./runtime/SceneRenderer.jsx";
import SubtitleRenderer   from "./ui/SubtitleRenderer.jsx";
import { Monitor }        from "./state/PerformanceMonitor.js";
import { VariantSystem }  from "./characters/CharacterVariantSystem.js";
import { validateScene }  from "./runtime/SceneSchema.js";
import { EventBus }       from "./runtime/EventBus.js";
import { BUILTIN_VARIANTS } from "./assets/AssetLoader.js";
import exampleScene       from "../scenes/example_scene.json";
import lipsyncScene       from "../scenes/lipsync_demo.json";

/**
 * Layer5Tab.jsx
 * -------------
 * Dev harness for all Layer 5 systems:
 *   - SceneComposer (multi-scene playlist)
 *   - SubtitleRenderer (captions synced to timeline)
 *   - PerformanceMonitor (FPS, tween count)
 *   - CharacterVariantSystem (palette swap)
 *   - scene_schema validator
 */

const SCENES = {
  confrontation: exampleScene,
  lipsync_demo:  lipsyncScene,
};

const STAGE_W = 300;

export default function Layer5Tab() {
  const rendererRef      = useRef(null);
  const [activeScene,    setActiveScene]    = useState("confrontation");
  const [sceneJSON,      setSceneJSON]      = useState(exampleScene);
  const [sceneTime,      setSceneTime]      = useState(0);
  const [sceneDur,       setSceneDur]       = useState(0);
  const [playing,        setPlaying]        = useState(false);
  const [captions,       setCaptions]       = useState([]);
  const [perfMetrics,    setPerfMetrics]    = useState(null);
  const [validationResult, setValidation]   = useState(null);
  const [activeVariant,  setActiveVariant]  = useState("hero_default");
  const [sceneLog,       setSceneLog]       = useState([]);

  // ── Extract captions from scene dialogue ─────────────────────
  useEffect(() => {
    const caps = [];
    (sceneJSON.characters ?? []).forEach((char) => {
      const dialogues = Array.isArray(char.dialogue)
        ? char.dialogue
        : char.dialogue ? [char.dialogue] : [];

      dialogues.forEach((d) => {
        const wpm    = d.wpm ?? 120;
        const words  = (d.text ?? "").split(" ").length;
        const durEst = (words / wpm) * 60;
        caps.push({
          at:      d.startAt,
          end:     d.startAt + durEst,
          text:    d.text,
          speaker: d.speaker ?? char.id,
        });
      });
    });
    setCaptions(caps);
  }, [sceneJSON]);

  // ── Performance monitor ────────────────────────────────────────
  useEffect(() => {
    Monitor.start();
    const unsub = Monitor.onUpdate((metrics) => setPerfMetrics({ ...metrics }));
    return () => { unsub(); Monitor.stop(); };
  }, []);

  // ── Scene EventBus ─────────────────────────────────────────────
  useEffect(() => {
    const log = (msg) => setSceneLog(p => [`${p.length+1}. ${msg}`, ...p].slice(0, 10));
    const unsubs = [
      EventBus.on("scene:built",    ({ sceneId, duration }) => {
        setSceneDur(duration);
        log(`Built "${sceneId}" — ${duration.toFixed(1)}s`);
      }),
      EventBus.on("scene:start",    () => { setPlaying(true);  log("▶ playing"); }),
      EventBus.on("scene:complete", () => { setPlaying(false); log("■ complete"); }),
      EventBus.on("scene:tick",     ({ time }) => setSceneTime(time)),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  // ── Scene switcher ─────────────────────────────────────────────
  const switchScene = useCallback((key) => {
    setActiveScene(key);
    setSceneJSON(SCENES[key]);
    setSceneTime(0);
    setPlaying(false);
    setSceneLog([]);

    // Validate the incoming scene
    const result = validateScene(SCENES[key]);
    setValidation(result);
  }, []);

  // Run initial validation
  useEffect(() => {
    setValidation(validateScene(sceneJSON));
  }, [sceneJSON]);

  // ── Transport ─────────────────────────────────────────────────
  const play    = () => { rendererRef.current?.play();   setPlaying(true);  };
  const pause   = () => { rendererRef.current?.pause();  setPlaying(false); };
  const restart = () => {
    rendererRef.current?.seekTo(0);
    rendererRef.current?.play();
    setPlaying(true);
    setSceneLog([]);
  };
  const seek = (e) => {
    const t = parseFloat(e.target.value);
    rendererRef.current?.seekTo(t);
    setSceneTime(t);
  };

  // ── Variant swap ──────────────────────────────────────────────
  const applyVariant = useCallback((variantId) => {
    setActiveVariant(variantId);
    // In real use, rig refs are stored and passed here.
    // In this tab, we demonstrate the API call:
    console.log(`[VariantSystem] Applying variant: ${variantId}`);
    // VariantSystem.apply(rigRef.current, variantId);
  }, []);

  const pct        = sceneDur > 0 ? ((sceneTime / sceneDur) * 100).toFixed(1) : 0;
  const statusColor = { ok: "#4ade80", warn: "#facc15", critical: "#f87171" };

  return (
    <div style={{ display:"flex", gap:16, alignItems:"flex-start", flexWrap:"wrap", justifyContent:"center", width:"100%" }}>

      {/* ── Stage + captions ──────────────────────────────────── */}
      <div style={{ position:"relative", flexShrink:0 }}>
        <SceneRenderer
          ref={rendererRef}
          scene={sceneJSON}
          autoPlay={false}
          width={STAGE_W}
          showDebug={false}
          onTick={({ time }) => setSceneTime(time)}
          onComplete={() => setPlaying(false)}
        />
        {/* SubtitleRenderer overlaid on stage */}
        <SubtitleRenderer
          captions={captions}
          mode="word"
          stageWidth={STAGE_W}
          stageHeight={Math.round(STAGE_W * 420/360)}
        />
      </div>

      {/* ── Layer 5 control panel ──────────────────────────────── */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, width:260, maxHeight:"90vh", overflowY:"auto" }}>

        {/* Scene switcher */}
        <div style={css.section}>
          <p style={css.title}>scene playlist</p>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {Object.keys(SCENES).map(key => (
              <button key={key}
                style={activeScene === key ? css.pillOn : css.pill}
                onClick={() => switchScene(key)}>
                {key}
              </button>
            ))}
          </div>
        </div>

        {/* Transport */}
        <div style={css.section}>
          <p style={css.title}>{sceneJSON.meta?.title ?? sceneJSON.meta?.id}
            <span style={css.dim}>{sceneJSON.meta?.duration}s</span>
          </p>
          <div style={{ display:"flex", gap:5, marginBottom:7 }}>
            <button style={css.btn} onClick={restart}>↺</button>
            {playing
              ? <button style={css.btnGreen} onClick={pause}>⏸ pause</button>
              : <button style={css.btn}      onClick={play}>▶ play</button>
            }
          </div>
          <input type="range" min="0" max={sceneDur || sceneJSON.meta?.duration || 10}
                 step="0.05" value={sceneTime} onChange={seek}
                 style={{ width:"100%", marginBottom:3 }}/>
          <div style={{ ...css.stats, display:"flex", justifyContent:"space-between" }}>
            <span>{sceneTime.toFixed(2)}s</span>
            <span>{pct}%</span>
            <span>{(sceneDur || sceneJSON.meta?.duration || 0).toFixed(1)}s</span>
          </div>
        </div>

        {/* Subtitles / captions info */}
        <div style={css.section}>
          <p style={css.title}>subtitles <span style={css.dim}>{captions.length} cues</span></p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
            {captions.map((c, i) => (
              <span key={i} style={{
                padding:"2px 6px", fontSize:10, borderRadius:5,
                fontFamily:"monospace",
                background: sceneTime >= c.at && sceneTime < c.end ? "#1a3a2a" : "#ffffff08",
                border: sceneTime >= c.at && sceneTime < c.end
                  ? "1px solid #4ade8050" : "1px solid #ffffff10",
                color: sceneTime >= c.at && sceneTime < c.end ? "#4ade80" : "#ffffff30",
              }}>
                {c.at.toFixed(1)}s "{c.text?.slice(0,20)}…"
              </span>
            ))}
            {captions.length === 0 && (
              <span style={{ fontSize:11, color:"#ffffff25" }}>
                No dialogue in this scene
              </span>
            )}
          </div>
        </div>

        {/* Character variant system */}
        <div style={css.section}>
          <p style={css.title}>character variants</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:6 }}>
            {VariantSystem.listVariants().map(id => (
              <button key={id}
                style={activeVariant === id ? css.pillOn : css.pill}
                onClick={() => applyVariant(id)}>
                {id}
              </button>
            ))}
          </div>
          <div style={css.stats}>
            Active: {activeVariant}
            {BUILTIN_VARIANTS[activeVariant] && (
              <div style={{ display:"flex", gap:4, marginTop:4, flexWrap:"wrap" }}>
                {Object.entries(BUILTIN_VARIANTS[activeVariant].palette).map(([k,v]) => (
                  <div key={k} style={{ display:"flex", alignItems:"center", gap:3, fontSize:10 }}>
                    <div style={{ width:10, height:10, borderRadius:2, background:v, border:"1px solid #ffffff20" }}/>
                    <span style={{ color:"#ffffff40", fontFamily:"monospace" }}>{k}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Performance monitor */}
        <div style={css.section}>
          <p style={css.title}>performance monitor</p>
          {perfMetrics ? (
            <div style={css.stats}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span>FPS</span>
                <span style={{ color: statusColor[perfMetrics.status] ?? "#4ade80", fontWeight:600 }}>
                  {perfMetrics.fps}
                </span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span>Active tweens</span>
                <span style={{ color: perfMetrics.tweenCount > 80 ? "#facc15" : "#ffffff50" }}>
                  {perfMetrics.tweenCount}
                </span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span>Timelines</span>
                <span style={{ color:"#ffffff40" }}>{perfMetrics.tlCount}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span>Status</span>
                <span style={{ color: statusColor[perfMetrics.status], fontWeight:600 }}>
                  {perfMetrics.status.toUpperCase()}
                </span>
              </div>
              {perfMetrics.warnings.length > 0 && (
                <div style={{ marginTop:4 }}>
                  {perfMetrics.warnings.map((w,i) => (
                    <div key={i} style={{ color:"#facc15", fontSize:10 }}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span style={{ fontSize:11, color:"#ffffff25" }}>starting…</span>
          )}
        </div>

        {/* Schema validation */}
        <div style={css.section}>
          <p style={css.title}>
            schema validation
            {validationResult && (
              <span style={{ color: validationResult.ok ? "#4ade80" : "#f87171", marginLeft:6 }}>
                {validationResult.ok ? "✓ valid" : `✗ ${validationResult.errors.length} error(s)`}
              </span>
            )}
          </p>
          {validationResult && (
            <div style={css.stats}>
              {validationResult.errors.map((e,i) => (
                <div key={i} style={{ color:"#f87171", fontSize:10 }}>✗ {e}</div>
              ))}
              {validationResult.warnings.map((w,i) => (
                <div key={i} style={{ color:"#facc15", fontSize:10 }}>⚠ {w}</div>
              ))}
              {validationResult.ok && validationResult.warnings.length === 0 && (
                <div style={{ color:"#4ade80", fontSize:10 }}>All checks passed</div>
              )}
            </div>
          )}
        </div>

        {/* Event log */}
        <div style={css.section}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <p style={css.title}>event log</p>
            <button style={{ ...css.dim, cursor:"pointer", background:"none", border:"none" }}
                    onClick={() => setSceneLog([])}>clear</button>
          </div>
          <div style={{ fontFamily:"monospace", fontSize:10, lineHeight:1.8 }}>
            {sceneLog.length === 0
              ? <span style={{ color:"#ffffff15" }}>press play</span>
              : sceneLog.map((e,i) => (
                  <div key={i} style={{ color: i===0 ? "#ffffff65" : "#ffffff25" }}>{e}</div>
                ))
            }
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const css = {
  section: {
    background: "#ffffff07", border: "1px solid #ffffff0d",
    borderRadius: 10, padding: "9px 11px",
  },
  title: {
    fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
    color: "#ffffff28", fontFamily: "monospace", marginBottom: 7,
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  dim:   { fontSize: 10, color: "#ffffff20", fontFamily: "monospace" },
  stats: { fontSize: 11, fontFamily: "monospace", color: "#ffffff35", lineHeight: 1.9 },
  pill: {
    padding: "3px 7px", fontSize: 11,
    background: "#ffffff08", border: "1px solid #ffffff12",
    borderRadius: 5, color: "#c0c0c0", cursor: "pointer",
  },
  pillOn: {
    padding: "3px 7px", fontSize: 11,
    background: "#2a4e9938", border: "1px solid #3a6bbf70",
    borderRadius: 5, color: "#90b4ff", cursor: "pointer",
  },
  btn: {
    flex: 1, padding: "6px 10px", fontSize: 12,
    background: "#ffffff08", border: "1px solid #ffffff18",
    borderRadius: 7, color: "#c0c0c0", cursor: "pointer",
  },
  btnGreen: {
    flex: 1, padding: "6px 10px", fontSize: 12,
    background: "#1a4a2e50", border: "1px solid #4ade8060",
    borderRadius: 7, color: "#4ade80", cursor: "pointer",
  },
};
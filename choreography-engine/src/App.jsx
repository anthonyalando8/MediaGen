import { useRef, useEffect, useState, useCallback } from "react";
import SVGPuppet    from "./characters/SVGPuppet.jsx";
import Stage        from "./stage/Stage.jsx";
import SceneRenderer from "./runtime/SceneRenderer.jsx";
import { ActionRegistry }  from "./actions/index.js";
import { EventBus }        from "./runtime/EventBus.js";
import { CameraRig }       from "./camera/CameraRig.js";
import { BACKGROUND_PRESETS, LIGHTING_PRESETS } from "./stage/StageManager.js";
import exampleScene from "../scenes/example_scene.json";

/**
 * App.jsx — Layer 4 dev harness
 * Three modes:
 *   "interactive" — Layer 2: fire actions manually, test expressions
 *   "scene"       — Layer 3: play scene JSON through MasterTimeline
 *   "stage"       — Layer 4: test Stage, Camera, background/lighting
 */

const STAGE_W = 360;

const ACTION_GROUPS = {
  "entrances":  ["walk_in", "fade_in", "pop_in"],
  "exits":      ["walk_out"],
  "locomotion": ["walk_cycle", "run_cycle"],
  "reactions":  ["jump", "recoil", "panic", "laugh"],
  "gestures":   ["point_forward", "wave", "arms_cross", "hands_up",
                  "lunge", "nod", "shake_head", "stand_firm"],
};

export default function App() {
  const [mode,   setMode]   = useState("interactive");

  // ── Interactive mode state ─────────────────────────────────────
  const rigRef       = useRef(null);
  const stageRef     = useRef(null);
  const cameraRef    = useRef(null);
  const idleRef      = useRef(null);
  const actionTLRef  = useRef(null);
  const [audit,       setAudit]       = useState(null);
  const [activeExpr,  setActiveExpr]  = useState("neutral");
  const [activeAct,   setActiveAct]   = useState(null);
  const [idleMode,    setIdleMode]    = useState("default");
  const [bgPreset,    setBgPreset]    = useState("default");
  const [ltPreset,    setLtPreset]    = useState("neutral");
  const [activeCam,   setActiveCam]   = useState(null);

  // ── Scene mode state ───────────────────────────────────────────
  const sceneRef     = useRef(null);
  const [sceneTime,  setSceneTime]   = useState(0);
  const [sceneDur,   setSceneDur]    = useState(0);
  const [scenePlaying, setScenePlaying] = useState(false);
  const [sceneLog,   setSceneLog]    = useState([]);

  // ── Interactive mount ──────────────────────────────────────────
  useEffect(() => {
    if (mode !== "interactive" && mode !== "stage") return;
    const rig = rigRef.current;
    if (!rig) return;

    const result = {};
    Object.entries(rig).forEach(([k, v]) => {
      result[k] = Array.isArray(v) ? v.every(Boolean) : Boolean(v);
    });
    setAudit(result);

    idleRef.current = ActionRegistry.startIdle(rig, idleMode);

    // Wire camera to stage outer div
    if (stageRef.current?.stageEl) {
      cameraRef.current = new CameraRig(stageRef.current.stageEl);
    }

    return () => { idleRef.current?.kill(); cameraRef.current?.destroy(); };
  }, [mode]);

  // Rebuild idle when mode changes
  const switchIdle = useCallback((m) => {
    idleRef.current?.kill();
    idleRef.current = ActionRegistry.startIdle(rigRef.current, m);
    setIdleMode(m);
  }, []);

  // ── Scene EventBus ─────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "scene") return;
    const log = (msg) => setSceneLog(p => [`${p.length+1}. ${msg}`, ...p].slice(0, 14));
    const unsubs = [
      EventBus.on("scene:built",      ({ sceneId, duration }) => {
        setSceneDur(duration);
        log(`Built "${sceneId}" — ${duration.toFixed(2)}s`);
      }),
      EventBus.on("scene:start",      ({ sceneId }) => { setScenePlaying(true);  log(`▶ "${sceneId}"`); }),
      EventBus.on("scene:complete",   ({ sceneId }) => { setScenePlaying(false); log(`■ complete`); }),
      EventBus.on("scene:tick",       ({ time }) => setSceneTime(time)),
      EventBus.on("character:action", ({ characterId, action, at }) =>
        log(`${characterId}: ${action} @${at.toFixed(1)}s`)),
      EventBus.on("character:expression", ({ characterId, expression }) =>
        log(`${characterId}: [${expression}]`)),
    ];
    return () => unsubs.forEach(u => u());
  }, [mode]);

  // ── Interactive actions ────────────────────────────────────────
  const fireExpr   = useCallback((name) => {
    setActiveExpr(name);
    ActionRegistry.resolveExpression(name, rigRef.current).play();
  }, []);

  const fireAction = useCallback((name) => {
    actionTLRef.current?.kill();
    setActiveAct(name);
    actionTLRef.current = ActionRegistry.resolveAction(name, rigRef.current);
    actionTLRef.current.play();
    setTimeout(() => setActiveAct(null), 2000);
  }, []);

  const fireCamera = useCallback((name) => {
    setActiveCam(name);
    cameraRef.current?.applyPreset(name);
    setTimeout(() => setActiveCam(null), 2000);
  }, []);

  // ── Scene controls ─────────────────────────────────────────────
  const scenePlay    = () => { sceneRef.current?.play();   setScenePlaying(true);  };
  const scenePause   = () => { sceneRef.current?.pause();  setScenePlaying(false); };
  const sceneRestart = () => {
    sceneRef.current?.seekTo(0);
    sceneRef.current?.play();
    setScenePlaying(true);
    setSceneLog([]);
  };
  const sceneSeek = (e) => {
    const t = parseFloat(e.target.value);
    sceneRef.current?.seekTo(t);
    setSceneTime(t);
  };

  const EXPR_NAMES   = ActionRegistry.listExpressions();
  const CAM_PRESETS  = new CameraRig(null).listPresets();
  const BG_NAMES     = Object.keys(BACKGROUND_PRESETS);
  const LT_NAMES     = Object.keys(LIGHTING_PRESETS);
  const allGreen     = audit && Object.values(audit).every(Boolean);
  const pct          = sceneDur > 0 ? ((sceneTime/sceneDur)*100).toFixed(1) : 0;

  return (
    <div style={css.root}>

      {/* ── Mode tabs ─────────────────────────────────────────── */}
      <div style={css.tabs}>
        {["interactive","scene","stage"].map(m => (
          <button key={m}
            style={mode === m ? css.tabOn : css.tab}
            onClick={() => setMode(m)}>
            {m}
          </button>
        ))}
      </div>

      <div style={css.body}>

        {/* ════════ INTERACTIVE ════════ */}
        {mode === "interactive" && (
          <>
            <Stage ref={stageRef} width={STAGE_W} background={bgPreset}
                   lighting={ltPreset} showDebug>
              <SVGPuppet ref={rigRef} characterId="hero"
                         scale={1} x={0} y={0} facingRight={true}/>
            </Stage>

            <div style={css.panel}>
              {/* Idle */}
              <div style={css.section}>
                <p style={css.sectionTitle}>idle mode</p>
                <div style={css.pillGrid}>
                  {["default","menace","float"].map(m => (
                    <button key={m}
                      style={idleMode === m ? css.pillOn : css.pill}
                      onClick={() => switchIdle(m)}>{m}</button>
                  ))}
                </div>
              </div>

              {/* Expressions */}
              <div style={css.section}>
                <p style={css.sectionTitle}>expressions <span style={css.cnt}>{EXPR_NAMES.length}</span></p>
                <div style={css.pillGrid}>
                  {EXPR_NAMES.map(n => (
                    <button key={n}
                      style={activeExpr === n ? css.pillExpr : css.pill}
                      onClick={() => fireExpr(n)}>{n}</button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              {Object.entries(ACTION_GROUPS).map(([group, names]) => (
                <div key={group} style={css.section}>
                  <p style={css.sectionTitle}>{group} <span style={css.cnt}>{names.length}</span></p>
                  <div style={css.pillGrid}>
                    {names.map(n => (
                      <button key={n}
                        style={activeAct === n ? css.pillAction : css.pill}
                        onClick={() => fireAction(n)}>{n}</button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Refs audit */}
              <div style={css.section}>
                <p style={css.sectionTitle}>
                  rig refs <span style={{ ...css.cnt, color: allGreen ? "#4ade80" : "#f87171" }}>
                    {allGreen ? "all ✓" : "errors ✗"}
                  </span>
                </p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                  {audit && Object.entries(audit).map(([k,ok]) => (
                    <span key={k} style={ok ? css.auditOk : css.auditFail}>{k}</span>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════ SCENE PLAYER ════════ */}
        {mode === "scene" && (
          <>
            <SceneRenderer ref={sceneRef} scene={exampleScene}
                           autoPlay={false} width={STAGE_W} showDebug={false}
                           onTick={({time}) => setSceneTime(time)}
                           onComplete={() => setScenePlaying(false)}/>

            <div style={css.panel}>
              {/* Transport */}
              <div style={css.section}>
                <p style={css.sectionTitle}>{exampleScene.meta.title}
                  <span style={css.cnt}>{exampleScene.meta.duration}s</span>
                </p>
                <div style={{display:"flex",gap:5,marginBottom:8}}>
                  <button style={css.transportBtn} onClick={sceneRestart}>↺ restart</button>
                  {scenePlaying
                    ? <button style={css.transportBtnOn} onClick={scenePause}>⏸ pause</button>
                    : <button style={css.transportBtn}   onClick={scenePlay}>▶ play</button>
                  }
                </div>
                <input type="range" min="0"
                       max={sceneDur || exampleScene.meta.duration}
                       step="0.05" value={sceneTime}
                       onChange={sceneSeek} style={{width:"100%",marginBottom:4}}/>
                <div style={{...css.stats,display:"flex",justifyContent:"space-between"}}>
                  <span>{sceneTime.toFixed(2)}s</span>
                  <span>{pct}%</span>
                  <span>{(sceneDur||exampleScene.meta.duration).toFixed(2)}s</span>
                </div>
              </div>

              {/* Character schedule */}
              <div style={css.section}>
                <p style={css.sectionTitle}>character schedule</p>
                {exampleScene.characters.map(char => (
                  <div key={char.id} style={{marginBottom:8}}>
                    <div style={{fontSize:11,color:"#ffffff55",fontFamily:"monospace",marginBottom:3}}>
                      {char.id} — {char.idleMode}
                    </div>
                    <div style={css.pillGrid}>
                      {char.actions.map((a,i) => (
                        <span key={i} style={{
                          padding:"2px 5px",fontSize:10,borderRadius:5,
                          fontFamily:"monospace",
                          background: sceneTime >= a.at ? "#1a3a2a" : "#ffffff08",
                          border: sceneTime >= a.at ? "1px solid #4ade8040" : "1px solid #ffffff10",
                          color: sceneTime >= a.at ? "#4ade80" : "#ffffff25",
                        }}>
                          {a.at}s {a.name ?? ""}{a.expression ? ` [${a.expression}]` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Camera */}
              <div style={css.section}>
                <p style={css.sectionTitle}>camera</p>
                <div style={css.pillGrid}>
                  {exampleScene.camera.map((c,i) => (
                    <span key={i} style={{
                      padding:"2px 5px",fontSize:10,borderRadius:5,fontFamily:"monospace",
                      background: sceneTime >= c.at ? "#1a1a3a" : "#ffffff08",
                      border: sceneTime >= c.at ? "1px solid #90b4ff40" : "1px solid #ffffff10",
                      color: sceneTime >= c.at ? "#90b4ff" : "#ffffff25",
                    }}>
                      {c.at}s {c.preset}
                    </span>
                  ))}
                </div>
              </div>

              {/* Event log */}
              <div style={css.section}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <p style={css.sectionTitle}>event log</p>
                  <button style={{...css.cnt,cursor:"pointer",background:"none",border:"none"}}
                          onClick={()=>setSceneLog([])}>clear</button>
                </div>
                <div style={{fontFamily:"monospace",fontSize:10,lineHeight:1.8}}>
                  {sceneLog.length === 0
                    ? <span style={{color:"#ffffff18"}}>press play</span>
                    : sceneLog.map((e,i) => (
                        <div key={i} style={{color: i===0 ? "#ffffff70" : "#ffffff28"}}>{e}</div>
                      ))
                  }
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════ STAGE LAB (Layer 4) ════════ */}
        {mode === "stage" && (
          <>
            <Stage ref={stageRef} width={STAGE_W}
                   background={bgPreset} lighting={ltPreset} showDebug>
              <SVGPuppet ref={rigRef} characterId="hero"
                         scale={1} x={-55} y={0} facingRight={true}/>
              <SVGPuppet characterId="villain"
                         scale={1} x={55} y={0} facingRight={false}/>
            </Stage>

            <div style={css.panel}>

              {/* Background presets */}
              <div style={css.section}>
                <p style={css.sectionTitle}>background <span style={css.cnt}>{BG_NAMES.length}</span></p>
                <div style={css.pillGrid}>
                  {BG_NAMES.map(n => (
                    <button key={n}
                      style={bgPreset === n ? css.pillOn : css.pill}
                      onClick={() => setBgPreset(n)}>{n}</button>
                  ))}
                </div>
              </div>

              {/* Lighting presets */}
              <div style={css.section}>
                <p style={css.sectionTitle}>lighting <span style={css.cnt}>{LT_NAMES.length}</span></p>
                <div style={css.pillGrid}>
                  {LT_NAMES.map(n => (
                    <button key={n}
                      style={ltPreset === n ? css.pillOn : css.pill}
                      onClick={() => setLtPreset(n)}>{n}</button>
                  ))}
                </div>
              </div>

              {/* Camera presets */}
              <div style={css.section}>
                <p style={css.sectionTitle}>camera <span style={css.cnt}>{CAM_PRESETS.length}</span></p>
                <div style={css.pillGrid}>
                  {CAM_PRESETS.map(n => (
                    <button key={n}
                      style={activeCam === n ? css.pillCam : css.pill}
                      onClick={() => fireCamera(n)}>{n}</button>
                  ))}
                </div>
                <button style={{...css.pill, marginTop:6, width:"100%", textAlign:"center"}}
                        onClick={() => cameraRef.current?.reset()}>
                  ↺ reset camera
                </button>
              </div>

              {/* Idle mode for stage lab */}
              <div style={css.section}>
                <p style={css.sectionTitle}>idle mode</p>
                <div style={css.pillGrid}>
                  {["default","menace","float"].map(m => (
                    <button key={m}
                      style={idleMode === m ? css.pillOn : css.pill}
                      onClick={() => switchIdle(m)}>{m}</button>
                  ))}
                </div>
              </div>

              {/* StageManager info */}
              <div style={css.section}>
                <p style={css.sectionTitle}>stage info</p>
                <div style={css.stats}>
                  <div>viewBox: -180 -400 360 420</div>
                  <div>pixel: {STAGE_W} × {Math.round(420*(STAGE_W/360))}px</div>
                  <div>background: {bgPreset}</div>
                  <div>lighting: {ltPreset}</div>
                  <div>aspect: 9:16 (6:7 coord)</div>
                </div>
              </div>

            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const css = {
  root: {
    display: "flex", flexDirection: "column",
    alignItems: "center", padding: 20, gap: 14, minHeight: "100vh",
  },
  tabs: {
    display: "flex", gap: 3,
    background: "#ffffff08", border: "1px solid #ffffff10",
    borderRadius: 8, padding: 3,
  },
  tab: {
    padding: "5px 14px", fontSize: 12,
    background: "transparent", border: "1px solid transparent",
    borderRadius: 6, color: "#ffffff45", cursor: "pointer",
  },
  tabOn: {
    padding: "5px 14px", fontSize: 12,
    background: "#ffffff12", border: "1px solid #ffffff22",
    borderRadius: 6, color: "#ffffff", cursor: "pointer",
  },
  body: {
    display: "flex", gap: 16, alignItems: "flex-start",
    flexWrap: "wrap", justifyContent: "center", width: "100%",
  },
  panel: {
    display: "flex", flexDirection: "column", gap: 10,
    width: 270, maxHeight: "90vh", overflowY: "auto",
  },
  section: {
    background: "#ffffff07", border: "1px solid #ffffff0d",
    borderRadius: 10, padding: "9px 11px",
  },
  sectionTitle: {
    fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
    color: "#ffffff28", fontFamily: "monospace", marginBottom: 7,
    display: "flex", justifyContent: "space-between",
  },
  cnt: {
    fontSize: 10, color: "#ffffff20", fontFamily: "monospace",
  },
  pillGrid: { display: "flex", flexWrap: "wrap", gap: 4 },
  pill: {
    padding: "4px 8px", fontSize: 11,
    background: "#ffffff08", border: "1px solid #ffffff13",
    borderRadius: 6, color: "#c0c0c0", cursor: "pointer",
  },
  pillOn: {
    padding: "4px 8px", fontSize: 11,
    background: "#2a4e9938", border: "1px solid #3a6bbf70",
    borderRadius: 6, color: "#90b4ff", cursor: "pointer",
  },
  pillExpr: {
    padding: "4px 8px", fontSize: 11,
    background: "#2a4e9935", border: "1px solid #3a6bbf80",
    borderRadius: 6, color: "#90b4ff", cursor: "pointer",
  },
  pillAction: {
    padding: "4px 8px", fontSize: 11,
    background: "#1a4a2e35", border: "1px solid #4ade8060",
    borderRadius: 6, color: "#4ade80", cursor: "pointer",
  },
  pillCam: {
    padding: "4px 8px", fontSize: 11,
    background: "#3a1a4a35", border: "1px solid #c084fc60",
    borderRadius: 6, color: "#c084fc", cursor: "pointer",
  },
  auditOk: {
    padding: "2px 5px", fontSize: 10,
    background: "#ffffff08", border: "1px solid #ffffff10",
    borderRadius: 5, color: "#ffffff30",
  },
  auditFail: {
    padding: "2px 5px", fontSize: 10,
    background: "#ffffff08", border: "1px solid #f8717150",
    borderRadius: 5, color: "#f87171",
  },
  stats: {
    fontSize: 11, fontFamily: "monospace", color: "#ffffff28", lineHeight: 1.9,
  },
  transportBtn: {
    flex: 1, padding: "6px 10px", fontSize: 12,
    background: "#ffffff08", border: "1px solid #ffffff18",
    borderRadius: 7, color: "#c0c0c0", cursor: "pointer",
  },
  transportBtnOn: {
    flex: 1, padding: "6px 10px", fontSize: 12,
    background: "#1a4a2e50", border: "1px solid #4ade8060",
    borderRadius: 7, color: "#4ade80", cursor: "pointer",
  },
};
import { useRef, useEffect, useState, useCallback } from "react";
import SVGPuppet    from "./characters/SVGPuppet.jsx";
import SceneRenderer from "./runtime/SceneRenderer.jsx";
import { ActionRegistry } from "./actions/index.js";
import { EventBus }       from "./runtime/EventBus.js";
import exampleScene from "../scenes/example_scene.json";

/**
 * App.jsx — Layer 3 dev harness
 * Two modes:
 *   "interactive" — Layer 2 panel: fire actions/expressions manually
 *   "scene"       — Layer 3 panel: play scene JSON through MasterTimeline
 */

const VIEWBOX = "-180 -400 360 420";
const STAGE_W = 360;
const STAGE_H = 420;

const ACTION_GROUPS = {
  "entrances":  ["walk_in", "fade_in", "pop_in"],
  "exits":      ["walk_out"],
  "locomotion": ["walk_cycle", "run_cycle"],
  "reactions":  ["jump", "recoil", "panic", "laugh"],
  "gestures":   ["point_forward", "wave", "arms_cross", "hands_up", "lunge", "nod", "shake_head", "stand_firm"],
};

export default function App() {
  const [mode, setMode]          = useState("interactive");
  const rigRef                   = useRef(null);
  const idleRef                  = useRef(null);
  const actionTLRef              = useRef(null);
  const sceneRendererRef         = useRef(null);
  const [audit,      setAudit]   = useState(null);
  const [activeExpr, setActiveExpr] = useState("neutral");
  const [activeAct,  setActiveAct]  = useState(null);
  const [idleMode,   setIdleMode]   = useState("default");
  const [sceneTime,  setSceneTime]  = useState(0);
  const [sceneDur,   setSceneDur]   = useState(0);
  const [scenePlaying, setScenePlaying] = useState(false);
  const [sceneLog,   setSceneLog]   = useState([]);

  // Track when the interactive rig is actually populated
  const [rigReady, setRigReady] = useState(false);

  const handleRigRef = useCallback((imperative) => {
    rigRef.current = imperative;
    if (imperative) setRigReady(true);
  }, []);

  // ── Interactive mode mount — waits for rig to be populated ───
  useEffect(() => {
    if (mode !== "interactive") return;
    if (!rigReady) return;
    const rig = rigRef.current;
    if (!rig) return;

    const result = {};
    Object.entries(rig).forEach(([key, val]) => {
      result[key] = Array.isArray(val) ? val.every(Boolean) : Boolean(val);
    });
    setAudit(result);

    idleRef.current?.kill();
    idleRef.current = ActionRegistry.startIdle(rig, idleMode);
    return () => { idleRef.current?.kill(); };
  }, [mode, rigReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scene mode EventBus wiring ────────────────────────────────
  useEffect(() => {
    if (mode !== "scene") return;

    const log = (msg) => setSceneLog(prev => [`${prev.length + 1}. ${msg}`, ...prev].slice(0, 12));

    const unsubs = [
      EventBus.on("scene:built",      ({ sceneId, duration }) => {
        setSceneDur(duration);
        log(`Built "${sceneId}" — ${duration.toFixed(2)}s`);
      }),
      EventBus.on("scene:start",      ({ sceneId }) => {
        setScenePlaying(true);
        log(`Playing "${sceneId}"`);
      }),
      EventBus.on("scene:complete",   ({ sceneId }) => {
        setScenePlaying(false);
        log(`Complete "${sceneId}"`);
      }),
      EventBus.on("scene:tick",       ({ time }) => setSceneTime(time)),
      EventBus.on("character:action", ({ characterId, action, at }) =>
        log(`${characterId}: ${action} @ ${at.toFixed(1)}s`)),
      EventBus.on("character:expression", ({ characterId, expression, at }) =>
        log(`${characterId}: [${expression}] @ ${at.toFixed(1)}s`)),
    ];

    return () => unsubs.forEach(u => u());
  }, [mode]);

  // ── Interactive controls ──────────────────────────────────────
  const switchIdle = useCallback((m) => {
    idleRef.current?.kill();
    idleRef.current = ActionRegistry.startIdle(rigRef.current, m);
    setIdleMode(m);
  }, []);

  const fireExpression = useCallback((name) => {
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

  // ── Scene controls ────────────────────────────────────────────
  const scenePlay    = () => { sceneRendererRef.current?.play();   setScenePlaying(true);  };
  const scenePause   = () => { sceneRendererRef.current?.pause();  setScenePlaying(false); };
  const sceneRestart = () => {
    sceneRendererRef.current?.seekTo(0);
    sceneRendererRef.current?.play();
    setScenePlaying(true);
    setSceneLog([]);
  };
  const sceneSeek = (e) => {
    const t = parseFloat(e.target.value);
    sceneRendererRef.current?.seekTo(t);
    setSceneTime(t);
  };

  const EXPR_NAMES = ActionRegistry.listExpressions();
  const allGreen   = audit && Object.values(audit).every(Boolean);
  const pct        = sceneDur > 0 ? ((sceneTime / sceneDur) * 100).toFixed(1) : 0;

  return (
    <div style={css.root}>

      {/* ── Mode tabs ─────────────────────────────────────────── */}
      <div style={css.tabs}>
        <button style={mode === "interactive" ? css.tabOn : css.tab}
                onClick={() => setMode("interactive")}>
          interactive
        </button>
        <button style={mode === "scene" ? css.tabOn : css.tab}
                onClick={() => setMode("scene")}>
          scene player
        </button>
      </div>

      <div style={css.body}>

        {/* ════════ INTERACTIVE MODE ════════ */}
        {mode === "interactive" && (
          <>
            {/* Stage */}
            <div style={css.stageWrap}>
              <span style={css.stageBadge}>interactive</span>
              <div style={css.idleRow}>
                {["default", "menace", "float"].map(m => (
                  <button key={m}
                    style={idleMode === m ? css.idleBtnOn : css.idleBtn}
                    onClick={() => switchIdle(m)}>
                    {m}
                  </button>
                ))}
              </div>
              <svg width={STAGE_W} height={STAGE_H} viewBox={VIEWBOX}
                   xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}
                   aria-label="Interactive stage">
                <line x1="-180" y1="0" x2="180" y2="0"
                      stroke="#ffffff18" strokeWidth="1" strokeDasharray="5 5"/>
                <SVGPuppet ref={handleRigRef} characterId="hero"
                           scale={1} x={0} y={0} facingRight={true}/>
              </svg>
            </div>

            {/* Controls panel */}
            <div style={css.panel}>
              <div style={css.section}>
                <div style={css.sectionHead}>
                  <span style={css.sectionTitle}>expressions</span>
                  <span style={css.badge}>{EXPR_NAMES.length}</span>
                </div>
                <div style={css.pillGrid}>
                  {EXPR_NAMES.map(name => (
                    <button key={name}
                      style={activeExpr === name ? css.pillExprOn : css.pill}
                      onClick={() => fireExpression(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {Object.entries(ACTION_GROUPS).map(([group, names]) => (
                <div key={group} style={css.section}>
                  <div style={css.sectionHead}>
                    <span style={css.sectionTitle}>{group}</span>
                    <span style={css.badge}>{names.length}</span>
                  </div>
                  <div style={css.pillGrid}>
                    {names.map(name => (
                      <button key={name}
                        style={activeAct === name ? css.pillActionOn : css.pill}
                        onClick={() => fireAction(name)}>
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div style={css.section}>
                <div style={css.sectionHead}>
                  <span style={css.sectionTitle}>registry</span>
                  <span style={{ ...css.badge, color: allGreen ? "#4ade80" : "#f87171" }}>
                    {allGreen ? "refs ✓" : "refs ✗"}
                  </span>
                </div>
                <div style={css.stats}>
                  <div>{ActionRegistry.listActions().length} actions</div>
                  <div>{ActionRegistry.listExpressions().length} expressions</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════ SCENE MODE ════════ */}
        {mode === "scene" && (
          <>
            {/* Scene stage */}
            <div style={{ flexShrink: 0 }}>
              <SceneRenderer
                ref={sceneRendererRef}
                scene={exampleScene}
                autoPlay={false}
                width={340}
                showDebug={true}
                onTick={({ time }) => setSceneTime(time)}
                onComplete={() => setScenePlaying(false)}
              />
            </div>

            {/* Scene controls panel */}
            <div style={css.panel}>

              {/* Transport */}
              <div style={css.section}>
                <div style={css.sectionHead}>
                  <span style={css.sectionTitle}>{exampleScene.meta.title}</span>
                  <span style={css.badge}>{exampleScene.meta.duration}s</span>
                </div>

                {/* Playback buttons */}
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <button style={css.transportBtn} onClick={sceneRestart}>↺ restart</button>
                  {scenePlaying
                    ? <button style={css.transportBtnOn} onClick={scenePause}>⏸ pause</button>
                    : <button style={css.transportBtn}   onClick={scenePlay}>▶ play</button>
                  }
                </div>

                {/* Scrubber */}
                <input
                  type="range" min="0" max={sceneDur || exampleScene.meta.duration}
                  step="0.05" value={sceneTime}
                  onChange={sceneSeek}
                  style={{ width: "100%", marginBottom: 4 }}
                />
                <div style={{ ...css.stats, display: "flex", justifyContent: "space-between" }}>
                  <span>{sceneTime.toFixed(2)}s</span>
                  <span>{pct}%</span>
                  <span>{(sceneDur || exampleScene.meta.duration).toFixed(2)}s</span>
                </div>
              </div>

              {/* Character schedule */}
              <div style={css.section}>
                <div style={css.sectionHead}>
                  <span style={css.sectionTitle}>character schedule</span>
                </div>
                {exampleScene.characters.map(char => (
                  <div key={char.id} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: "#ffffff60", fontFamily: "monospace", marginBottom: 3 }}>
                      {char.id} — idle: {char.idleMode}
                    </div>
                    <div style={css.pillGrid}>
                      {char.actions.map((a, i) => (
                        <span key={i} style={{
                          ...css.auditOk,
                          padding: "2px 6px",
                          fontSize: 10,
                          opacity: sceneTime >= a.at ? 1 : 0.35,
                          border: sceneTime >= a.at
                            ? "1px solid #4ade8040"
                            : "1px solid #ffffff10",
                          color: sceneTime >= a.at ? "#4ade80" : "#ffffff35",
                        }}>
                          {a.at}s {a.name ?? ""}{a.expression ? ` [${a.expression}]` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Camera schedule */}
              <div style={css.section}>
                <div style={css.sectionHead}>
                  <span style={css.sectionTitle}>camera</span>
                </div>
                <div style={css.pillGrid}>
                  {exampleScene.camera.map((c, i) => (
                    <span key={i} style={{
                      ...css.auditOk,
                      fontSize: 10,
                      padding: "2px 6px",
                      opacity: sceneTime >= c.at ? 1 : 0.35,
                      border: sceneTime >= c.at
                        ? "1px solid #90b4ff40"
                        : "1px solid #ffffff10",
                      color: sceneTime >= c.at ? "#90b4ff" : "#ffffff35",
                    }}>
                      {c.at}s {c.preset}
                    </span>
                  ))}
                </div>
              </div>

              {/* Event log */}
              <div style={css.section}>
                <div style={css.sectionHead}>
                  <span style={css.sectionTitle}>event log</span>
                  <button style={{ ...css.badge, cursor: "pointer", background: "none", border: "none" }}
                          onClick={() => setSceneLog([])}>
                    clear
                  </button>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 10, lineHeight: 1.8 }}>
                  {sceneLog.length === 0
                    ? <span style={{ color: "#ffffff20" }}>press play to start</span>
                    : sceneLog.map((entry, i) => (
                        <div key={i} style={{ color: i === 0 ? "#ffffff80" : "#ffffff30" }}>
                          {entry}
                        </div>
                      ))
                  }
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
    alignItems: "center", padding: 24, gap: 16,
    minHeight: "100vh",
  },
  tabs: {
    display: "flex", gap: 4,
    background: "#ffffff08",
    border: "1px solid #ffffff12",
    borderRadius: 8, padding: 3,
  },
  tab: {
    padding: "5px 16px", fontSize: 12,
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 6, color: "#ffffff50", cursor: "pointer",
  },
  tabOn: {
    padding: "5px 16px", fontSize: 12,
    background: "#ffffff12",
    border: "1px solid #ffffff20",
    borderRadius: 6, color: "#ffffff", cursor: "pointer",
  },
  body: {
    display: "flex", gap: 20, alignItems: "flex-start",
    flexWrap: "wrap", justifyContent: "center",
    width: "100%",
  },
  stageWrap: {
    position: "relative",
    background: "linear-gradient(180deg,#0b0b18 0%,#121220 100%)",
    borderRadius: 16, border: "1px solid #ffffff12",
    overflow: "hidden", flexShrink: 0,
  },
  stageBadge: {
    position: "absolute", top: 10, left: 14,
    fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
    color: "#ffffff25", fontFamily: "monospace", userSelect: "none",
  },
  idleRow: {
    position: "absolute", bottom: 10, left: "50%",
    transform: "translateX(-50%)",
    display: "flex", gap: 4, zIndex: 1,
  },
  idleBtn: {
    padding: "3px 8px", fontSize: 10,
    background: "#ffffff0a", border: "1px solid #ffffff18",
    borderRadius: 5, color: "#ffffff50", cursor: "pointer",
  },
  idleBtnOn: {
    padding: "3px 8px", fontSize: 10,
    background: "#3a6bbf40", border: "1px solid #3a6bbf80",
    borderRadius: 5, color: "#90b4ff", cursor: "pointer",
  },
  panel: {
    display: "flex", flexDirection: "column", gap: 10,
    width: 280, maxHeight: "90vh", overflowY: "auto",
  },
  section: {
    background: "#ffffff07", border: "1px solid #ffffff0e",
    borderRadius: 10, padding: "10px 12px",
  },
  sectionHead: {
    display: "flex", justifyContent: "space-between",
    alignItems: "center", marginBottom: 7,
  },
  sectionTitle: {
    fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
    color: "#ffffff30", fontFamily: "monospace",
  },
  badge: {
    fontSize: 10, color: "#ffffff25", fontFamily: "monospace",
  },
  pillGrid: {
    display: "flex", flexWrap: "wrap", gap: 4,
  },
  pill: {
    padding: "4px 9px", fontSize: 11,
    background: "#ffffff08", border: "1px solid #ffffff14",
    borderRadius: 6, color: "#c0c0c0", cursor: "pointer",
  },
  pillExprOn: {
    padding: "4px 9px", fontSize: 11,
    background: "#2a4e9935", border: "1px solid #3a6bbf80",
    borderRadius: 6, color: "#90b4ff", cursor: "pointer",
  },
  pillActionOn: {
    padding: "4px 9px", fontSize: 11,
    background: "#1a4a2e35", border: "1px solid #4ade8060",
    borderRadius: 6, color: "#4ade80", cursor: "pointer",
  },
  auditOk: {
    padding: "2px 6px", fontSize: 10,
    background: "#ffffff08", border: "1px solid #ffffff10",
    borderRadius: 6, color: "#ffffff35",
  },
  auditFail: {
    padding: "2px 6px", fontSize: 10,
    background: "#ffffff08", border: "1px solid #f8717150",
    borderRadius: 6, color: "#f87171",
  },
  stats: {
    fontSize: 11, fontFamily: "monospace",
    color: "#ffffff30", lineHeight: 1.8,
  },
  transportBtn: {
    flex: 1, padding: "7px 10px", fontSize: 12,
    background: "#ffffff08", border: "1px solid #ffffff18",
    borderRadius: 7, color: "#c0c0c0", cursor: "pointer",
  },
  transportBtnOn: {
    flex: 1, padding: "7px 10px", fontSize: 12,
    background: "#1a4a2e50", border: "1px solid #4ade8060",
    borderRadius: 7, color: "#4ade80", cursor: "pointer",
  },
};
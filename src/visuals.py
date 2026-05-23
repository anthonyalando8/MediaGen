"""
visuals.py  --  Visual renderer (HTML/Playwright only)

Calls the Node/Playwright renderer (renderer/capture.js) to produce
per-beat frame directories used by assemble.py.

Requires:
  cd renderer && npm install && npx playwright install chromium

────────────────────────────────────────────────────────────────────
CINEMATIC UPGRADE — what changed vs the previous version
────────────────────────────────────────────────────────────────────
1. Smart per-scene defaults for camera / pace / emotion / background
   so sparsely-described beats still render with motion variety.
2. Layout rotation across beats (not one-layout-for-whole-video).
3. entry_vector emitted per beat — inherits direction from the
   previous beat's camera exit for inter-beat motion carry.
4. Transition variation based on scene type + energy delta.
5. Caller-supplied values always override defaults (LLM wins).
"""

import pathlib
import subprocess
import json
import os

# ---------------------------------------------------------------------------
# .env loader
# ---------------------------------------------------------------------------

def _load_dotenv(env: dict) -> dict:
    """Load .env from project root into env dict without requiring python-dotenv."""
    dotenv_path = pathlib.Path(__file__).parent.parent / ".env"
    if not dotenv_path.exists():
        return env
    result = dict(env)
    for line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in result:   # shell env takes precedence
            result[key] = value
    return result

# ---------------------------------------------------------------------------
# Beat contract helpers
# ---------------------------------------------------------------------------

_KNOWN_SCENES = {
    "hook", "insight", "climax", "cta",
    "tension", "truth", "flip", "payoff",
}

def _beat_scene(beat: dict, i: int, total: int) -> str:
    t = beat.get("type", "insight").lower()
    if i == 0:
        return "hook"
    if i == total - 1:
        return "cta"
    if t in _KNOWN_SCENES:
        return t
    if beat.get("energy", "") == "high" and i == total - 2:
        return "climax"
    return "insight"


def _beat_hud(beat: dict, i: int, total: int) -> str:
    t = beat.get("type", "insight").lower()
    mapping = {
        "hook":    "// HOOK",
        "insight": "// INSIGHT",
        "climax":  "// KEY",
        "tension": "// TENSION",
        "truth":   "// TRUTH",
        "flip":    "// FLIP",
        "cta":     "// ACTION",
        "breath":  "// —",
        "payoff":  "// PAYOFF",
    }
    return mapping.get(t, "// —")


def _style_to_theme(style: str) -> str:
    style_map = {
        "contrarian": "tech_blue",
        "builder":    "tech_blue",
        "calm":       "clean_modern",
        "analytical": "clean_modern",
        "cinematic":  "luxury_minimal",
        "intense":    "dark_kinetic",
        "humorous":   "warm_amber",
    }
    known_themes = {
        "dark_kinetic", "luxury_minimal", "tech_hud",
        "cinematic_grain", "documentary_gritty", "clean_modern",
        "tech_blue", "editorial_white", "warm_amber", "cyber_noir",
        "humorous",
    }
    s = (style or "").lower().strip()
    if s in known_themes:
        return s
    return style_map.get(s, "tech_blue")


_THEME_PALETTES = {
    "tech_blue":          {"accent": "#4ab0f5", "spike": "#f0884a", "bg": "#09090b", "fg": "#efefed"},
    "editorial_white":    {"accent": "#e8e0d0", "spike": "#c8a882", "bg": "#09090b", "fg": "#efefed"},
    "warm_amber":         {"accent": "#f0a84a", "spike": "#70c8f0", "bg": "#09090b", "fg": "#efefed"},
    "cyber_noir":         {"accent": "#a870f0", "spike": "#70f0a0", "bg": "#060608", "fg": "#efefed"},
    "dark_kinetic":       {"accent": "#f03a2e", "spike": "#f5f0e8", "bg": "#030304", "fg": "#f2f0ee"},
    "luxury_minimal":     {"accent": "#c8a96e", "spike": "#d8d0c0", "bg": "#08080a", "fg": "#f0ece4"},
    "tech_hud":           {"accent": "#28d4e8", "spike": "#b8f040", "bg": "#050709", "fg": "#e8f0f4"},
    "cinematic_grain":    {"accent": "#b88850", "spike": "#507880", "bg": "#0b0a08", "fg": "#ece8e0"},
    "documentary_gritty": {"accent": "#d8d0c0", "spike": "#e8a020", "bg": "#080808", "fg": "#f4f2ef"},
    "clean_modern":       {"accent": "#f2f2f0", "spike": "#ede8dc", "bg": "#09090b", "fg": "#f2f2f0"},
}


# ───────────────────────────────────────────────────────────────────────────
# CINEMATIC DEFAULTS  —  prevents stiff uniformity when the LLM omits fields
# ───────────────────────────────────────────────────────────────────────────

_SCENE_CAMERA = {
    "hook":    "push_in",
    "insight": "static",
    "climax":  "snap_zoom",
    "tension": "tilt_up",
    "truth":   "static",
    "flip":    "micro_shake",
    "payoff":  "pull_out",
    "cta":     "push_in",
}

_SCENE_PACE = {
    "hook":    "fast",
    "insight": "mid",
    "climax":  "explosive",
    "tension": "slow",
    "truth":   "mid",
    "flip":    "fast",
    "payoff":  "slow",
    "cta":     "fast",
}

_SCENE_EMOTION = {
    "hook":    "confident",
    "insight": "serious",
    "climax":  "urgent",
    "tension": "tense",
    "truth":   "confident",
    "flip":    "anxious",
    "payoff":  "hopeful",
    "cta":     "urgent",
}

_SCENE_BACKGROUND_POOL = {
    "hook":    ["glow", "gradient", "abstract"],
    "insight": ["solid", "grid", "lines", "gradient"],
    "climax":  ["abstract", "glow"],
    "tension": ["lines", "noise", "solid"],
    "truth":   ["gradient", "solid"],
    "flip":    ["noise", "lines"],
    "payoff":  ["glow", "gradient"],
    "cta":     ["solid", "glow"],
}

_SCENE_LAYOUT_POOL = {
    "hook":    ["left", "full", "center"],
    "insight": ["left", "right", "center"],
    "climax":  ["full", "center", "left"],
    "tension": ["left", "right"],
    "truth":   ["center", "left"],
    "flip":    ["right", "left"],
    "payoff":  ["center", "left"],
    "cta":     ["full", "center"],
}

_STYLE_LAYOUT_BIAS = {
    "contrarian": "left",
    "builder":    "left",
    "calm":       "center",
    "analytical": "center",
    "cinematic":  "right",
    "intense":    "full",
    "humorous":   "center",
}


def _camera_for(scene: str, i: int) -> str:
    base = _SCENE_CAMERA.get(scene, "static")
    if base == "static":
        return ["static", "handheld", "static", "push_in"][i % 4]
    return base


def _layout_for(scene: str, i: int, style: str) -> str:
    pool = list(_SCENE_LAYOUT_POOL.get(scene, ["left", "center", "right"]))
    bias = _STYLE_LAYOUT_BIAS.get((style or "").lower(), "")
    if bias and bias in pool:
        pool.remove(bias); pool.insert(0, bias)
    return pool[i % len(pool)]


def _background_for(scene: str, i: int) -> str:
    pool = _SCENE_BACKGROUND_POOL.get(scene, ["solid"])
    return pool[i % len(pool)]


def _transition_for(prev: dict, curr: dict, i: int) -> str:
    curr_scene = curr.get("scene", "")
    if curr_scene == "climax":  return "slam_cut"
    if curr_scene == "payoff":  return "fade"
    if curr_scene == "tension": return "dip_black"
    if curr_scene == "flip":    return "flash"
    rhythm = ["cut", "cut", "blur_wipe", "cut", "whip_pan"]
    return rhythm[i % len(rhythm)]


_CAMERA_EXIT_VECTOR = {
    "push_in":     {"x":  0,   "y": -10, "scale": 1.04},
    "pull_out":    {"x":  0,   "y":   4, "scale": 0.98},
    "tilt_up":     {"x":  0,   "y": -12, "scale": 1.02},
    "snap_zoom":   {"x":  0,   "y":  -4, "scale": 1.06},
    "handheld":    {"x":  2,   "y":  -1, "scale": 1.00},
    "micro_shake": {"x":  0,   "y":   0, "scale": 1.05},
    "static":      {"x":  0,   "y":   0, "scale": 1.00},
}

def _exit_vector(camera: str) -> dict:
    return dict(_CAMERA_EXIT_VECTOR.get(camera, _CAMERA_EXIT_VECTOR["static"]))


# ───────────────────────────────────────────────────────────────────────────
# INTENSITY CURVE
# ───────────────────────────────────────────────────────────────────────────

_SCENE_INTENSITY = {
    "hook":    0.95,
    "climax":  1.00,
    "cta":     0.85,
    "flip":    0.82,
    "tension": 0.70,
    "truth":   0.72,
    "payoff":  0.78,
    "insight": 0.60,
}

def _intensity_for(scene: str, i: int, total: int) -> float:
    if scene in _SCENE_INTENSITY:
        base = _SCENE_INTENSITY[scene]
    else:
        progress = i / max(1, total - 1)
        base = 0.55 + 0.40 * progress

    progress = i / max(1, total - 1)
    if 0.25 < progress < 0.40 and scene in {"insight", "truth"}:
        base *= 0.65

    return round(max(0.0, min(1.0, base)), 2)


# ───────────────────────────────────────────────────────────────────────────
# PATTERN INTERRUPT DISTRIBUTION
# ───────────────────────────────────────────────────────────────────────────

_PI_BY_SCENE = {
    "hook":    "slam",
    "climax":  "chroma",
    "tension": "iris",
    "truth":   "iris",
    "flip":    "invert",
    "payoff":  "flash",
    "cta":     "slam",
}

def _assign_interrupts(contracts: list) -> None:
    last_pi = None
    for i, c in enumerate(contracts):
        if c.get("pattern_interrupt"):
            last_pi = c["pattern_interrupt"]
            continue
        if c.get("intensity", 0) < 0.80:
            continue
        scene = c["scene"]
        choice = _PI_BY_SCENE.get(scene, "slam")
        if choice == last_pi:
            alternates = ["slam", "flash", "iris", "chroma"]
            choice = next((x for x in alternates if x != last_pi), choice)
        c["pattern_interrupt"] = choice
        last_pi = choice


# ───────────────────────────────────────────────────────────────────────────
# COMPOSITION MUTATOR
# ───────────────────────────────────────────────────────────────────────────

_MUTATABLE_SCENES = {"insight", "truth", "flip"}
_MUTATORS = ["crop-low", "tilt", "corner", "sparse"]

def _pick_composition_mutator(contracts: list) -> None:
    eligible = [
        i for i, c in enumerate(contracts)
        if c["scene"] in _MUTATABLE_SCENES and not c.get("composition")
    ]
    if not eligible:
        return
    idx = eligible[len(contracts) % len(eligible)]
    mut = _MUTATORS[len(contracts) % len(_MUTATORS)]
    contracts[idx]["composition"] = mut


# ─────────────────────────────────────────────────────────────────────────────
# ▼▼▼ NEW: DYNAMIC KEYWORD FONT SIZE ▼▼▼
# ─────────────────────────────────────────────────────────────────────────────
def _calc_kw_font_size(keyword: str, layout: str, scene: str) -> int:
    """
    Calculate the max keyword font size (px) that fits the longest word
    on a single line within the scene container for the given layout.

    Uses a conservative char-width ratio (0.62em at bold tight-tracked
    uppercase Space Grotesk) with a 10% safety margin so the longest
    word never overflows its container and triggers mid-word line breaks.

    Applies to ALL scene types — [class$="-kw"] in capture.js picks it up
    universally via CSS override, covering hook-kw, truth-kw, climax-kw, etc.

    Examples:
      "FAKE CONFIDENCE"  right  → 116px  (was sz-hero=168, CONFIDENCE=10 chars)
      "HIDDEN RESENTMENT" right → 116px  (was 168, RESENTMENT=10 chars)
      "COLLECTIVE HALLUCINATION" left → 93px (HALLUCINATION=12 chars)
      "THE GREAT LIE"    left   → 168px  (GREAT=5 chars, fits fine)
      "SYSTEMIC FRAUD"   full   → 168px  (SYSTEMIC=8 chars, 1000px container)
    """
    # Conservative usable container widths per layout (px).
    # Uses the NARROWEST scene margins within each layout family so the
    # calculated size is safe for every scene type that can use that layout.
    #   left:   truth/left  worst case — left+20px, right+60px → 840px usable
    #   right:  insight/right           — left+100px, right+20px → 800px usable
    #   center: truth/center            — left=80px, right=80px → 840px usable
    #   full:   all full-bleed scenes   — left=40px, right=40px → 1000px usable
    CONTAINER_PX = {
        'left':   840,
        'right':  800,
        'center': 840,
        'full':  1000,
    }
    # Scene-default maximum sizes — matches _base.html --sz-hero / --sz-stat
    SCENE_MAX_PX = {
        'hook':    168, 'truth':   168, 'climax':  168,
        'flip':    168, 'payoff':  168, 'tension': 104,
        'insight': 104, 'cta':     104,
    }
    CHAR_RATIO = 0.62   # effective width per em (bold, -0.055em letter-spacing)
    SAFETY     = 0.90   # 10% breathing room so chars never crowd the edge
    MIN_PX     = 56     # floor — below this text becomes unreadable

    container = CONTAINER_PX.get(layout, 840) * SAFETY
    max_sz    = SCENE_MAX_PX.get(scene, 168)
    longest   = max(keyword.split(), key=len)
    max_font  = container / (len(longest) * CHAR_RATIO)

    return max(MIN_PX, min(max_sz, int(max_font)))
# ▲▲▲ END NEW: DYNAMIC KEYWORD FONT SIZE ▲▲▲


def _build_beat_contracts(
    beats: list,
    beat_durations_ms: list = None,
    style: str = "",
    camera_style: str = "",
) -> list:
    """
    Build the per-beat contracts the renderer consumes.

    Each contract gets cinematic defaults applied — but any field the
    caller (LLM / script) explicitly provided wins. Defaults only fill
    blanks. This is what prevents the renderer from producing stiff
    repetitive output when beat JSON is sparse.
    """
    total = len(beats)
    contracts = []

    for i, beat in enumerate(beats):
        scene  = _beat_scene(beat, i, total)
        layout = beat.get("layout")    or _layout_for(scene, i, style)
        camera = beat.get("camera")    or _camera_for(scene, i)
        pace   = beat.get("pace")      or _SCENE_PACE.get(scene, "mid")
        emo    = beat.get("emotion")   or _SCENE_EMOTION.get(scene, "")
        bg     = beat.get("background") or _background_for(scene, i)

        contract = {
            "id":              beat.get("id", i),
            "scene":           scene,
            "hud_tag":         _beat_hud(beat, i, total),
            "keyword":         beat["keyword"],
            "body":            beat["text"],
            "duration_ms":     beat_durations_ms[i] if beat_durations_ms else 5000,
            "accent_override": "spike" if beat.get("type", "") == "climax" else None,
            "beat_index":      i + 1,
            "beat_total":      total,

            # Cinematic fields — defaults applied above
            "layout":          layout,
            "camera":          camera,
            "pace":            pace,
            "emotion":         emo,
            "background":      bg,
            "visual_intent":   beat.get("visual_intent", ""),
            "visual_query":    beat.get("visual_query", ""),
            "composition":     beat.get("composition") or None,
            "pattern_interrupt": beat.get("pattern_interrupt") or None,
            "intensity":       beat["intensity"] if isinstance(beat.get("intensity"), (int, float)) else None,
            "camera_style":    camera_style,

            # Transition set after we know prev contract (below)
            "transition":      beat.get("transition", ""),

            # entry_vector inherited from previous beat's exit
            "entry_vector":    {"x": 0, "y": 0, "scale": 1.0},

            # ▼▼▼ NEW: keyword font size — prevents mid-word breaks on long words ▼▼▼
            # Calculated from the longest word in the keyword vs the container
            # width for this layout. capture.js injects --sz-kw into :root and
            # applies [class$="-kw"] { font-size: var(--sz-kw) !important; }
            # covering hook-kw, truth-kw, climax-kw, insight-kw, flip-kw, etc.
            "sz_kw":           _calc_kw_font_size(beat["keyword"], layout, scene),
            # ▲▲▲ END NEW ▲▲▲
        }
        contracts.append(contract)

    # ── Inter-beat passes: transition + entry_vector handoff ──────────
    for i in range(len(contracts)):
        prev = contracts[i - 1] if i > 0 else None

        if not contracts[i]["transition"]:
            contracts[i]["transition"] = _transition_for(prev, contracts[i], i) if prev else "cut"

        if prev is not None:
            contracts[i]["entry_vector"] = _exit_vector(prev["camera"])

    for i, c in enumerate(contracts):
        c["intensity"] = c.get("intensity") or _intensity_for(c["scene"], i, len(contracts))
    _assign_interrupts(contracts)
    _pick_composition_mutator(contracts)

    return contracts


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def render_slides(
    script:            dict,
    out_dir:           pathlib.Path,
    cfg:               dict,
    beat_durations_ms: list = None,
) -> list[pathlib.Path]:
    """
    Render all beats via Node/Playwright and return a list of frame directories.

    Returns: (beat_dirs, frames_dir)

    Requires renderer/capture.js to exist (run `npm install` in renderer/).
    """
    renderer_dir = pathlib.Path(__file__).parent.parent / "renderer"
    capture_js   = renderer_dir / "capture.js"
    if not capture_js.exists():
        raise FileNotFoundError(
            f"[visuals] renderer/capture.js not found at {renderer_dir}\n"
            f"Run: cd renderer && npm install && npx playwright install chromium"
        )

    script_style = script.get("style", "contrarian")
    global_theme = script.get("global", {}).get("theme", "")
    theme        = _style_to_theme(global_theme or script_style)
    pal          = _THEME_PALETTES.get(theme, _THEME_PALETTES["tech_blue"])

    global_cam_style = (script.get("global", {}) or {}).get("camera_style", "")

    beats_contracts = _build_beat_contracts(
        script["beats"],
        beat_durations_ms,
        style=script_style,
        camera_style=global_cam_style,
    )

    scene_json = {
        "video_id": out_dir.name,
        "theme":    theme,
        "layout":   beats_contracts[0]["layout"] if beats_contracts else "left",
        "fps":      cfg["video"]["fps"],
        "width":    cfg["video"]["width"],
        "height":   cfg["video"]["height"],
        "palette": {
            "accent": pal["accent"],
            "spike":  pal["spike"],
            "bg":     pal["bg"],
            "fg":     pal["fg"],
        },
        "brand":  cfg["brand"]["name"],
        "beats":  beats_contracts,
    }

    scene_path = out_dir / "scene.json"
    scene_path.write_text(json.dumps(scene_json, indent=2), encoding="utf-8")

    frames_dir = out_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    def _abs(p: pathlib.Path) -> str:
        return str(p.resolve()).replace("\\", "/")

    project_root = pathlib.Path(__file__).parent.parent.resolve()
    env = _load_dotenv({**os.environ, "PROJECT_ROOT": str(project_root)})

    cmd = [
        "node", str(capture_js),
        "--scene", _abs(scene_path),
        "--out",   _abs(frames_dir),
        "--fps",   str(cfg["video"]["fps"]),
        "--concurrency", str(cfg.get("render", {}).get("concurrency", 2)),
    ]

    print("[visuals] Running HTML renderer (Playwright)...")
    result = subprocess.run(cmd, cwd=str(renderer_dir), env=env,
                            capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr)
    if result.returncode != 0:
        raise RuntimeError(
            f"[visuals] HTML renderer failed (exit {result.returncode}):\n"
            f"{result.stderr[-3000:]}"
        )

    beat_dirs = sorted(frames_dir.glob("beat_*"))
    if not beat_dirs:
        raise RuntimeError(
            f"[visuals] Renderer exited cleanly but no beat_* dirs found in {frames_dir}"
        )
    print(f"[visuals] HTML render done — {len(beat_dirs)} beat dirs")
    return beat_dirs, frames_dir
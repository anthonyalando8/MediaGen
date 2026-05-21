"""
visuals.py  --  Visual renderer (HTML/Playwright only)

Calls the Node/Playwright renderer (renderer/capture.js) to produce
per-beat frame directories used by assemble.py.

Requires:
  cd renderer && npm install && npx playwright install chromium
"""

import pathlib
import subprocess
import json
import os

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


def _style_to_layout(style: str) -> str:
    mapping = {
        "contrarian": "left",
        "builder":    "left",
        "calm":       "center",
        "analytical": "center",
        "cinematic":  "right",
        "intense":    "full",
        "humorous":   "center",
    }
    return mapping.get(style.lower() if style else "", "left")


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


def _build_beat_contracts(beats: list, beat_durations_ms: list = None) -> list:
    total = len(beats)
    contracts = []
    for i, beat in enumerate(beats):
        contract = {
            "id":              beat.get("id", i),
            "scene":           _beat_scene(beat, i, total),
            "hud_tag":         _beat_hud(beat, i, total),
            "keyword":         beat["keyword"],
            "body":            beat["text"],
            "duration_ms":     beat_durations_ms[i] if beat_durations_ms else 5000,
            "accent_override": "spike" if beat.get("type", "") == "climax" else None,
            # Beat position for HUD counter (1-based display)
            "beat_index":      i + 1,
            "beat_total":      total,
            # Per-beat cinematic fields forwarded to the renderer
            "emotion":         beat.get("emotion", ""),
            "pace":            beat.get("pace", "mid"),
            "visual_intent":   beat.get("visual_intent", ""),
            "camera":          beat.get("camera", "static"),
            "transition":      beat.get("transition", "cut"),
            "background":      beat.get("background", "solid"),
            # Background image search query — used by capture.js to fetch
            # a contextual blurred image from Unsplash (empty = no image)
            "visual_query":    beat.get("visual_query", ""),
        }
        contracts.append(contract)
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
    Each directory contains frame_00000.png … frame_NNNNN.png for one beat.
    Also returns the parent frames_dir path so the caller can clean it up.

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
    layout       = _style_to_layout(script_style)
    global_theme = script.get("global", {}).get("theme", "")
    theme        = _style_to_theme(global_theme or script_style)
    pal          = _THEME_PALETTES.get(theme, _THEME_PALETTES["tech_blue"])

    beats_contracts = _build_beat_contracts(script["beats"], beat_durations_ms)
    for beat in beats_contracts:
        beat["layout"] = layout

    scene_json = {
        "video_id": out_dir.name,
        "theme":    theme,
        "layout":   layout,
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
    #env = {**os.environ, "PROJECT_ROOT": str(project_root)}
    env = _load_dotenv({**os.environ, "PROJECT_ROOT": str(project_root)})

    cmd = [
        "node", str(capture_js),
        "--scene", _abs(scene_path),
        "--out",   _abs(frames_dir),
        "--fps",   str(cfg["video"]["fps"]),
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
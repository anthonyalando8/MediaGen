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


# ---------------------------------------------------------------------------
# Beat contract helpers
# ---------------------------------------------------------------------------

def _beat_scene(beat: dict, i: int, total: int) -> str:
    """
    Map beat type + position to HTML scene template.

      - type == "hook"  or first beat  -> "hook"
      - type == "cta"   or last beat   -> "cta"
      - type == "climax" or high-energy second-to-last -> "climax"
      - everything else                -> "insight"
    """
    t = beat.get("type", "insight").lower()
    if i == 0:
        return "hook"
    if i == total - 1:
        return "cta"
    if t == "climax" or (t != "hook" and beat.get("energy", "") == "high" and i == total - 2):
        return "climax"
    if t == "cta":
        return "cta"
    return "insight"


def _beat_hud(beat: dict, i: int, total: int) -> str:
    """Derive HUD label from beat type."""
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
    """
    Map script style to composition layout.
      left    contrarian, builder       (left-anchored editorial)
      center  calm, analytical          (centered, considered)
      right   cinematic                 (reversed anchor, cinematic)
      full    intense                   (full-bleed, no margins)
    """
    mapping = {
        "contrarian": "left",
        "builder":    "left",
        "calm":       "center",
        "analytical": "center",
        "cinematic":  "right",
        "intense":    "full",
    }
    return mapping.get(style.lower() if style else "", "left")


def _style_to_theme(style: str) -> str:
    """Map script style to CSS theme file."""
    mapping = {
        "contrarian": "tech_blue",
        "builder":    "tech_blue",
        "calm":       "editorial_white",
        "analytical": "editorial_white",
        "cinematic":  "warm_amber",
        "intense":    "cyber_noir",
    }
    return mapping.get(style.lower() if style else "", "tech_blue")


_THEME_PALETTES = {
    "tech_blue":       {"accent": "#4ab0f5", "spike": "#f0884a", "bg": "#09090b", "fg": "#efefed"},
    "editorial_white": {"accent": "#e8e0d0", "spike": "#c8a882", "bg": "#09090b", "fg": "#efefed"},
    "warm_amber":      {"accent": "#f0a84a", "spike": "#70c8f0", "bg": "#09090b", "fg": "#efefed"},
    "cyber_noir":      {"accent": "#a870f0", "spike": "#70f0a0", "bg": "#060608", "fg": "#efefed"},
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
            # Per-beat cinematic fields forwarded to the renderer
            "emotion":         beat.get("emotion", ""),
            "pace":            beat.get("pace", "mid"),
            "visual_intent":   beat.get("visual_intent", ""),
            "camera":          beat.get("camera", "static"),
            "transition":      beat.get("transition", "cut"),
            "background":      beat.get("background", "solid"),
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
    theme        = _style_to_theme(script_style)
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
    env = {**os.environ, "PROJECT_ROOT": str(project_root)}

    cmd = [
        "node", str(capture_js),
        "--scene", _abs(scene_path),
        "--out",   _abs(frames_dir),
        "--fps",   str(cfg["video"]["fps"]),
    ]

    print("[visuals] Running HTML renderer (Playwright)...")
    result = subprocess.run(cmd, cwd=str(renderer_dir), env=env,
                            capture_output=True, text=True)
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
    return beat_dirs
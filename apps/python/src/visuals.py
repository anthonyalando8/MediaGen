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

from visuals_dir.visuals_calc_word_width import calc_kw_font_size
from formats import VisualProfile

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


def _beat_hud(beat: dict, i: int, total: int, hud_mode: str = "auto") -> str:
    if hud_mode == "none":
        return ""  # falsy → scene-import.ts's `if (beat.hud_tag)` already skips rendering it
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


def _camera_for(scene: str, i: int, energy: str = "normal") -> str:
    if energy == "low":
        return "static"  # calm genres: always subdued, no per-scene kinetic table
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

def _intensity_for(scene: str, i: int, total: int, curve: str = "normal") -> float:
    if scene in _SCENE_INTENSITY:
        base = _SCENE_INTENSITY[scene]
    else:
        progress = i / max(1, total - 1)
        base = 0.55 + 0.40 * progress

    progress = i / max(1, total - 1)
    if 0.25 < progress < 0.40 and scene in {"insight", "truth"}:
        base *= 0.65

    # Genre reshape — "normal" is the identity (today's exact values).
    if curve == "flat":
        base = base * 0.55 + 0.15   # compress toward a calmer mid-band; nothing maxes out
    elif curve == "spiky":
        base = 0.5 + (base - 0.5) * 1.3   # exaggerate contrast around the midpoint

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

def _pick_composition_mutator(contracts: list, looseness: float = 0.0) -> None:
    """Mark `count` beats with a composition mutator, spread evenly across the
    eligible ones. `count = max(1, round(looseness * len(eligible)))` — a
    looseness of 0.0 (the default) always yields exactly 1, identical to the
    original single-mutator-per-video behavior. Higher looseness marks more
    beats, per the fix plan's "break the grid" knob (§04)."""
    eligible = [
        i for i, c in enumerate(contracts)
        if c["scene"] in _MUTATABLE_SCENES and not c.get("composition")
    ]
    if not eligible:
        return
    count = max(1, round(looseness * len(eligible)))
    count = min(count, len(eligible))
    if count == 1:
        # Exact original formula — byte-for-byte identical at looseness=0.0.
        idx = eligible[len(contracts) % len(eligible)]
        mut = _MUTATORS[len(contracts) % len(_MUTATORS)]
        contracts[idx]["composition"] = mut
        return
    step = len(eligible) / count
    for n in range(count):
        idx = eligible[int(n * step)]
        mut = _MUTATORS[(len(contracts) + n) % len(_MUTATORS)]
        contracts[idx]["composition"] = mut


def _build_beat_contracts(
    beats: list,
    beat_durations_ms: list = None,
    style: str = "",
    camera_style: str = "",
    profile: VisualProfile | None = None,
) -> list:
    """
    Build the per-beat contracts the renderer consumes.

    Each contract gets cinematic defaults applied — but any field the
    caller (LLM / script) explicitly provided wins. Defaults only fill
    blanks. This is what prevents the renderer from producing stiff
    repetitive output when beat JSON is sparse.

    `profile` (formats.VisualProfile) is the genre's say over those
    defaults — HUD, camera energy, intensity curve, looseness. Omitting it
    (None) reproduces the exact pre-profile behavior via VisualProfile()'s
    defaults.
    """
    profile = profile or VisualProfile()
    total = len(beats)
    contracts = []

    for i, beat in enumerate(beats):
        scene  = _beat_scene(beat, i, total)
        layout = beat.get("layout")    or _layout_for(scene, i, style)
        camera = beat.get("camera")    or _camera_for(scene, i, profile.camera_energy)
        pace   = beat.get("pace")      or _SCENE_PACE.get(scene, "mid")
        emo    = beat.get("emotion")   or _SCENE_EMOTION.get(scene, "")
        bg     = beat.get("background") or _background_for(scene, i)

        contract = {
            "id":              beat.get("id", i),
            "scene":           scene,
            "hud_tag":         _beat_hud(beat, i, total, profile.hud),
            "keyword":         beat["keyword"],
            "body":            beat.get("text", ""),  # absent for a `silent: true` beat (tts.py)
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
            # scene/3.0: which composition family this beat belongs to. Every
            # beat defaults to "text_over_dimmed" (see llm.py's
            # _normalise_schema) — today's only archetype, so this is a
            # passthrough that doesn't change behavior on its own. Downstream
            # (scene_export.py) uses it to decide whether to synthesize a
            # `layers[]` breakdown for the beat.
            "archetype":       beat.get("archetype", "text_over_dimmed"),
            # scene/3.0 (phase 5): which SECTION this beat came from, and
            # that section's pacing_arc (build|steady|rise_fall|wind_down) —
            # see llm.py's _flatten_sections. Absent for every format that
            # emits flat beats[] directly (i.e. everything except a
            # sections-based long-form format). Forward-compat metadata only
            # — nothing downstream reads it yet.
            "section_id":      beat.get("section_id"),
            "pacing_arc":      beat.get("pacing_arc"),
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
            "sz_kw":           calc_kw_font_size(beat["keyword"], layout, scene),
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
        c["intensity"] = c.get("intensity") or _intensity_for(c["scene"], i, len(contracts), profile.intensity_curve)
    _assign_interrupts(contracts)
    _pick_composition_mutator(contracts, profile.looseness)

    return contracts

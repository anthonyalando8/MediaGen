"""
formats.py  —  video-format registry (recipes).

A "format" is a drop-in folder under prompts/formats/<id>/ that bundles the
three things that used to be hardcoded for the single TikTok script:

  • the LLM prompt         — prompt.txt inside the folder, OR a `prompt_path`
                             in format.yaml pointing at a file relative to the
                             prompts root (so the existing prompts/script.txt
                             stays the single source of truth for shortform).
  • a validation profile   — beat/word gates + optional cinematic-variety gates
                             (replaces the module-level constants in llm.py).
  • display metadata       — label + description the editor shows in its picker.

DESIGN NOTE
-----------
The pipeline NEVER branches on format — it loads the recipe and runs, exactly
like NodeKindRegistry.get(kind) on the editor side. Adding a new kind of video
is "drop a folder"; no code change.

The scene/2.0 contract is the invariant: every format still emits the same beat
schema that scene_export / visuals / scene-import consume downstream. A format
varies the *authoring* (prompt) and the *validation* (profile), never the
output shape.
"""
from __future__ import annotations

import pathlib
from dataclasses import dataclass, field

import yaml

DEFAULT_FORMAT = "shortform_tiktok"


# ─────────────────────────────────────────────────────────────────────────────
# Validation profile — the gates, as data (was: constants + hardcoded checks)
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class ValidationProfile:
    beats_min: int = 4
    beats_max: int = 8
    words_per_beat_min: int = 15
    words_per_beat_max: int = 30
    total_words_min: int | None = None   # None → derived: beats * words_per_beat_min
    total_words_max: int | None = None
    require_emphasis: bool = False        # enforce one *emphasis* per beat text
    # Empty dict → cinematic-variety gates DISABLED for this format (e.g. calm).
    # Keys: min_cameras / min_paces / min_layouts / min_backgrounds
    #       max_consecutive_camera / max_consecutive_layout
    variety: dict = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Genre profile — the FEEL, as data (was: format-blind tts.py/visuals.py
# reading only the LLM's own per-beat fields + module-level constant tables).
# Every field below defaults to a value that reproduces today's exact
# behavior when a format.yaml doesn't declare the corresponding section —
# see the docstrings in tts.py/visuals.py for exactly how each is consumed.
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class VoiceProfile:
    style: str = ""                # forces tts.py's voice_style lookup; "" = today's LLM-driven behavior
    pace_map: dict = field(default_factory=dict)   # {"hook": "fast", "cta": "explosive"} — forces per-scene pace


@dataclass
class VisualProfile:
    # ── HUD ──────────────────────────────────────────────────────────────
    # DEFAULT CHANGED: "none". The "// HOOK" / "// TRUTH" / "// FLIP" chip is
    # the composer's own rhetorical enum printed on the frame — internal
    # vocabulary, not viewer information, and meaningless-to-wrong on any
    # non-explainer format. A format that genuinely wants it (tech_hud,
    # documentary looks) sets `visuals: {hud: auto}` to get the old mapping.
    hud: str = "none"              # "none" (default) | "auto" (per-type // chip)
    theme: str = ""                # forces the theme id; "" = today's _style_to_theme() computation
    camera_energy: str = "normal"  # "normal"/"high" = today's per-scene table unchanged | "low" = force static
    intensity_curve: str = "normal"  # "normal" = today's formula unchanged | "flat" | "spiky"
    looseness: float = 0.0         # scales composition-mutator count; 0.0 reproduces today's "always exactly 1"
    texture: str = "none"          # parsed + stored only — no consumer yet, forward-compat with the fix plan's §04

    # ── Pattern-interrupt distribution (visuals.py::_assign_interrupts) ──
    # The auto-assign pass used to stamp an interrupt on EVERY beat over the
    # gate with no adjacency rule and no whole-video cap, so a rising-intensity
    # script strobed for 4-5 beats straight. Both are enforced now, and both
    # are per-format knobs because the right budget depends on the genre.
    interrupt_threshold: float = 0.80   # minimum intensity for an auto-assigned interrupt
    interrupt_max: int = 3              # whole-video budget; 0 = none, -1 = module default

    # ── Peak-effect budget (visuals.py::_budget_peak_effects) ────────────
    # Max number of maximal choices — hard transition, pattern interrupt,
    # extreme camera — allowed to land on ONE beat. 0 disables the pass.
    peak_budget: int = 2


@dataclass
class MediaPlan:
    mode: str = "auto"             # image|video|hybrid|auto — parsed + stored only, consumed in a later phase
    background: str = "auto"
    mood: list = field(default_factory=list)
    allow_illustration: bool = True
    orientation: str = "portrait"  # portrait|landscape|square — target delivery aspect for stock lookups


@dataclass
class Format:
    id: str
    label: str
    description: str
    prompt: str
    profile: ValidationProfile
    voice: VoiceProfile = field(default_factory=VoiceProfile)
    visuals: VisualProfile = field(default_factory=VisualProfile)
    media: MediaPlan = field(default_factory=MediaPlan)
    default_resolve_visuals: bool = True


# ─────────────────────────────────────────────────────────────────────────────
# Loading
# ─────────────────────────────────────────────────────────────────────────────
def _formats_root(prompts_root: str | pathlib.Path) -> pathlib.Path:
    return pathlib.Path(prompts_root) / "formats"


def _load_meta(folder: pathlib.Path) -> dict:
    f = folder / "format.yaml"
    if not f.exists():
        raise FileNotFoundError(f"format.yaml missing in {folder}")
    return yaml.safe_load(f.read_text(encoding="utf-8")) or {}


def _profile_from(meta: dict) -> ValidationProfile:
    beats = meta.get("beats") or {}
    wpb = meta.get("words_per_beat") or {}
    total = meta.get("total_words") or {}
    p = ValidationProfile()
    p.beats_min = int(beats.get("min", p.beats_min))
    p.beats_max = int(beats.get("max", p.beats_max))
    p.words_per_beat_min = int(wpb.get("min", p.words_per_beat_min))
    p.words_per_beat_max = int(wpb.get("max", p.words_per_beat_max))
    p.total_words_min = total.get("min")
    p.total_words_max = total.get("max")
    p.require_emphasis = bool(meta.get("require_emphasis", False))
    p.variety = meta.get("variety") or {}
    return p


def _voice_profile_from(meta: dict) -> VoiceProfile:
    v = meta.get("voice") or {}
    return VoiceProfile(
        style=str(v.get("style", "")),
        pace_map=dict(v.get("pace_map") or {}),
    )


def _visual_profile_from(meta: dict) -> VisualProfile:
    v = meta.get("visuals") or {}
    return VisualProfile(
        hud=str(v.get("hud", "none")),
        theme=str(v.get("theme", "")),
        camera_energy=str(v.get("camera_energy", "normal")),
        intensity_curve=str(v.get("intensity_curve", "normal")),
        looseness=float(v.get("looseness", 0.0)),
        texture=str(v.get("texture", "none")),
        interrupt_threshold=float(v.get("interrupt_threshold", 0.80)),
        interrupt_max=int(v.get("interrupt_max", 3)),
        peak_budget=int(v.get("peak_budget", 2)),
    )


def _media_plan_from(meta: dict) -> MediaPlan:
    m = meta.get("media") or {}
    return MediaPlan(
        mode=str(m.get("mode", "auto")),
        background=str(m.get("background", "auto")),
        mood=list(m.get("mood") or []),
        allow_illustration=bool(m.get("allow_illustration", True)),
        orientation=str(m.get("orientation", "portrait")),
    )


def _resolve_prompt(prompts_root, folder: pathlib.Path, meta: dict) -> str:
    inline = folder / "prompt.txt"
    if inline.exists():
        return inline.read_text(encoding="utf-8")
    rel = meta.get("prompt_path")
    if rel:
        p = (pathlib.Path(prompts_root) / rel).resolve()
        if p.exists():
            return p.read_text(encoding="utf-8")
    raise FileNotFoundError(
        f"No prompt for format '{folder.name}': add prompt.txt to the folder "
        f"or set prompt_path in format.yaml."
    )


def load_format(prompts_root, format_id: str | None) -> Format:
    """Load one format recipe. Falls back to DEFAULT_FORMAT for empty/None id."""
    format_id = (format_id or DEFAULT_FORMAT).strip() or DEFAULT_FORMAT
    folder = _formats_root(prompts_root) / format_id
    if not folder.is_dir():
        available = [d.name for d in sorted(_formats_root(prompts_root).glob("*")) if d.is_dir()]
        raise FileNotFoundError(f"Unknown format '{format_id}'. Available: {available}")
    meta = _load_meta(folder)
    return Format(
        id=format_id,
        label=meta.get("label", format_id),
        description=meta.get("description", ""),
        prompt=_resolve_prompt(prompts_root, folder, meta),
        profile=_profile_from(meta),
        voice=_voice_profile_from(meta),
        visuals=_visual_profile_from(meta),
        media=_media_plan_from(meta),
        default_resolve_visuals=bool(meta.get("default_resolve_visuals", True)),
    )


def _summarize(voice: VoiceProfile, visuals: VisualProfile, media: MediaPlan) -> dict:
    """Short, derived-not-hardcoded description of what a format's profile
    actually does — shown in the editor's genre picker. Reads the same
    fields that drive generation, so it can't drift out of sync with them."""
    voice_text = voice.style or "LLM-driven"

    motion_bits = []
    # HUD is off by default now, so the picker should call out the OPT-IN.
    if visuals.hud == "auto":
        motion_bits.append("HUD chips")
    if visuals.camera_energy == "low":
        motion_bits.append("static camera")
    if visuals.intensity_curve != "normal":
        motion_bits.append(f"{visuals.intensity_curve} intensity")
    if visuals.interrupt_max == 0:
        motion_bits.append("no interrupts")
    motion_text = ", ".join(motion_bits) if motion_bits else "kinetic"

    return {"voice": voice_text, "motion": motion_text, "media": media.mode}


def list_formats(prompts_root) -> list[dict]:
    """Scan prompts/formats/* and return picker metadata. DEFAULT_FORMAT first."""
    root = _formats_root(prompts_root)
    if not root.is_dir():
        return []
    out: list[dict] = []
    for folder in sorted(root.glob("*")):
        if not folder.is_dir():
            continue
        try:
            meta = _load_meta(folder)
        except Exception:
            continue  # a malformed folder shouldn't break the whole list
        out.append({
            "id": folder.name,
            "label": meta.get("label", folder.name),
            "description": meta.get("description", ""),
            "default_resolve_visuals": bool(meta.get("default_resolve_visuals", True)),
            "profile_summary": _summarize(
                _voice_profile_from(meta), _visual_profile_from(meta), _media_plan_from(meta),
            ),
        })
    out.sort(key=lambda m: (m["id"] != DEFAULT_FORMAT, m["label"].lower()))
    return out

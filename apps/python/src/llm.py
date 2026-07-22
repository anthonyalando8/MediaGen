"""
llm.py  --  Script generation via Ollama.

Calls the local Ollama CLI, parses the JSON response, retries up to 3 times on
bad output, validates beat structure AND cinematic-field variety so the renderer
gets motion-rich data.

────────────────────────────────────────────────────────────────────
FORMAT-DRIVEN VALIDATION (what changed)
────────────────────────────────────────────────────────────────────
`generate_script` now takes a `Format` (see formats.py) instead of a raw prompt
path. The prompt comes from the format; the numeric/variety GATES come from the
format's `ValidationProfile`. The old hardcoded thresholds (4-8 beats, 15-25
words, ≥3 cameras, no 3-in-a-row…) are now just the `shortform_tiktok` profile.

The CINEMATIC VOCABULARY below (`_ALLOWED`, `_DEFAULTS_BY_TYPE`,
`_TRANSITION_BY_TYPE`) is NOT format-specific — it defines the scene/2.0
contract every format must normalise toward, so it stays shared here.
"""

import subprocess
import pathlib
import json
import re
import sys
from llm_fix_duplicates import fix_duplicate_word_fragments

# ─────────────────────────────────────────────────────────────────────────────
# Cinematic vocabulary — must match renderer/inject.js + scenes contracts.
# Contract-level (shared across all formats), NOT a per-format gate.
# ─────────────────────────────────────────────────────────────────────────────

_ALLOWED = {
    "camera":        {"static", "push_in", "pull_out", "handheld", "snap_zoom", "micro_shake", "tilt_up"},
    "pace":          {"slow", "mid", "fast", "explosive"},
    "transition":    {"cut", "slam_cut", "blur_wipe", "flash", "fade", "dip_black", "whip_pan"},
    "background":    {"solid", "gradient", "noise", "grid", "glow", "lines", "abstract"},
    "layout":        {"left", "center", "right", "full"},
    "emotion":       {"urgent", "tense", "hopeful", "melancholic", "angry", "cold",
                      "confident", "anxious", "serious", "playful", "amused", "surprised"},
    "visual_intent": {"confrontational", "mysterious", "clean", "chaotic", "cinematic",
                      "minimal", "aggressive", "documentary", "absurd", "quirky"},
    "energy":        {"high", "mid", "low"},
    "type":          {"hook", "insight", "tension", "truth", "flip", "climax", "payoff", "cta"},
    "pattern_interrupt": {"", "slam", "chroma", "iris", "tilt", "flash", "freeze", "invert"},
    "composition":       {"", "crop-low", "tilt", "corner", "sparse"},
}

# Per-scene-type cinematic defaults — used when LLM omits a field or supplies
# an out-of-vocabulary value. Mirrors visuals.py defaults so behaviour is
# consistent whether the field is filled here or downstream.
_DEFAULTS_BY_TYPE = {
    "hook":    {"camera": "push_in",     "pace": "fast",      "emotion": "confident", "background": "glow",     "layout": "left"},
    "insight": {"camera": "static",      "pace": "mid",       "emotion": "serious",   "background": "solid",    "layout": "left"},
    "climax":  {"camera": "snap_zoom",   "pace": "explosive", "emotion": "urgent",    "background": "abstract", "layout": "full"},
    "tension": {"camera": "tilt_up",     "pace": "slow",      "emotion": "tense",     "background": "lines",    "layout": "left"},
    "truth":   {"camera": "static",      "pace": "mid",       "emotion": "confident", "background": "gradient", "layout": "center"},
    "flip":    {"camera": "micro_shake", "pace": "fast",      "emotion": "anxious",   "background": "noise",    "layout": "right"},
    "payoff":  {"camera": "pull_out",    "pace": "slow",      "emotion": "hopeful",   "background": "glow",     "layout": "center"},
    "cta":     {"camera": "push_in",     "pace": "fast",      "emotion": "urgent",    "background": "solid",    "layout": "center"},
}

_TRANSITION_BY_TYPE = {
    "hook": "slam_cut", "climax": "slam_cut", "tension": "dip_black",
    "payoff": "fade",   "flip":   "flash",    "cta":     "dip_black",
    "truth": "cut",     "insight": "cut",
}


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def generate_script(topic: str, fmt, model: str) -> dict:
    """
    Generate a structured script via Ollama for the given format.

    `fmt` is a formats.Format (prompt + validation profile). Retries up to 3
    times on bad output OR profile-gate failure.
    """
    prompt = fmt.prompt.format(topic=topic)
    profile = fmt.profile
    raw = ""

    for attempt in range(1, 4):
        print(f"[llm] Generating script (format={fmt.id}, attempt {attempt}/3)…")
        try:
            raw = subprocess.check_output(
                ["ollama", "run", model, prompt],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=180,   # hard guard: a wedged model call fails → retry, not hang
            )
            data = _parse_json(raw.strip())
            _validate(data, profile)
            print(f"[llm] ✓ Script OK — \"{data['title']}\"")
            _print_cinematic_summary(data)
            return data
        except Exception as e:
            print(f"[llm]   ✗ attempt {attempt} failed: {e}", file=sys.stderr)

    raise RuntimeError(
        f"[llm] Could not get valid JSON from model after 3 attempts.\n"
        f"Last raw output (first 600 chars):\n{raw[:600]}"
    )


# ---------------------------------------------------------------------------
# Internals — text cleanup
# ---------------------------------------------------------------------------

def _strip_ansi(s: str) -> str:
    """Remove ANSI/VT100 escape sequences that Ollama CLI emits during streaming."""
    s = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", s)
    s = re.sub(r"\x1b[O][A-Za-z]", "", s)
    s = re.sub(r"\x1b.", "", s)
    return s


def _fix_mojibake(text: str) -> str:
    """Fix UTF-8 characters that were misread as Latin-1 by Ollama output handling."""
    replacements = [
        ("â€“", "—"),
        ("â€˜", "‘"),
        ("â€™", "’"),
        ("â€œ", "“"),
        ("â€",  "”"),
        ("â€¦", "…"),
    ]
    for bad, good in replacements:
        text = text.replace(bad, good)
    return text


def _clean_beat_texts(data: dict) -> dict:
    """Fix encoding artifacts and duplicate word fragments in all beat text fields."""
    for beat in data.get("beats", []):
        if "text" in beat:
            beat["text"] = _fix_mojibake(beat["text"])
            beat["text"] = fix_duplicate_word_fragments(beat["text"])
    return data


# ---------------------------------------------------------------------------
# Internals — schema normalisation & cinematic-field fill-in
# ---------------------------------------------------------------------------

def _normalise_schema(data: dict) -> dict:
    """
    Normalise old schema (id int, hook bool) to new schema (type, energy),
    AND fill in missing cinematic fields with scene-type defaults so the
    contract is complete before validation runs.

    Format-agnostic: this brings ANY format's beats up to the scene/2.0
    contract, defaulting whatever a looser format chose to omit.
    """
    beats = data.get("beats", [])
    total = len(beats)

    for i, beat in enumerate(beats):
        # derive `type` from hook/position if absent
        if "type" not in beat:
            if beat.get("hook") is True or i == 0:
                beat["type"] = "hook"
            elif i == total - 1:
                beat["type"] = "cta"
            else:
                beat["type"] = "insight"

        # default energy from hook flag or position
        if "energy" not in beat:
            beat["energy"] = "high" if (beat.get("hook") or i == 0) else "mid"

        # clean up legacy fields
        if isinstance(beat.get("id"), int):
            beat.pop("id")
        beat.pop("hook", None)

        # ── Cinematic field fill-in ──────────────────────────────────
        # If the LLM emitted an unknown or missing value, fall back to
        # the scene-type default. This guarantees the contract is valid
        # without us silently losing information.
        beat_type = beat.get("type", "insight")
        defaults  = _DEFAULTS_BY_TYPE.get(beat_type, _DEFAULTS_BY_TYPE["insight"])

        for field, default in defaults.items():
            val = beat.get(field)
            if not val or val not in _ALLOWED[field]:
                beat[field] = default

        # transition default by scene type if missing/invalid
        if beat.get("transition") not in _ALLOWED["transition"]:
            beat["transition"] = _TRANSITION_BY_TYPE.get(beat_type, "cut")

        # visual_intent: keep if valid, else mild default
        if beat.get("visual_intent") not in _ALLOWED["visual_intent"]:
            beat["visual_intent"] = "cinematic"

        # visual_query is creative — keep whatever the LLM provided (or empty)
        beat.setdefault("visual_query", "")

        val = beat.get("intensity")
        if not isinstance(val, (int, float)) or not (0.0 <= val <= 1.0):
            beat.pop("intensity", None)

        # Strip unknown pattern_interrupt / composition values
        for field in ("pattern_interrupt", "composition"):
            if beat.get(field) and beat[field] not in _ALLOWED[field]:
                beat[field] = ""   # silently fall back; visuals.py will re-pick

    # top-level optional fields
    data.setdefault("thumbnail", data.get("keyword", ""))
    data.setdefault("style", "analytical")
    return data


# ---------------------------------------------------------------------------
# Internals — JSON extraction
# ---------------------------------------------------------------------------

def _parse_json(raw: str) -> dict:
    """Clean the raw Ollama CLI output and parse JSON from it."""
    cleaned = _strip_ansi(raw)
    cleaned = re.sub(r"```(?:json)?", "", cleaned).strip()

    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in model output")
    blob = match.group(0)
    blob = _sanitize_json_strings(blob)

    data = json.loads(blob)
    data = _clean_beat_texts(data)
    data = _normalise_schema(data)
    return data


def _sanitize_json_strings(s: str) -> str:
    """Replace literal control characters inside JSON string values with a space."""
    result, in_str, escape = [], False, False
    for ch in s:
        if escape:
            result.append(ch); escape = False; continue
        if ch == "\\" and in_str:
            result.append(ch); escape = True; continue
        if ch == '"':
            in_str = not in_str; result.append(ch); continue
        if in_str and ord(ch) < 0x20:
            result.append(" "); continue
        result.append(ch)
    return "".join(result)


# ---------------------------------------------------------------------------
# Internals — validation (profile-driven)
# ---------------------------------------------------------------------------

def _validate(data: dict, profile) -> None:
    """Run all gates for this format's profile. Raises ValueError → triggers retry."""
    _validate_basic(data, profile)
    _validate_cinematic_variety(data["beats"], profile.variety)


def _validate_basic(data: dict, profile) -> None:
    """Schema + word-count gates, thresholds taken from the format profile."""
    if "beats" not in data:
        raise KeyError("Missing key: 'beats'")
    if "title" not in data:
        raise KeyError("Missing key: 'title'")

    beats = data["beats"]
    if not isinstance(beats, list):
        raise ValueError("beats must be a list")

    n = len(beats)
    if not (profile.beats_min <= n <= profile.beats_max):
        raise ValueError(f"Expected {profile.beats_min}-{profile.beats_max} beats, got {n}")

    lo, hi = profile.words_per_beat_min, profile.words_per_beat_max
    for i, beat in enumerate(beats):
        for k in ("keyword", "text"):
            if k not in beat:
                raise KeyError(f"Beat {i} missing key: '{k}'")
        if not beat["text"].strip():
            raise ValueError(f"Beat {i} has empty text")
        beat_words = len(beat["text"].split())
        if not (lo <= beat_words <= hi):
            raise ValueError(f"Beat {i} has {beat_words} words — must be {lo}-{hi} words per beat.")
        if profile.require_emphasis and "*" not in beat["text"]:
            raise ValueError(f"Beat {i} missing an *emphasis* word (format requires one per beat).")

    total_words = sum(len(b["text"].split()) for b in beats)
    min_words = profile.total_words_min if profile.total_words_min is not None else n * lo
    if total_words < min_words:
        raise ValueError(
            f"Script too short: {total_words} words across {n} beats "
            f"(minimum {min_words}). Model must expand."
        )
    if profile.total_words_max is not None and total_words > profile.total_words_max:
        raise ValueError(f"Script too long: {total_words} words (maximum {profile.total_words_max}).")


def _validate_cinematic_variety(beats: list, variety: dict) -> None:
    """
    Reject scripts that would produce stiff renders — but ONLY when the format
    asks for variety. An empty `variety` dict disables these gates entirely
    (e.g. the calm_narrative format, where a steady look is intentional).

    Recognised keys:
      min_cameras / min_paces / min_layouts / min_backgrounds
      max_consecutive_camera / max_consecutive_layout
    """
    if not variety:
        return  # gates disabled for this format
    if len(beats) < 4:
        return  # too short to gate meaningfully

    def _unique(field):
        return {b.get(field) for b in beats}

    min_checks = [
        ("min_cameras",     "camera"),
        ("min_paces",       "pace"),
        ("min_layouts",     "layout"),
        ("min_backgrounds", "background"),
    ]
    for key, field in min_checks:
        need = variety.get(key)
        if need and len(_unique(field)) < need:
            raise ValueError(
                f"Cinematic variety: only {len(_unique(field))} unique {field}(s) "
                f"across {len(beats)} beats — need ≥{need}. Got: {_unique(field)}"
            )

    consec_checks = [
        ("max_consecutive_camera", "camera"),
        ("max_consecutive_layout", "layout"),
    ]
    for key, field in consec_checks:
        limit = variety.get(key)
        if not limit:
            continue
        run = 1
        for i in range(1, len(beats)):
            if beats[i].get(field) == beats[i - 1].get(field):
                run += 1
                if run > limit:
                    raise ValueError(
                        f"Cinematic variety: '{field}' repeated more than {limit} "
                        f"consecutive beats ({beats[i].get(field)} near index {i})."
                    )
            else:
                run = 1


def _print_cinematic_summary(data: dict) -> None:
    """One-line summary so console log shows what variety the LLM picked."""
    beats = data["beats"]
    cams    = ",".join(b.get("camera", "?")[:4]     for b in beats)
    paces   = ",".join(b.get("pace", "?")[:3]       for b in beats)
    layouts = ",".join(b.get("layout", "?")[:3]     for b in beats)
    bgs     = ",".join(b.get("background", "?")[:3] for b in beats)
    print(f"[llm]   cinematic · cam[{cams}] pace[{paces}] lay[{layouts}] bg[{bgs}]")

"""
llm.py  --  Script generation via Ollama.

Calls the local Ollama CLI, parses the JSON response,
retries up to 3 times on bad output, validates beat structure
AND cinematic field variety so the renderer gets motion-rich data.

────────────────────────────────────────────────────────────────────
CINEMATIC VALIDATION — what's new vs the previous version
────────────────────────────────────────────────────────────────────
1. Each cinematic field (camera/pace/emotion/transition/background/
   layout/visual_intent) is validated against an allowed vocabulary.
   Unknown values are mapped to safe defaults instead of silently
   passing through.
2. Variety gates fail validation (and trigger a retry):
     - <3 unique cameras across the script
     - <2 unique paces / layouts / backgrounds
     - same camera or layout for 3+ consecutive beats
3. Missing per-beat fields are filled with scene-type defaults instead
   of dropping through to "static / mid / solid" everywhere.
"""

import subprocess
import pathlib
import json
import re
import sys
from llm_fix_duplicates import _fix_duplicate_word_fragments

# ─────────────────────────────────────────────────────────────────────────────
# Cinematic vocabulary — must match renderer/inject.js + scenes contracts
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
    "pattern_interrupt": {"", "slam", "chroma", "iris", "tilt","flash", "freeze", "invert"},
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
    "truth": "cut",     "insight":"cut",
}


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def generate_script(topic: str, prompt_path: pathlib.Path, model: str) -> dict:
    """
    Generate a structured 4-8 beat script via Ollama.

    Retries up to 3 times on bad output OR cinematic-variety failure.
    """
    template = prompt_path.read_text(encoding="utf-8")
    prompt   = template.format(topic=topic)
    raw      = ""

    for attempt in range(1, 4):
        print(f"[llm] Generating script (attempt {attempt}/3)…")
        try:
            raw = subprocess.check_output(
                ["ollama", "run", model, prompt],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            data = _parse_json(raw.strip())
            _validate(data)
            print(f"[llm] ✓ Script OK — \"{data['title']}\"")
            _print_cinematic_summary(data)
            return data
        except Exception as e:
            print(f"[llm]   ✗ attempt {attempt} failed: {e}", file=sys.stderr)

    raise RuntimeError(
        f"[llm] Could not get valid JSON from model after 3 attempts.\n"
        f"Last raw output (first 600 chars):\n{raw[:600]}"
    )


def spoken_text(script: dict) -> str:
    """Return all beat text joined for TTS (double-space = natural pause between beats)."""
    return "  ".join(b["text"].strip() for b in script["beats"])


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
            beat["text"] = _fix_duplicate_word_fragments(beat["text"])
    return data


# ---------------------------------------------------------------------------
# Internals — schema normalisation & cinematic-field fill-in
# ---------------------------------------------------------------------------

def _normalise_schema(data: dict) -> dict:
    """
    Normalise old schema (id int, hook bool) to new schema (type, energy),
    AND fill in missing cinematic fields with scene-type defaults so the
    contract is complete before validation runs.
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
# Internals — validation (basic + cinematic variety)
# ---------------------------------------------------------------------------

def _validate(data: dict) -> None:
    """Run all gates. Raises ValueError on any failure → triggers retry."""
    _validate_basic(data)
    _validate_cinematic_variety(data["beats"])


def _validate_basic(data: dict) -> None:
    """Schema + word-count gates from the original implementation."""
    if "beats" not in data:
        raise KeyError("Missing key: 'beats'")
    if "title" not in data:
        raise KeyError("Missing key: 'title'")

    beats = data["beats"]
    if not isinstance(beats, list):
        raise ValueError("beats must be a list")
    if not (4 <= len(beats) <= 8):
        raise ValueError(f"Expected 4-8 beats, got {len(beats)}")

    for i, beat in enumerate(beats):
        for k in ("keyword", "text"):
            if k not in beat:
                raise KeyError(f"Beat {i} missing key: '{k}'")
        if not beat["text"].strip():
            raise ValueError(f"Beat {i} has empty text")
        beat_words = len(beat["text"].split())
        if not (15 <= beat_words <= 30):
            raise ValueError(
                f"Beat {i} has {beat_words} words — must be 15-25 words per beat."
            )

    total_words = sum(len(b["text"].split()) for b in beats)
    min_words   = len(beats) * 15
    if total_words < min_words:
        raise ValueError(
            f"Script too short: {total_words} words across {len(beats)} beats "
            f"(minimum {min_words}). Model must expand."
        )
    if total_words > 200:
        raise ValueError(f"Script too long: {total_words} words (maximum 200).")


def _validate_cinematic_variety(beats: list) -> None:
    """
    Reject scripts that would produce stiff renders.

    Gates:
      - ≥3 distinct cameras across the script
      - ≥2 distinct paces / layouts / backgrounds
      - no 3 consecutive beats with the same camera
      - no 3 consecutive beats with the same layout

    Why these thresholds?
      A 4-beat script with 2 cameras = 50% variance — acceptable floor.
      A 6-beat script with 2 cameras = 33% variance — every beat starts to
      look the same. 3 cameras across 4-8 beats keeps the visual rhythm.
    """
    if len(beats) < 4:
        return  # too short to gate

    def _unique(field):
        return {b.get(field) for b in beats}

    cams       = _unique("camera")
    paces      = _unique("pace")
    layouts    = _unique("layout")
    bgs        = _unique("background")

    if len(cams) < 3:
        raise ValueError(
            f"Cinematic variety: only {len(cams)} unique camera(s) "
            f"across {len(beats)} beats — need ≥3. Got: {cams}"
        )
    if len(paces) < 2:
        raise ValueError(
            f"Cinematic variety: only 1 unique pace across {len(beats)} beats — need ≥2."
        )
    if len(layouts) < 2:
        raise ValueError(
            f"Cinematic variety: only 1 unique layout across {len(beats)} beats — need ≥2."
        )
    if len(bgs) < 2:
        raise ValueError(
            f"Cinematic variety: only 1 unique background — need ≥2."
        )

    # No 3-in-a-row repeats for camera or layout
    for field in ("camera", "layout"):
        run = 1
        for i in range(1, len(beats)):
            if beats[i].get(field) == beats[i-1].get(field):
                run += 1
                if run >= 3:
                    raise ValueError(
                        f"Cinematic variety: '{field}' repeated 3+ consecutive beats "
                        f"({beats[i].get(field)} at index {i-2}..{i})."
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

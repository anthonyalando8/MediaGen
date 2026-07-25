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

import hashlib
import math
import pathlib
import json
import re
import sys
from llm_fix_duplicates import fix_duplicate_word_fragments
from generation import generate

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

# scene/3.0 archetype registry — see docs/scene-3.0-schema.md. Only
# "text_over_dimmed" is consumed by the renderer today (it's the shim that
# reproduces current beat-contract behavior exactly); the rest are declared
# here so a future composer pass (phase 4) can assign them without a second
# vocabulary edit, and so _normalise_schema can validate the field instead of
# silently accepting typos.
_ALLOWED_ARCHETYPES = {
    "text_over_dimmed", "full_bleed_video", "bare_visual", "split_screen",
    "pip", "quote_card", "stat_callout", "comparison", "broll_montage",
    "title_card", "kinetic_type", "lower_third",
}

# Text-bearing vs textless split of the registry above — used by the composer
# pass below to protect on-screen meaning. Textless archetypes (scene_export.py
# synthesizers with no `role: "text"` layer) rely entirely on the image +
# narration audio to carry the beat; text-bearing ones still show a caption/
# label. Must partition _ALLOWED_ARCHETYPES exactly (see test_generation.py).
_TEXT_BEARING_ARCHETYPES = {
    "text_over_dimmed", "title_card", "quote_card",
    "stat_callout", "kinetic_type", "lower_third",
}
_TEXTLESS_ARCHETYPES = {
    "bare_visual", "split_screen", "comparison",
    "pip", "full_bleed_video", "broll_montage",
}
# Beat `type`s where the caption text itself carries the point being made
# (as opposed to hook/tension/climax/flip/payoff/cta, which are more about
# pacing/structure and read fine — sometimes better — without a caption).
_CONTENT_CARRYING_TYPES = {"insight", "truth"}


# ─────────────────────────────────────────────────────────────────────────────
# scene/3.0 composer pass — archetype assignment ("cut-list")
# ─────────────────────────────────────────────────────────────────────────────
# Deterministic and format-agnostic on purpose: no extra LLM call, no
# network, fully unit-testable. It's the "anti-repetition rule in code, not
# just prompt" the design doc calls for — a format opts in by adding
# `variety.min_archetypes` to its format.yaml (see formats.py's
# ValidationProfile.variety); omitting it (every format today except
# shortform_tiktok) leaves every beat on the "text_over_dimmed" default,
# unchanged. Only archetypes with an actual layer synthesizer AND renderer
# support are candidates — assigning one nothing can render would silently
# no-op (scene_export.py falls back to flat-field rendering for an
# unrecognized archetype), defeating the point.
_ARCHETYPE_TYPE_AFFINITY = {
    # archetype -> beat `type`s it suits, checked in this priority order.
    # (many entries overlap on purpose — a script with several eligible
    # beats gets a different archetype on each, in this priority order,
    # rather than all beats of one type collapsing to the same look.)
    "comparison":       {"flip", "truth"},          # "weighing two things" — the divider IS the point
    "split_screen":     {"payoff"},                 # plain two-panel reveal, no divider framing needed
    "pip":              {"tension", "climax"},      # a simultaneous-view moment (reaction over action, etc.)
    "title_card":       {"hook"},                   # the video's own opening beat AS a title card, not a caption
    "full_bleed_video":  {"climax", "tension"},      # a pure motion moment, no text competing for attention
    "bare_visual":      {"insight", "tension"},     # explanatory beats that can breathe without text
    "stat_callout":     {"insight", "truth"},       # a number/short claim worth making large
    "quote_card":       {"truth", "payoff"},        # punchy, quotable statements
    # Lower priority — fire only when higher-priority archetypes above
    "broll_montage":    {"insight", "climax"},      # energetic explanatory or peak-impact beats
    "kinetic_type":     {"flip", "climax"},         # a punchy reframe/reveal moment
    "lower_third":       {"insight", "truth"},       # an identifying/informational caption over visuals
}


_DENSITY_PER_MIN_ARCHETYPE = 0.10


def _diversification_budget(n_beats: int, min_archetypes: int) -> int:
    """How many beats `assign_composition` should move off the default
    archetype, total. Scales with script length (via `n_beats`) and with how
    aggressively the format asks for variety (via `min_archetypes`, now a
    density dial rather than a hard distinct-archetype target — see
    `assign_composition`'s docstring). `min_archetypes - 1` — today's old
    fixed cap — becomes a FLOOR, and `n_beats // 3` is a ceiling so
    diversified beats always stay a clear minority against `text_over_dimmed`."""
    if min_archetypes <= 1:
        return 0
    raw = math.ceil(n_beats * _DENSITY_PER_MIN_ARCHETYPE * min_archetypes)
    floor_val = min_archetypes - 1
    cap_val = n_beats // 3
    return max(0, min(cap_val, max(floor_val, raw)))


def _candidates_for(beat_type: str, content_safe: bool) -> list[str]:
    """Archetypes (in _ARCHETYPE_TYPE_AFFINITY priority order) that suit this
    beat `type`. `content_safe=True` restricts to _TEXT_BEARING_ARCHETYPES —
    used for insight/truth beats, where the caption itself carries the point
    and a textless archetype would silently delete it."""
    return [
        a for a, wanted in _ARCHETYPE_TYPE_AFFINITY.items()
        if beat_type in wanted and (not content_safe or a in _TEXT_BEARING_ARCHETYPES)
    ]


def _stable_pick(candidates: list[str], beat: dict) -> str:
    """Deterministic choice among tied candidates, seeded from the beat's own
    text — NOT Python's unseeded `random` — so `assign_composition` stays
    reproducible (same script in -> same archetypes out) without needing a
    threaded-through seed."""
    key = (beat.get("text") or beat.get("keyword") or "").encode("utf-8")
    return candidates[int(hashlib.md5(key).hexdigest(), 16) % len(candidates)]


def assign_composition(data: dict, profile) -> dict:
    """
    Overrides a length-scaled BUDGET of beats' default "text_over_dimmed"
    archetype based on their rhetorical `type`, so a script doesn't render as
    an unbroken run of the same composition. No-ops entirely if the format's
    `variety.min_archetypes` isn't set (>1) — matches `calm_narrative`'s
    existing "variety: {}" opt-out convention: a format that doesn't ask for
    variety gates doesn't get archetype diversification either.

    `min_archetypes` is a density dial now, not a guaranteed distinct-
    archetype count (see `_diversification_budget`) — a low-type-diversity
    script (e.g. every beat typed "cta", which no archetype in
    `_ARCHETYPE_TYPE_AFFINITY` wants) can legitimately end up with FEWER
    than `min_archetypes` distinct archetypes used; nothing downstream
    validates against this value (`_validate_cinematic_variety` doesn't
    recognise it), so that's safe.

    Budget is spent on structural beats (hook/tension/climax/flip/payoff/cta)
    first, then on content-carrying beats (insight/truth) restricted to
    text-bearing archetypes only — spending it the other way round would
    strip captions from exactly the beats whose caption IS the content.
    """
    variety = getattr(profile, "variety", None) or {}
    min_archetypes = int(variety.get("min_archetypes", 0) or 0)
    max_consecutive = int(variety.get("max_consecutive_archetype", 0) or 0)
    beats = data.get("beats", [])
    if min_archetypes <= 1 or len(beats) < 2:
        return data

    budget = _diversification_budget(len(beats), min_archetypes)
    if budget <= 0:
        return data

    def _is_default(b):
        return b.get("archetype", "text_over_dimmed") == "text_over_dimmed"

    structural_idx = [
        i for i, b in enumerate(beats)
        if _is_default(b) and b.get("type") not in _CONTENT_CARRYING_TYPES
        and _candidates_for(b.get("type"), content_safe=False)
    ]
    content_idx = [
        i for i, b in enumerate(beats)
        if _is_default(b) and b.get("type") in _CONTENT_CARRYING_TYPES
        and _candidates_for(b.get("type"), content_safe=True)
    ]

    spent = 0
    for i in structural_idx:
        if spent >= budget:
            break
        b = beats[i]
        b["archetype"] = _stable_pick(_candidates_for(b.get("type"), content_safe=False), b)
        spent += 1
    for i in content_idx:
        if spent >= budget:
            break
        b = beats[i]
        b["archetype"] = _stable_pick(_candidates_for(b.get("type"), content_safe=True), b)
        spent += 1

    # Code-level guarantee (not just a prompt hope): no archetype repeats
    # more than `max_consecutive` beats in a row — now actually exercised,
    # since a real budget of beats gets reassigned above.
    if max_consecutive > 0:
        run_val, run_len = None, 0
        for beat in beats:
            a = beat.get("archetype", "text_over_dimmed")
            if a == run_val:
                run_len += 1
            else:
                run_val, run_len = a, 1
            if run_len > max_consecutive:
                beat["archetype"] = "text_over_dimmed"
                run_val, run_len = "text_over_dimmed", 1

    return data


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def generate_script(topic: str, fmt, model: str | None = None) -> dict:
    """
    Generate a structured script via the configured LLM provider (see
    generation.py — provider + model selection now live entirely in
    config.yaml's `llm` block, with automatic priority-ordered fallback
    across every enabled provider).

    `fmt` is a formats.Format (prompt + validation profile). Retries up to 3
    times on bad output OR profile-gate failure — each attempt re-runs
    generation.generate()'s own fallback chain from the top, so a transient
    failure on every provider doesn't burn the whole retry budget in one shot.

    `model` is accepted for back-compat with existing callers (main.py/
    server.py currently pass `CFG["llm"]["model"]`) but is IGNORED — model
    selection is config.yaml's job now, not the caller's.
    """
    prompt = fmt.prompt.format(topic=topic)
    profile = fmt.profile
    raw = ""

    for attempt in range(1, 4):
        print(f"[llm] Generating script (format={fmt.id}, attempt {attempt}/3)…")
        try:
            raw = generate(prompt)
            data = _parse_json(raw.strip())
            data = assign_composition(data, profile)
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

        # scene/3.0: composition family. No format/prompt emits this yet, so
        # every beat lands on "text_over_dimmed" — today's only archetype,
        # equivalent to current output. A later composer pass (cut-list,
        # phase 4) can set beat["archetype"] before this runs; this only
        # fills the gap when it's absent.
        if beat.get("archetype") not in _ALLOWED_ARCHETYPES:
            beat["archetype"] = "text_over_dimmed"

    # top-level optional fields
    data.setdefault("thumbnail", data.get("keyword", ""))
    data.setdefault("style", "analytical")
    return data


# ---------------------------------------------------------------------------
# Internals — section hierarchy (phase 5: long-form)
# ---------------------------------------------------------------------------

def _flatten_sections(data: dict) -> dict:
    """
    Canonicalize a script's beat list. A long-form format's prompt MAY ask
    the model for `sections: [{id, pacing_arc, beats: [...]}]` instead of a
    flat top-level `beats[]` — grouping an intro/body/conclusion (or
    chapters) so a 5-30 minute script has real structure instead of one
    undifferentiated beat list. This flattens `sections[]` into ONE
    top-level `data["beats"]`, in order, stamping each beat with
    `section_id`/`pacing_arc` from its section — so every downstream
    consumer (_normalise_schema, _validate, visuals.py, scene_export.py)
    keeps working off a flat beat list and never has to know sections exist.
    `pacing_arc` rides along as forward-compat metadata (same pattern as
    `archetype` before phase 4 consumed it) — nothing reads it yet.

    Back-compat: `sections` absent (every format before this existed, and
    any format that just emits `beats[]` directly) is a no-op — `data`
    passes through untouched.
    """
    sections = data.get("sections")
    if not sections:
        return data

    flat: list[dict] = []
    for si, section in enumerate(sections):
        pacing_arc = section.get("pacing_arc") or "steady"
        section_id = section.get("id") or f"section_{si}"
        for beat in section.get("beats", []) or []:
            beat.setdefault("pacing_arc", pacing_arc)
            beat.setdefault("section_id", section_id)
            flat.append(beat)
    data["beats"] = flat
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
    data = _flatten_sections(data)
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

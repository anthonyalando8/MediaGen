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
    "title_card", "poster_card", "kinetic_type", "lower_third",
    # P3 structured-text archetypes (opt-in — not in _ARCHETYPE_TYPE_AFFINITY,
    # so the composer never auto-assigns them; a format or upstream composer
    # sets them explicitly). All text-bearing (see partition below).
    "definition_card", "list_card", "dialogue_card",
    # P4 structured-text archetypes (read off a real reference — see
    # apps/editor/.../text/representations). stat_band/case_study ARE in
    # _ARCHETYPE_TYPE_AFFINITY below (real generations can reach them);
    # anaphora_stack/meta_facts stay opt-in like the P3 trio — heuristically
    # splitting one beat's narration into repeated-phrase rhythm or
    # date/location metadata is unreliable enough that auto-assigning it to
    # arbitrary topics risks nonsense on screen (see scene_export.py).
    "stat_band", "anaphora_stack", "case_study", "meta_facts",
}

# Text-bearing vs textless split of the registry above — used by the composer
# pass below to protect on-screen meaning. Textless archetypes (scene_export.py
# synthesizers with no `role: "text"` layer) rely entirely on the image +
# narration audio to carry the beat; text-bearing ones still show a caption/
# label. Must partition _ALLOWED_ARCHETYPES exactly (see test_generation.py).
_TEXT_BEARING_ARCHETYPES = {
    "text_over_dimmed", "title_card", "poster_card", "quote_card",
    "stat_callout", "kinetic_type", "lower_third",
    "definition_card", "list_card", "dialogue_card",  # P3 (opt-in)
    "stat_band", "case_study",                        # P4 (auto-assignable)
    "anaphora_stack", "meta_facts",                   # P4 (opt-in)
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
    # P4 (auto-assignable) — anaphora_stack/meta_facts deliberately absent,
    # see _TEXT_BEARING_ARCHETYPES's comment.
    "stat_band":        {"insight", "truth"},       # multi-figure variant of stat_callout
    "case_study":       {"insight", "truth"},       # numbered-case variant of lower_third/stat_callout
    # P3 structured-text archetypes — now REACHABLE, but only through
    # `_content_gate` (a beat with no real list/term/dialogue content never
    # gets one). Without these in the table nothing downstream can ever emit
    # the `items[]`/term layers the numbered-list / definition-card /
    # chat-bubbles representations need, so those four representations were
    # dead in every generated video regardless of text_intent.
    "list_card":        {"insight", "payoff"},      # enumerations — gated on separators/items[]
    "definition_card":  {"insight", "truth"},       # keyword=term, text=gloss
    "dialogue_card":    {"tension", "flip"},        # gated on an explicit items[] only
}


# Diversification dials. These are LENGTH-INDEPENDENT on purpose: the "every
# video looks the same" problem is not a genre or a duration problem, it's that
# the default archetype was allowed to hold a supermajority of beats in every
# script. A reel with 2 of 6 beats diversified reads as flat for the same reason
# a 30-beat explainer with 9 does.
#
# `n_beats // 3` was the old hardcoded ceiling and is the single biggest cause:
# at ANY length it pinned two thirds of beats to `text_over_dimmed` → text_intent
# "caption" → one representation, regardless of what the format asked for.
#
# Tuned so the budget lands near HALF the beats at every length — the default
# archetype stays the most common single look (it should; it's the one that reads
# cleanly over footage) without being the only one:
#
#     6 beats (reel)       → 3   (was 2)
#     10 beats (listicle)  → 5   (was 3)
#     20 beats (explainer) → 9   (was 6)
#     30 beats (explainer) → 14  (was 9)
#
# A format overrides either via `variety.archetype_density` /
# `variety.archetype_max_share`; a format with `variety: {}` (calm_narrative)
# opts out of diversification entirely, as before.
_DENSITY_PER_MIN_ARCHETYPE = 0.15
_DEFAULT_ARCHETYPE_MAX_SHARE = 2.0 / 3.0


def _diversification_budget(
    n_beats: int,
    min_archetypes: int,
    density: float | None = None,
    max_share: float | None = None,
) -> int:
    """How many beats `assign_composition` should move off the default
    archetype, total. Scales with script length (via `n_beats`) and with how
    aggressively the format asks for variety (via `min_archetypes`, now a
    density dial rather than a hard distinct-archetype target — see
    `assign_composition`'s docstring). `min_archetypes - 1` is a FLOOR and
    `max_share * n_beats` a ceiling."""
    if min_archetypes <= 1:
        return 0
    if density is None:
        density = _DENSITY_PER_MIN_ARCHETYPE
    if max_share is None:
        max_share = _DEFAULT_ARCHETYPE_MAX_SHARE
    raw = math.ceil(n_beats * density * min_archetypes)
    floor_val = min_archetypes - 1
    cap_val = int(n_beats * max_share)
    return max(0, min(cap_val, max(floor_val, raw)))
    if min_archetypes <= 1:
        return 0
    if density is None:
        density = _default_density(n_beats)
    if max_share is None:
        max_share = _default_max_share(n_beats)
    raw = math.ceil(n_beats * density * min_archetypes)
    floor_val = min_archetypes - 1
    cap_val = int(n_beats * max_share)
    return max(0, min(cap_val, max(floor_val, raw)))


# ── Content gates for the structured (P3/P4) archetypes ─────────────────────
# These archetypes' scene_export synthesizers emit the extra layer fields the
# editor's structured representations read (`items[]`, term/gloss pairs). They
# were excluded from _ARCHETYPE_TYPE_AFFINITY because auto-assigning them to
# arbitrary beats risks nonsense on screen — the fix is not to keep them
# unreachable but to gate them on the beat ACTUALLY carrying the content, so
# they're reachable exactly when they'd render something true.
#
# WHY THIS MATTERS FOR text_intent: a beat left on `text_over_dimmed` gets no
# `items` layer, so stamping text_intent "list"/"definition"/"dialogue" on it is
# inert — the editor's selector drops a representation whose required fields are
# missing and falls back to a caption. Archetype is what makes those intents
# real; text_intent alone cannot diversify a script.

_NUMERAL_RE = re.compile(r"\d")
_LIST_SEPARATOR_RE = re.compile(r"[;•]|\s-\s|,\s")
_QUOTED_RE = re.compile(r"[\"“”]")


def _beat_prose(beat: dict) -> str:
    """The beat's spoken line. NOTE: at composition time the field is `text` —
    `body` only exists downstream (visuals.py maps text→body when it builds the
    render contract), so gates here must never read `body`."""
    return (beat.get("text") or "").strip()


def _content_gate(archetype: str, beat: dict) -> bool:
    """True when this beat carries what `archetype`'s synthesizer needs to emit
    a meaningful structured layer. Mirrors scene_export.py's `_derive_*`
    helpers: those fall back to one-item/whole-line output when the content
    isn't really structured, which renders as a worse caption — so we'd rather
    not pick the archetype at all in that case."""
    prose = _beat_prose(beat)
    items = beat.get("items")
    has_items = isinstance(items, (list, tuple)) and len(items) >= 2

    if archetype == "list_card":
        # _derive_list_items needs ≥2 separator-delimited parts to be a real list.
        return has_items or len(_LIST_SEPARATOR_RE.findall(prose)) >= 1
    if archetype == "definition_card":
        # keyword becomes the term, text becomes the gloss (scene_export:717).
        return bool(beat.get("keyword") and prose)
    if archetype == "dialogue_card":
        return has_items
    if archetype == "stat_band":
        # _derive_stat_items wants 2+ figures to fill a band.
        return has_items or len(_NUMERAL_RE.findall(prose)) >= 2
    if archetype == "case_study":
        return has_items or bool(_NUMERAL_RE.search(prose))
    if archetype == "quote_card":
        return bool(_QUOTED_RE.search(prose)) or bool(beat.get("attribution"))
    if archetype == "stat_callout":
        return bool(_NUMERAL_RE.search(prose))
    return True


def _candidates_for(beat_type: str, content_safe: bool) -> list[str]:
    """Archetypes (in _ARCHETYPE_TYPE_AFFINITY priority order) that suit this
    beat `type`. `content_safe=True` restricts to _TEXT_BEARING_ARCHETYPES —
    used for insight/truth beats, where the caption itself carries the point
    and a textless archetype would silently delete it."""
    return [
        a for a, wanted in _ARCHETYPE_TYPE_AFFINITY.items()
        if beat_type in wanted and (not content_safe or a in _TEXT_BEARING_ARCHETYPES)
    ]


def _gated_candidates_for(beat: dict, content_safe: bool) -> list[str]:
    """`_candidates_for` minus archetypes this beat can't actually fill."""
    return [
        a for a in _candidates_for(beat.get("type"), content_safe)
        if _content_gate(a, beat)
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
    density = variety.get("archetype_density")
    max_share = variety.get("archetype_max_share")
    beats = data.get("beats", [])
    if min_archetypes <= 1 or len(beats) < 2:
        return data

    budget = _diversification_budget(
        len(beats),
        min_archetypes,
        float(density) if density else None,
        float(max_share) if max_share else None,
    )
    if budget <= 0:
        return data

    def _is_default(b):
        return b.get("archetype", "text_over_dimmed") == "text_over_dimmed"

    structural_idx = [
        i for i, b in enumerate(beats)
        if _is_default(b) and b.get("type") not in _CONTENT_CARRYING_TYPES
        and _gated_candidates_for(b, content_safe=False)
    ]
    content_idx = [
        i for i, b in enumerate(beats)
        if _is_default(b) and b.get("type") in _CONTENT_CARRYING_TYPES
        and _gated_candidates_for(b, content_safe=True)
    ]

    # Spend the budget SPREAD ACROSS the script rather than front-to-back.
    # Walking in index order exhausted the budget on the opening beats and left
    # every beat past it on the default archetype — on an 18-36 beat explainer
    # that reads as "the video changes look for a while, then goes flat".
    def _spread(indices: list[int], n: int) -> list[int]:
        if n <= 0 or not indices:
            return []
        if n >= len(indices):
            return indices
        step = len(indices) / n
        return [indices[min(int(k * step), len(indices) - 1)] for k in range(n)]

    # Structural beats first, then content-carrying ones (restricted to
    # text-bearing archetypes) — spending it the other way round would strip
    # captions from exactly the beats whose caption IS the content.
    n_structural = min(len(structural_idx), budget)
    n_content = min(len(content_idx), budget - n_structural)

    spent = 0
    for i in _spread(structural_idx, n_structural):
        b = beats[i]
        b["archetype"] = _stable_pick(_gated_candidates_for(b, content_safe=False), b)
        spent += 1
    for i in _spread(content_idx, n_content):
        b = beats[i]
        b["archetype"] = _stable_pick(_gated_candidates_for(b, content_safe=True), b)
        spent += 1

    # Code-level guarantee (not just a prompt hope): no archetype repeats
    # more than `max_consecutive` beats in a row — now actually exercised,
    # since a real budget of beats gets reassigned above.
    #
    # The guard only trims runs of NON-default archetypes. Counting the default
    # too (as it used to) was a no-op that read like a working guard: on a long
    # run of `text_over_dimmed` it "fixed" each beat by setting it to
    # `text_over_dimmed` and resetting the counter, so the monotony it exists to
    # prevent was the one case it could never break. Breaking up a default run
    # is the diversification BUDGET's job (raise `archetype_density` /
    # `archetype_max_share`), not this guard's.
    if max_consecutive > 0:
        run_val, run_len = None, 0
        for beat in beats:
            a = beat.get("archetype", "text_over_dimmed")
            if a == run_val:
                run_len += 1
            else:
                run_val, run_len = a, 1
            if run_len > max_consecutive and a != "text_over_dimmed":
                beat["archetype"] = "text_over_dimmed"
                run_val, run_len = "text_over_dimmed", 1

    return data


# ─────────────────────────────────────────────────────────────────────────────
# scene/3.0 composer pass — beat `type` variety
# ─────────────────────────────────────────────────────────────────────────────
# `type` is the root of the whole look-selection chain: it drives the cinematic
# defaults, `_ARCHETYPE_TYPE_AFFINITY`, and text_intent's pools. A script where
# every body beat is "insight" can therefore only ever render one look, however
# good the downstream diversification is — which is exactly what long explainers
# were doing (models label the first beat, the last beat, and then coast).
#
# Enforced in CODE rather than per-prompt for the same reason `assign_composition`
# is: it then applies to every format, present and future, instead of depending
# on five prompt files staying in sync. Prompts should still ASK for varied types
# (a model-chosen type is better than a substituted one) — this is the floor.
#
# Runs AFTER _normalise_schema, so the cinematic fields are already filled from
# the model's original type and are NOT rewritten here; only the affinity/intent
# axes see the substitution.
_MAX_CONSECUTIVE_TYPE = 3

# What to substitute when a type runs too long, by the run's own type. Each
# alternative must be a real `_ALLOWED["type"]` value with entries in
# `_ARCHETYPE_TYPE_AFFINITY`, and must be a defensible reading of a body beat —
# we're relabelling what the beat is DOING, not inventing content.
_TYPE_SUBSTITUTES = {
    "insight": ("truth", "tension", "flip"),
    "tension": ("insight", "flip"),
    "truth":   ("insight", "payoff"),
    "flip":    ("insight", "tension"),
    "climax":  ("tension", "truth"),
    "payoff":  ("truth", "insight"),
}


def enforce_type_variety(data: dict, profile) -> dict:
    """In place: break up runs of more than `_MAX_CONSECUTIVE_TYPE` identical
    beat `type`s. No-ops when the format doesn't ask for variety (`variety: {}`,
    e.g. calm_narrative — a steady read is the point there), and never touches
    the first or last beat (hook/cta are positional by contract).

    Deterministic: the substitute is chosen by `_stable_pick` off the beat's own
    text, so the same script always yields the same types."""
    variety = getattr(profile, "variety", None) or {}
    if not variety:
        return data
    beats = data.get("beats", [])
    if len(beats) < 4:
        return data

    # A short script has few beats to spend the budget on, so a 3-in-a-row limit
    # never binds; scale the limit down with length so reels get the same
    # *proportional* variety as long-form.
    limit = int(variety.get("max_consecutive_type", 0) or 0)
    if limit <= 0:
        limit = _MAX_CONSECUTIVE_TYPE if len(beats) > 8 else 2
    run_val, run_len = None, 0
    for i, beat in enumerate(beats):
        t = beat.get("type")
        if t == run_val:
            run_len += 1
        else:
            run_val, run_len = t, 1
        if run_len <= limit or i in (0, len(beats) - 1):
            continue
        options = [s for s in _TYPE_SUBSTITUTES.get(t, ()) if s in _ALLOWED["type"]]
        if not options:
            continue
        beat["type"] = _stable_pick(options, beat)
        run_val, run_len = beat["type"], 1
    return data


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

# P2 · the text-representation selection axis (see apps/editor/src/persistence/
# text). Independent of archetype/composition; the editor's text/selector.ts
# scores its representation library against it, falling back to the legacy
# archetype mapping when it's absent.
from text_intent import assign_text_intent, normalise_text_intent

_SCRIPT_GEN_MAX_ATTEMPTS = 3


def generate_script(topic: str, fmt, model: str | None = None, progress=None) -> dict:
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

    `progress` — optional callback(frac: float, detail: str), frac in
    [0, 1] across the whole retry budget. This is a single blocking call
    per attempt (no token-level streaming below this layer, across every
    provider), so there's no finer-grained signal available than "which
    attempt" / "which provider is being tried right now" — that's real
    progress, not a time-based animation, which is why it moves in
    per-attempt/per-provider steps rather than smoothly.
    """
    prompt = fmt.prompt.format(topic=topic)
    profile = fmt.profile
    raw = ""
    max_attempts = _SCRIPT_GEN_MAX_ATTEMPTS

    for attempt in range(1, max_attempts + 1):
        print(f"[llm] Generating script (format={fmt.id}, attempt {attempt}/{max_attempts})…")
        if progress:
            progress((attempt - 1) / max_attempts, f"attempt {attempt}/{max_attempts}")

        def _on_provider_start(name, i, n, _attempt=attempt):
            if progress:
                progress((_attempt - 1) / max_attempts, f"attempt {_attempt}/{max_attempts} · trying {name}")

        try:
            raw = generate(prompt, on_provider_start=_on_provider_start)
            data = _parse_json(raw.strip())
            # scene/3.0: break up long runs of one beat `type` BEFORE composition,
            # since `type` is what the archetype affinity table and text_intent's
            # pools both key off. Format-gated (variety: {} opts out).
            data = enforce_type_variety(data, profile)
            data = assign_composition(data, profile)
            # P2: composition first, so text_intent's archetype fallback sees
            # the FINAL archetypes. Purely additive — every beat gets a
            # deterministic text_intent (or none, → editor legacy mapping).
            assign_text_intent(data.get("beats", []))
            _validate(data, profile)
            print(f"[llm] ✓ Script OK — \"{data['title']}\"")
            _print_cinematic_summary(data)
            if progress:
                progress(1.0, "script ready")
            return data
        except Exception as e:
            print(f"[llm]   ✗ attempt {attempt} failed: {e}", file=sys.stderr)

    raise RuntimeError(
        f"[llm] Could not get valid JSON from model after {max_attempts} attempts.\n"
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

# Rotation used when a beat arrives with NO `type` at all. The old fallback was
# the bare literal "insight" for every middle beat, which is the root of the
# "every 5-minute explainer looks identical" report: `type` drives the cinematic
# defaults above, the archetype affinity table, AND text_intent's pool, so a
# 30-beat script arriving as 1 hook + 28 insight + 1 cta could only ever render
# one look. A well-typed script never reaches this — it applies ONLY to beats
# whose type the model omitted, so nothing regresses for formats that type
# their beats properly (see prompts/formats/*/prompt.txt).
_UNTYPED_MIDDLE_ROTATION = ("insight", "tension", "insight", "truth", "insight", "flip")


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
                # Rotate instead of stamping "insight" on every middle beat.
                # Deterministic (position-based), and weighted toward insight so
                # an explainer still reads as explanatory rather than dramatic.
                beat["type"] = _UNTYPED_MIDDLE_ROTATION[i % len(_UNTYPED_MIDDLE_ROTATION)]

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

        # P2: drop an invalid text_intent so a bad upstream value never reaches
        # the editor selector (defence in depth; assign_text_intent stamps the
        # real value later, after composition is finalised).
        normalise_text_intent(beat)

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
        if "keyword" not in beat:
            raise KeyError(f"Beat {i} missing key: 'keyword'")
        # `silent: true` (tts.py) — music-only beat, no narration. Its text
        # (if any) is still shown visually (e.g. poster_card's headline/
        # subtext), just never spoken, so the word-count/emphasis gates
        # below — which exist to keep NARRATION pacing sane — don't apply.
        if beat.get("silent"):
            continue
        if "text" not in beat:
            raise KeyError(f"Beat {i} missing key: 'text'")
        if not beat["text"].strip():
            raise ValueError(f"Beat {i} has empty text")
        beat_words = len(beat["text"].split())
        if not (lo <= beat_words <= hi):
            raise ValueError(f"Beat {i} has {beat_words} words — must be {lo}-{hi} words per beat.")
        if profile.require_emphasis and "*" not in beat["text"]:
            raise ValueError(f"Beat {i} missing an *emphasis* word (format requires one per beat).")

    total_words = sum(len((b.get("text") or "").split()) for b in beats)
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

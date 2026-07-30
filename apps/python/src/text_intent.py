"""
apps/python/src/text_intent.py

P2 · The text-representation selection axis, Python side.

`text_intent` is INDEPENDENT of `archetype`. Archetype decides how the frame
is COMPOSED (background / split / pip / montage); text_intent decides how the
words READ (caption / quote / stat / definition / list / dialogue / ...). The
editor's text/selector.ts scores its representation library against this value;
when it's absent the editor falls back to the exact legacy archetype/reveal
mapping, so this whole module is additive — a scene generated without it renders
byte-for-byte as before.

Wire it EXACTLY like assign_composition (llm.py): deterministic, code-enforced,
called after the script is parsed. It never calls a model.

────────────────────────────────────────────────────────────────────
WHY THERE IS A DIVERSIFICATION PASS HERE ("every video looks the same")
────────────────────────────────────────────────────────────────────
The original single-beat mapping could not produce variety: only
hook/truth/payoff/cta had entries in the type table, so insight/tension/flip/
climax — the bulk of every script — fell through to the archetype hint, which
for the default `text_over_dimmed` is "caption" → one representation.

Two constraints discovered while wiring this up, both of which the pass below
now respects. Ignore either one and the rotation looks busy in the JSON but
renders as the same caption on screen:

  1. AT THIS POINT IN THE PIPELINE THE SPOKEN LINE IS `text`, NOT `body`.
     `body` is created downstream — visuals.py maps text→body when it builds
     the render contract. A gate that reads `beat["body"]` is therefore ALWAYS
     False here, which silently disabled the `definition` gate entirely.
  2. AN INTENT IS INERT UNLESS THE ARCHETYPE EMITS ITS FIELDS.
     scene_export.py synthesizes layers per archetype. Only the structured
     archetypes emit `items[]` / term+gloss; a `text_over_dimmed` beat gets a
     plain text layer. The editor's selector DROPS a representation whose
     required `fields` are missing and falls back to a caption — so stamping
     "list" on a text_over_dimmed beat changes nothing. Archetype is what makes
     the structured intents real (see llm.py's `_content_gate`); this module
     only picks among intents the beat's archetype can actually satisfy.
"""

from __future__ import annotations

import hashlib
import re

# Must stay in sync with TextIntent in text/types.ts.
# NOTE: "meta" is NOT in the TS union today — intentOf() will drop it and fall
# back to the legacy mapping until types.ts adds it. Kept out of the rotation
# pools below for that reason (it is still reachable via a pinned
# `meta_facts` archetype, which is opt-in).
TEXT_INTENTS = {
    "caption", "title", "quote", "stat", "definition", "list",
    "dialogue", "warning", "comparison", "qa", "timeline", "takeaway",
    "lower_third", "emphasis",
    "meta",  # meta-chips (P4) — pending types.ts
}

# ── What each archetype's synthesizer actually puts on screen ────────────────
# Mirrors scene_export.py's `_synthesize_*_layers`. An intent whose
# representation needs a field this archetype never emits can't be honoured.

# Archetypes whose text layer carries an `items[]` array.
_ARCHETYPES_WITH_ITEMS = {
    "list_card", "dialogue_card", "stat_band", "case_study",
    "anaphora_stack", "meta_facts",
}
# Archetypes emitting a term/gloss (label + value) pair rather than a flat line.
_ARCHETYPES_WITH_TERM = {"definition_card", "lower_third", "stat_callout"}
# Archetypes with no text layer at all — nothing to represent, leave unstamped
# so the editor's legacy path handles them.
_TEXTLESS_ARCHETYPES = {
    "bare_visual", "split_screen", "comparison",
    "pip", "full_bleed_video", "broll_montage",
}

# Intents that need nothing but the spoken line — always safe to assign.
_FIELD_FREE_INTENTS = {
    "caption", "title", "emphasis", "takeaway", "warning", "timeline", "quote", "qa",
}

_NUMERAL = re.compile(r"\d")
_QUOTED = re.compile(r"[\"“”]")


def _prose(beat: dict) -> str:
    """The spoken line. `text` is the field that exists at this stage; `body`
    is accepted only so the module still works if called on a downstream
    contract (see constraint 1 in the module docstring)."""
    return (beat.get("text") or beat.get("body") or "").strip()


def _has_items(beat: dict) -> bool:
    items = beat.get("items")
    return isinstance(items, (list, tuple)) and len(items) >= 2


def _gate_ok(intent: str, beat: dict) -> bool:
    """True when this beat + its archetype can actually render `intent`."""
    archetype = beat.get("archetype", "text_over_dimmed")
    prose = _prose(beat)
    text = " ".join(
        str(beat.get(k) or "") for k in ("text", "body", "keyword", "term")
    )

    # Structured intents need an archetype that emits the structure. `items` on
    # the beat is not enough — scene_export only forwards it for the archetypes
    # whose synthesizer reads it.
    if intent in ("list", "dialogue"):
        if archetype not in _ARCHETYPES_WITH_ITEMS:
            return False
        return _has_items(beat) or archetype in ("list_card", "dialogue_card")
    if intent == "definition":
        # keyword→term, text→gloss (scene_export:717). Requires the archetype
        # that emits the pair; `body` does not exist yet, so gate on prose.
        return archetype in _ARCHETYPES_WITH_TERM and bool(beat.get("keyword") and prose)
    if intent == "stat":
        return bool(_NUMERAL.search(text))
    if intent == "quote":
        return bool(beat.get("attribution")) or bool(_QUOTED.search(prose))
    if intent == "qa":
        return "?" in text
    if intent == "comparison":
        # comparison-labels scores 0 unless the beat is actually COMPOSED as a
        # comparison (see comparison-labels.ts) — never assign it otherwise.
        return archetype in ("comparison", "split_screen")
    if intent == "lower_third":
        return bool(beat.get("keyword") or beat.get("brand"))
    return intent in _FIELD_FREE_INTENTS


# ── Per-type intent POOLS (was: one intent per type) ────────────────────────
# Ordered by preference. The rotation walks the pool, skipping gated-out and
# consecutively-repeated intents. Every pool ends in a field-free intent so a
# beat always has at least one legal option — which is why a beat that stays on
# `text_over_dimmed` still varies (caption / takeaway / emphasis / title read
# differently even off the same plain text layer).
_TYPE_INTENT_POOLS = {
    # Real `_ALLOWED["type"]` values — these are the ones that actually fire.
    "hook":    ["title", "emphasis", "stat", "caption"],
    "insight": ["stat", "definition", "list", "lower_third", "takeaway", "caption"],
    "tension": ["warning", "emphasis", "qa", "caption"],
    "truth":   ["quote", "comparison", "stat", "takeaway", "caption"],
    "flip":    ["comparison", "emphasis", "qa", "caption"],
    "climax":  ["emphasis", "stat", "title", "caption"],
    "payoff":  ["takeaway", "quote", "timeline", "caption"],
    "cta":     ["emphasis", "title", "takeaway", "caption"],
    # Types only an upstream composer / format can set (not LLM-emittable).
    "quote": ["quote"], "stat": ["stat"], "statistic": ["stat"],
    "definition": ["definition"], "list": ["list"], "steps": ["list"],
    "takeaway": ["takeaway"], "warning": ["warning"], "question": ["qa"],
    "dialogue": ["dialogue"], "title": ["title"],
    "anaphora": ["emphasis"], "section": ["title"], "case": ["timeline"],
    "facts": ["meta"],
}

# When there's no useful `type`, the composition archetype is a decent hint.
_ARCHETYPE_TO_INTENT = {
    "title_card": "title",
    "quote_card": "quote",
    "stat_callout": "stat",
    "kinetic_type": "emphasis",
    "lower_third": "lower_third",
    "comparison": "comparison",
    "poster_card": "title",
    "text_over_dimmed": "caption",
}

# Structured archetypes carry their own representation intent regardless of the
# rhetorical `type` — their layers only make sense rendered one way, so they
# take priority over the type pools.
_STRUCTURED_ARCHETYPE_INTENT = {
    "definition_card": "definition",
    "list_card": "list",
    "dialogue_card": "dialogue",
    # P4 (see scene_export.py / llm.py)
    "stat_band": "stat",
    "anaphora_stack": "emphasis",
    "case_study": "timeline",
    "meta_facts": "meta",
}

# How many beats in a row may share an intent before the pass forces a change.
_MAX_CONSECUTIVE_INTENT = 2


def _rotation_offset(beat: dict, index: int) -> int:
    """Deterministic per-beat rotation seed — same script in, same intents out
    (mirrors llm.py::_stable_pick's reasoning: never Python's unseeded random)."""
    key = f"{index}:{beat.get('text') or beat.get('keyword') or ''}".encode("utf-8")
    return int(hashlib.md5(key).hexdigest(), 16)


def _pinned_intent(beat: dict) -> str | None:
    """An intent that must not be rotated away from: an explicit upstream value
    or a structured archetype whose layers only render one way."""
    if beat.get("text_intent") in TEXT_INTENTS:
        return beat["text_intent"]
    archetype = beat.get("archetype", "text_over_dimmed")
    return _STRUCTURED_ARCHETYPE_INTENT.get(archetype)


def _intent_for_beat(beat: dict) -> str | None:
    """Deterministic single-beat mapping, no variety guard. Kept for callers
    that want the unrotated answer; `assign_text_intent` uses the pass below.
    Returns None to leave the beat unstamped (editor uses its legacy mapping)."""
    pinned = _pinned_intent(beat)
    if pinned:
        return pinned
    if beat.get("archetype") in _TEXTLESS_ARCHETYPES:
        return None
    for intent in _TYPE_INTENT_POOLS.get(beat.get("type"), []):
        if _gate_ok(intent, beat):
            return intent
    return _ARCHETYPE_TO_INTENT.get(beat.get("archetype", "text_over_dimmed"))


def assign_text_intent(beats: list[dict]) -> None:
    """In place: stamp a VARIED `text_intent` on every beat that doesn't already
    carry a valid one. Purely additive — safe to call unconditionally. Call it
    right after assign_composition() in generate_script (composition first, so
    the archetype gates see the FINAL archetypes — this module's structured
    intents depend on them).

    Per beat: pinned intents win; textless archetypes stay unstamped; otherwise
    the beat's type pool is filtered by `_gate_ok`, rotated by a deterministic
    per-beat offset, and the first candidate that wouldn't extend a run past
    `_MAX_CONSECUTIVE_INTENT` is taken."""
    run_val: str | None = None
    run_len = 0

    for index, beat in enumerate(beats):
        pinned = _pinned_intent(beat)
        if pinned:
            chosen = pinned
        elif beat.get("archetype") in _TEXTLESS_ARCHETYPES:
            continue  # no text layer — leave to the editor's legacy path
        else:
            pool = [
                i for i in _TYPE_INTENT_POOLS.get(beat.get("type"), [])
                if _gate_ok(i, beat)
            ]
            if pool:
                offset = _rotation_offset(beat, index) % len(pool)
                rotated = pool[offset:] + pool[:offset]
                blocked = run_val if run_len >= _MAX_CONSECUTIVE_INTENT else None
                chosen = next((i for i in rotated if i != blocked), rotated[0])
            else:
                chosen = _ARCHETYPE_TO_INTENT.get(
                    beat.get("archetype", "text_over_dimmed")
                )

        if not chosen:
            continue
        beat["text_intent"] = chosen
        run_val, run_len = (
            (chosen, run_len + 1) if chosen == run_val else (chosen, 1)
        )


def normalise_text_intent(beat: dict) -> None:
    """Drop an invalid text_intent so a bad upstream value never reaches the
    editor. Mirror of llm.py::_normalise_schema's archetype validation; call it
    from there for defence in depth."""
    if beat.get("text_intent") is not None and beat["text_intent"] not in TEXT_INTENTS:
        beat.pop("text_intent", None)

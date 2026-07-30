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
WHY THERE IS A DIVERSIFICATION PASS HERE (the "every video looks the same" fix)
────────────────────────────────────────────────────────────────────
The original single-beat mapping could not produce variety, for two reasons:

  1. `_ALLOWED["type"]` in llm.py is {hook, insight, tension, truth, flip,
     climax, payoff, cta}. Only hook/truth/payoff/cta had entries in
     `_TYPE_TO_INTENT`, so insight/tension/flip/climax — the BULK of every
     script — fell through to `_ARCHETYPE_TO_INTENT`, and since
     assign_composition caps diversification at `n_beats // 3`, most of those
     beats are still "text_over_dimmed" → "caption" → the `word-caption`
     representation. Majority-one-representation was structural, not bad luck.
  2. The quote/stat/definition/list/question/dialogue keys (and the P4 ones)
     are types the LLM CANNOT emit — they aren't in `_ALLOWED["type"]`, so
     `_normalise_schema` rejects them. Half the table was dead code.

So the per-type mapping is now a POOL of intents per type, and the pass below
rotates through each pool deterministically with a max-consecutive guard.
Crucially the rotation is CONTENT-GATED: an intent whose representation needs
a field the beat doesn't carry (`list` needs items, `definition` needs a term,
`stat` needs a numeral, `quote` needs quoted text/attribution) is filtered out
before rotation, because the editor's selector drops a representation whose
required `fields` are missing — assigning `list` to a beat with no items just
falls back to `word-caption` and looks like the bug never got fixed.
"""

from __future__ import annotations

import hashlib
import re

# Must stay in sync with TextIntent in text/types.ts.
# NOTE: "meta" is NOT in the TS union today — intentOf() will drop it and fall
# back to the legacy mapping until types.ts adds it. Kept out of the rotation
# pools below for that reason.
TEXT_INTENTS = {
    "caption", "title", "quote", "stat", "definition", "list",
    "dialogue", "warning", "comparison", "qa", "timeline", "takeaway",
    "lower_third", "emphasis",
    "meta",  # meta-chips (P4) — pending types.ts
}

# ── Content gates ───────────────────────────────────────────────────────────
# An intent may only be assigned to a beat that carries what its representation
# reads. Mirrors the `fields` declarations in text/representations/*.ts.

_NUMERAL = re.compile(r"\d")
_QUOTED = re.compile(r"[\"“”'‘’]")


def _beat_text(beat: dict) -> str:
    return " ".join(
        str(beat.get(k) or "") for k in ("text", "body", "keyword", "term")
    )


def _has_items(beat: dict) -> bool:
    items = beat.get("items")
    return isinstance(items, (list, tuple)) and len(items) >= 2


def _gate_ok(intent: str, beat: dict) -> bool:
    """True when this beat carries the fields `intent`'s representation needs."""
    text = _beat_text(beat)
    if intent == "list":
        return _has_items(beat)
    if intent == "definition":
        return bool((beat.get("term") or beat.get("keyword")) and beat.get("body"))
    if intent == "stat":
        return bool(_NUMERAL.search(text))
    if intent == "quote":
        return bool(beat.get("attribution")) or bool(_QUOTED.search(text))
    if intent == "qa":
        return "?" in text
    if intent == "dialogue":
        return _has_items(beat) or bool(beat.get("attribution"))
    if intent == "comparison":
        # comparison-labels scores 0 unless the beat is actually COMPOSED as a
        # comparison (see comparison-labels.ts) — never assign it otherwise.
        return beat.get("archetype") in ("comparison", "split_screen")
    if intent == "lower_third":
        return bool(beat.get("keyword") or beat.get("brand"))
    return True  # caption / title / emphasis / takeaway / warning / timeline


# ── Per-type intent POOLS (was: one intent per type) ────────────────────────
# Ordered by preference. The rotation walks the pool, skipping gated-out and
# consecutively-repeated intents. Every pool ends in a field-free intent so a
# beat always has at least one legal option.
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
    btype = beat.get("type")
    for intent in _TYPE_INTENT_POOLS.get(btype, []):
        if _gate_ok(intent, beat):
            return intent
    return _ARCHETYPE_TO_INTENT.get(beat.get("archetype", "text_over_dimmed"))


def assign_text_intent(beats: list[dict]) -> None:
    """In place: stamp a VARIED `text_intent` on every beat that doesn't already
    carry a valid one. Purely additive — safe to call unconditionally. Call it
    right after assign_composition() in generate_script (composition first, so
    the archetype hints see the final archetypes).

    Per beat: pinned intents win; otherwise the beat's type pool is filtered by
    content gates, rotated by a deterministic per-beat offset, and the first
    candidate that wouldn't extend a run past `_MAX_CONSECUTIVE_INTENT` is
    taken. A beat whose pool is entirely gated out keeps the archetype hint."""
    run_val: str | None = None
    run_len = 0

    for index, beat in enumerate(beats):
        pinned = _pinned_intent(beat)
        if pinned:
            chosen = pinned
        else:
            pool = [
                i for i in _TYPE_INTENT_POOLS.get(beat.get("type"), [])
                if _gate_ok(i, beat)
            ]
            if pool:
                offset = _rotation_offset(beat, index) % len(pool)
                rotated = pool[offset:] + pool[:offset]
                blocked = run_val if run_len >= _MAX_CONSECUTIVE_INTENT else None
                chosen = next(
                    (i for i in rotated if i != blocked),
                    rotated[0],
                )
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

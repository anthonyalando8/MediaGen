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
called after the script is parsed. It never calls a model — a later upgrade can
replace `assign_text_intent` with an Ollama call that picks from the editor's
registry names without changing the enforcement guarantee.
"""

from __future__ import annotations

# Must stay in sync with TextIntent in text/types.ts.
TEXT_INTENTS = {
    "caption", "title", "quote", "stat", "definition", "list",
    "dialogue", "warning", "comparison", "qa", "timeline", "takeaway",
    "lower_third", "emphasis",
}

# Rhetorical beat `type` (the LLM already emits this) → default text_intent,
# in priority order. Mirrors _ARCHETYPE_TYPE_AFFINITY's shape in llm.py.
_TYPE_TO_INTENT = {
    "quote": "quote",
    "truth": "comparison",
    "stat": "stat",
    "statistic": "stat",
    "definition": "definition",
    "list": "list",
    "steps": "list",
    "payoff": "takeaway",
    "takeaway": "takeaway",
    "warning": "warning",
    "question": "qa",
    "dialogue": "dialogue",
    "hook": "emphasis",
    "cta": "emphasis",
    "title": "title",
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
# take priority over the type→intent mapping below.
_STRUCTURED_ARCHETYPE_INTENT = {
    "definition_card": "definition",
    "list_card": "list",
    "dialogue_card": "dialogue",
}


def _intent_for_beat(beat: dict) -> str | None:
    """Deterministic single-beat mapping. Returns None to leave the beat
    unstamped (editor uses its legacy mapping)."""
    if beat.get("text_intent") in TEXT_INTENTS:
        return beat["text_intent"]  # already set upstream — respect it

    archetype = beat.get("archetype", "text_over_dimmed")
    if archetype in _STRUCTURED_ARCHETYPE_INTENT:
        return _STRUCTURED_ARCHETYPE_INTENT[archetype]

    if btype in _TYPE_TO_INTENT:
        return _TYPE_TO_INTENT[btype]

    return _ARCHETYPE_TO_INTENT.get(archetype)


def assign_text_intent(beats: list[dict]) -> None:
    """In place: stamp `text_intent` on every beat that doesn't already carry a
    valid one. Purely additive — safe to call unconditionally. Call it right
    after assign_composition() in generate_script (composition first so the
    archetype fallback sees the final archetype)."""
    for beat in beats:
        intent = _intent_for_beat(beat)
        if intent:
            beat["text_intent"] = intent


def normalise_text_intent(beat: dict) -> None:
    """Drop an invalid text_intent so a bad upstream value never reaches the
    editor. Mirror of llm.py::_normalise_schema's archetype validation; call it
    from there for defence in depth."""
    if beat.get("text_intent") is not None and beat["text_intent"] not in TEXT_INTENTS:
        beat.pop("text_intent", None)

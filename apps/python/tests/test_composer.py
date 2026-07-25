"""
Tests for llm.py's scene/3.0 composer pass (`assign_composition` and its
`_diversification_budget`/`_candidates_for`/`_stable_pick` helpers).

Regression coverage for the bug where diversification was capped at
`min_archetypes - 1` beats no matter how long the script was (a 6-beat and a
36-beat script both got ~2 diversified beats) — see
docs/architecture/ for the write-up. Stdlib `unittest` only, no network/LLM.

Run from apps/python/:  python -m unittest tests.test_composer -v
"""
from __future__ import annotations
import copy
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

import llm  # noqa: E402
from formats import ValidationProfile  # noqa: E402


def _beats(types: list[str]) -> list[dict]:
    """Beat fixtures with distinct text (so _stable_pick's hash varies)."""
    return [
        {"id": f"beat_{i:02d}", "type": t, "text": f"beat text {i} about {t}", "keyword": f"KW{i}"}
        for i, t in enumerate(types)
    ]


def _same_text_beats(types: list[str]) -> list[dict]:
    """Beat fixtures sharing identical text — forces _stable_pick to return
    the SAME candidate for every beat of the same type, so a long run of
    identical types deterministically produces a long run of one archetype
    (used to exercise the max_consecutive_archetype revert pass)."""
    return [{"id": f"beat_{i:02d}", "type": t, "text": "same text", "keyword": "KW"} for i, t in enumerate(types)]


def _profile(min_archetypes: int, max_consecutive_archetype: int = 0) -> ValidationProfile:
    return ValidationProfile(variety={
        "min_archetypes": min_archetypes,
        "max_consecutive_archetype": max_consecutive_archetype,
    })


def _diversified_count(beats: list[dict]) -> int:
    return sum(1 for b in beats if b.get("archetype", "text_over_dimmed") != "text_over_dimmed")


def _max_nondefault_run(beats: list[dict]) -> int:
    """Longest run of the SAME non-default archetype. `text_over_dimmed`
    itself is intentionally exempt from the run cap — reverting an overflow
    run back to `text_over_dimmed` is a no-op when it's already
    `text_over_dimmed`, so long default stretches (the majority, by design)
    are expected and fine; only a repeating flashy archetype is capped."""
    best = run = 0
    prev = None
    for b in beats:
        a = b.get("archetype", "text_over_dimmed")
        if a == "text_over_dimmed":
            prev, run = None, 0
            continue
        run = run + 1 if a == prev else 1
        prev = a
        best = max(best, run)
    return best


class TestArchetypeRegistryPartition(unittest.TestCase):
    def test_text_bearing_and_textless_partition_allowed_archetypes(self):
        union = llm._TEXT_BEARING_ARCHETYPES | llm._TEXTLESS_ARCHETYPES
        self.assertEqual(union, llm._ALLOWED_ARCHETYPES)
        self.assertEqual(llm._TEXT_BEARING_ARCHETYPES & llm._TEXTLESS_ARCHETYPES, set())


class TestDiversificationBudget(unittest.TestCase):
    def test_worked_examples(self):
        # (n_beats, min_archetypes) -> expected budget, per the 4 real formats.
        cases = [
            (6, 3, 2),    # shortform_tiktok — unchanged from the old fixed cap
            (10, 3, 3),   # explainer_1min
            (26, 3, 8),   # explainer_5min — the script that exposed the bug
            (8, 2, 2),    # listicle
        ]
        for n_beats, min_archetypes, expected in cases:
            with self.subTest(n_beats=n_beats, min_archetypes=min_archetypes):
                self.assertEqual(llm._diversification_budget(n_beats, min_archetypes), expected)

    def test_min_archetypes_le_1_gives_zero_budget(self):
        self.assertEqual(llm._diversification_budget(26, 1), 0)
        self.assertEqual(llm._diversification_budget(26, 0), 0)


class TestAssignComposition(unittest.TestCase):
    def test_noop_when_variety_empty(self):
        """calm_narrative's `variety: {}` convention: beats must come back
        with no `archetype` key touched at all."""
        beats = _beats(["hook", "insight", "insight", "tension", "payoff", "insight"])
        data = {"beats": copy.deepcopy(beats)}
        out = llm.assign_composition(data, _profile(min_archetypes=0))
        for b in out["beats"]:
            self.assertNotIn("archetype", b)

    def test_all_insight_beats_only_get_text_bearing_archetypes(self):
        """The core safety property: content-carrying beats never lose their
        caption to a textless archetype, even under a large budget."""
        types = ["insight"] * 20
        data = {"beats": _beats(types)}
        out = llm.assign_composition(data, _profile(min_archetypes=3, max_consecutive_archetype=0))
        diversified = [b for b in out["beats"] if b.get("archetype", "text_over_dimmed") != "text_over_dimmed"]
        self.assertGreater(len(diversified), 0)
        for b in diversified:
            self.assertIn(b["archetype"], llm._TEXT_BEARING_ARCHETYPES)

    def test_mixed_structural_types_can_go_textless(self):
        types = ["hook", "tension", "climax", "flip", "payoff"] + ["insight"] * 10
        data = {"beats": _beats(types)}
        out = llm.assign_composition(data, _profile(min_archetypes=3, max_consecutive_archetype=0))
        archetypes = {b.get("archetype", "text_over_dimmed") for b in out["beats"]}
        self.assertTrue(archetypes & llm._TEXTLESS_ARCHETYPES)

    def test_diversification_scales_with_length(self):
        """Pins the actual bug: same type-mix ratio, constant min_archetypes,
        more beats -> strictly more diversified beats (old code: always ~2)."""
        pattern = ["hook", "insight", "tension", "insight", "payoff", "insight", "truth", "insight"]
        short = _beats((pattern * 1)[:6])
        long = _beats((pattern * 4)[:26])

        out_short = llm.assign_composition({"beats": short}, _profile(min_archetypes=3, max_consecutive_archetype=0))
        out_long = llm.assign_composition({"beats": long}, _profile(min_archetypes=3, max_consecutive_archetype=0))

        self.assertGreater(_diversified_count(out_long["beats"]), _diversified_count(out_short["beats"]))

    def test_listicle_looser_than_explainer_at_same_length(self):
        # n=20 so the two budgets land on different sides of the `n // 3`
        # ceiling (at small n both formats' budgets collapse to the same
        # cap-bound value, which wouldn't distinguish them).
        pattern = (["hook", "insight", "tension", "insight", "payoff", "insight", "truth", "insight"] * 3)[:20]
        beats_a = _beats(pattern)
        beats_b = _beats(pattern)

        out_listicle = llm.assign_composition({"beats": beats_a}, _profile(min_archetypes=2, max_consecutive_archetype=3))
        out_explainer = llm.assign_composition({"beats": beats_b}, _profile(min_archetypes=3, max_consecutive_archetype=3))

        self.assertLess(_diversified_count(out_listicle["beats"]), _diversified_count(out_explainer["beats"]))

    def test_all_cta_beats_stay_default_no_exception(self):
        """`cta` matches nothing in _ARCHETYPE_TYPE_AFFINITY today — must be
        a safe no-op, not a crash."""
        data = {"beats": _beats(["cta"] * 8)}
        out = llm.assign_composition(data, _profile(min_archetypes=3, max_consecutive_archetype=2))
        for b in out["beats"]:
            self.assertEqual(b.get("archetype", "text_over_dimmed"), "text_over_dimmed")

    def test_max_consecutive_archetype_enforced(self):
        """Identical beat text forces _stable_pick to repeat the same
        archetype; the post-pass must still cap the run length."""
        types = ["insight"] * 12
        data = {"beats": _same_text_beats(types)}
        out = llm.assign_composition(data, _profile(min_archetypes=3, max_consecutive_archetype=2))
        self.assertLessEqual(_max_nondefault_run(out["beats"]), 2)

    def test_deterministic(self):
        types = ["hook", "insight", "tension", "insight", "payoff", "insight", "truth", "insight", "insight", "cta"]
        data_a = {"beats": _beats(types)}
        data_b = {"beats": copy.deepcopy(data_a["beats"])}
        out_a = llm.assign_composition(data_a, _profile(min_archetypes=3, max_consecutive_archetype=2))
        out_b = llm.assign_composition(data_b, _profile(min_archetypes=3, max_consecutive_archetype=2))
        self.assertEqual(
            [b.get("archetype", "text_over_dimmed") for b in out_a["beats"]],
            [b.get("archetype", "text_over_dimmed") for b in out_b["beats"]],
        )

    def test_real_explainer_5min_script_stays_majority_text_over_dimmed(self):
        """Reproduces the exact beat-type sequence from
        workspace/runs/028_cc441605/script.json (the video the user reviewed)."""
        types = (
            ["hook", "insight", "tension", "payoff"]
            + ["insight"] * 11
            + ["payoff"]
            + ["insight"] * 5
            + ["payoff", "truth"]
            + ["insight"] * 2
            + ["cta"]
        )
        self.assertEqual(len(types), 26)
        data = {"beats": _beats(types)}
        out = llm.assign_composition(data, _profile(min_archetypes=3, max_consecutive_archetype=3))

        diversified = _diversified_count(out["beats"])
        self.assertEqual(diversified, 8)  # matches the worked _diversification_budget example
        self.assertGreaterEqual(26 - diversified, 18)  # text_over_dimmed stays the clear plurality

        for b, t in zip(out["beats"], types):
            if t in llm._CONTENT_CARRYING_TYPES:
                self.assertIn(b.get("archetype", "text_over_dimmed"), llm._TEXT_BEARING_ARCHETYPES)


if __name__ == "__main__":
    unittest.main()

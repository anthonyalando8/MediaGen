"""
Tests for the "audio outlasts visual, video freezes on its last frame" fix:

- scene_export.py's _sequential_cut_windows / the archetypes that opt into it
  above _SEQUENTIAL_CUT_THRESHOLD_MS (bare_visual, full_bleed_video), plus a
  regression check that broll_montage's own output didn't change when its
  windowing math was extracted into the shared helper.
- media_resolve.py's duration-fit scoring bonus for video candidates.

Stdlib `unittest` only. Run from apps/python/:
  python -m unittest tests.test_visual_duration_fit -v
"""
from __future__ import annotations
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

import scene_export  # noqa: E402
import media_resolve  # noqa: E402


class TestSequentialCutWindows(unittest.TestCase):
    def test_windows_are_contiguous_and_cover_full_duration(self):
        for duration_ms in (3000, 4000, 8000, 12000, 20000):
            with self.subTest(duration_ms=duration_ms):
                windows = scene_export._sequential_cut_windows(duration_ms)
                self.assertEqual(windows[0][0], 0)
                self.assertEqual(windows[-1][1], duration_ms)
                for (_, end_a), (start_b, _) in zip(windows, windows[1:]):
                    self.assertEqual(end_a, start_b)

    def test_cut_count_tiers_match_broll_montage_original_thresholds(self):
        self.assertEqual(len(scene_export._sequential_cut_windows(3000)), 3)
        self.assertEqual(len(scene_export._sequential_cut_windows(4000)), 4)
        self.assertEqual(len(scene_export._sequential_cut_windows(8000)), 5)


class TestBareVisualAndFullBleedVideo(unittest.TestCase):
    def test_bare_visual_below_threshold_is_a_single_held_layer(self):
        layers = scene_export._synthesize_bare_visual_layers({"duration_ms": 4000, "visual_query": "q", "camera": "push_in"})
        self.assertEqual(len(layers), 1)
        self.assertEqual(layers[0]["in"], 0)
        self.assertIsNone(layers[0]["out"])
        self.assertIn("animation", layers[0])

    def test_bare_visual_at_threshold_splits_into_sequential_cuts(self):
        layers = scene_export._synthesize_bare_visual_layers({"duration_ms": scene_export._SEQUENTIAL_CUT_THRESHOLD_MS, "visual_query": "q"})
        self.assertGreater(len(layers), 1)
        self.assertEqual(layers[0]["in"], 0)
        self.assertEqual(layers[-1]["out"], scene_export._SEQUENTIAL_CUT_THRESHOLD_MS)
        for layer in layers:
            self.assertEqual(layer["role"], "background")
            self.assertEqual(layer["source"]["query"], "q")
            self.assertNotIn("animation", layer)

    def test_full_bleed_video_keeps_video_kind_flag_on_every_cut(self):
        layers = scene_export._synthesize_full_bleed_video_layers({"duration_ms": 9000, "visual_query": "q"})
        self.assertGreater(len(layers), 1)
        for layer in layers:
            self.assertEqual(layer["source"]["kind"], "video")

    def test_full_bleed_video_below_threshold_still_single_layer_with_video_kind(self):
        layers = scene_export._synthesize_full_bleed_video_layers({"duration_ms": 3000, "visual_query": "q"})
        self.assertEqual(len(layers), 1)
        self.assertEqual(layers[0]["source"]["kind"], "video")
        self.assertIsNone(layers[0]["out"])


class TestBrollMontageUnchangedAfterRefactor(unittest.TestCase):
    """The windowing math moved into _sequential_cut_windows; broll_montage's
    own output must be byte-for-byte identical to before the extraction."""

    def test_matches_the_original_inline_formula(self):
        for duration_ms in (2000, 3500, 4999, 5000, 15000):
            with self.subTest(duration_ms=duration_ms):
                contract = {"duration_ms": duration_ms, "visual_query": "q", "keyword": "K"}
                got = scene_export._synthesize_broll_montage_layers(contract)

                n_cuts = 3 if duration_ms < 3500 else (4 if duration_ms < 5000 else 5)
                slice_ms = duration_ms // n_cuts
                expected = []
                for i in range(n_cuts):
                    start = i * slice_ms
                    end = duration_ms if i == n_cuts - 1 else (i + 1) * slice_ms
                    expected.append({"role": "background", "source": {"query": "q"}, "fit": "cover", "in": start, "out": end})
                self.assertEqual(got, expected)


class TestVideoDurationFitScoring(unittest.TestCase):
    def test_candidate_covering_the_window_scores_higher_than_a_short_one(self):
        long_score = media_resolve._score_candidate({"gym"}, "gym workout", "", None, None, True,
                                                      duration_ms=10000, min_duration_ms=8000)
        short_score = media_resolve._score_candidate({"gym"}, "gym workout", "", None, None, True,
                                                       duration_ms=3000, min_duration_ms=8000)
        self.assertGreater(long_score, short_score)

    def test_no_min_duration_ms_is_a_complete_noop(self):
        with_none = media_resolve._score_candidate({"gym"}, "gym workout", "", None, None, True, duration_ms=3000, min_duration_ms=None)
        without_duration_at_all = media_resolve._score_candidate({"gym"}, "gym workout", "", None, None, True)
        self.assertEqual(with_none, without_duration_at_all)

    def test_image_candidates_unaffected_no_duration_field(self):
        # Images never carry duration_ms — passing min_duration_ms must not
        # crash or alter their score when duration_ms is None.
        score = media_resolve._score_candidate({"gym"}, "gym workout", "", None, None, True,
                                                 duration_ms=None, min_duration_ms=8000)
        baseline = media_resolve._score_candidate({"gym"}, "gym workout", "", None, None, True)
        self.assertEqual(score, baseline)

    def test_best_candidate_prefers_long_enough_clip_over_higher_relevance_short_clip(self):
        candidates = [
            {"id": "short", "url": "u1", "text": "gym workout intense", "tags": "", "duration_ms": 2000},
            {"id": "long", "url": "u2", "text": "gym workout", "tags": "", "duration_ms": 9000},
        ]
        best, _ = media_resolve._best_candidate(candidates, {"gym", "workout"}, True, min_duration_ms=8000)
        self.assertEqual(best["id"], "long")


if __name__ == "__main__":
    unittest.main()

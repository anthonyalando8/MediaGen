"""
Tests for server.py's media-plan override helpers: Piece D (request-level
mode/orientation override) and Piece B (script-driven mood override).

Stdlib `unittest` only. Run from apps/python/:
  python -m unittest tests.test_media_plan_overrides -v
"""
from __future__ import annotations
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

import server  # noqa: E402
from formats import MediaPlan  # noqa: E402


class TestMediaRequestOverrides(unittest.TestCase):
    def test_no_overrides_returns_the_same_format_media_unchanged(self):
        base = MediaPlan(mode="hybrid", orientation="portrait", mood=["a"])
        out = server._apply_media_request_overrides(base, None, None)
        self.assertEqual(out, base)

    def test_mode_override_only(self):
        base = MediaPlan(mode="hybrid", orientation="portrait")
        out = server._apply_media_request_overrides(base, "video", None)
        self.assertEqual(out.mode, "video")
        self.assertEqual(out.orientation, "portrait")  # untouched

    def test_orientation_override_only(self):
        base = MediaPlan(mode="hybrid", orientation="portrait")
        out = server._apply_media_request_overrides(base, None, "landscape")
        self.assertEqual(out.orientation, "landscape")
        self.assertEqual(out.mode, "hybrid")  # untouched

    def test_both_overrides_together(self):
        base = MediaPlan(mode="hybrid", orientation="portrait")
        out = server._apply_media_request_overrides(base, "image", "square")
        self.assertEqual(out.mode, "image")
        self.assertEqual(out.orientation, "square")


class TestScriptMoodOverride(unittest.TestCase):
    def test_script_music_mood_overrides_the_static_format_mood(self):
        base = MediaPlan(mood=["commercial", "energetic", "upbeat"])
        out = server._apply_script_mood_override(base, {"global": {"music_mood": "minimal"}})
        self.assertEqual(out.mood, ["minimal"])

    def test_missing_music_mood_falls_back_to_format_mood_unchanged(self):
        base = MediaPlan(mood=["commercial", "energetic", "upbeat"])
        out = server._apply_script_mood_override(base, {"global": {}})
        self.assertEqual(out.mood, base.mood)

    def test_missing_global_key_entirely_is_safe(self):
        base = MediaPlan(mood=["commercial"])
        out = server._apply_script_mood_override(base, {})
        self.assertEqual(out.mood, base.mood)


if __name__ == "__main__":
    unittest.main()

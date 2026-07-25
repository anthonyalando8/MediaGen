"""
Tests for the "Ad" format's three new pieces: the poster_card archetype
(scene_export.py), silent/music-only beats (tts.py's synthesize loop +
llm.py's validation relaxation).

Stdlib `unittest` only. Run from apps/python/:
  python -m unittest tests.test_ad_commercial -v
"""
from __future__ import annotations
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

import scene_export  # noqa: E402
import llm  # noqa: E402
import tts  # noqa: E402
from formats import ValidationProfile  # noqa: E402


class TestPosterCardLayers(unittest.TestCase):
    def test_headline_and_subtext_layers(self):
        contract = {"duration_ms": 3000, "visual_query": "coffee beans", "keyword": "MEET AURA", "body": "Fresh, delivered weekly."}
        layers = scene_export._synthesize_poster_card_layers(contract)

        roles = [l["role"] for l in layers]
        self.assertEqual(roles, ["background", "scrim", "text", "text"])
        texts = [l for l in layers if l["role"] == "text"]
        self.assertEqual(texts[0]["text"], "MEET AURA")
        self.assertEqual(texts[0]["size"], "hero")
        self.assertEqual(texts[1]["text"], "Fresh, delivered weekly.")
        self.assertEqual(texts[1]["size"], "normal")
        # Headline sits above the subtext.
        self.assertLess(texts[0]["anchor_y"], texts[1]["anchor_y"])

    def test_missing_subtext_omits_that_layer(self):
        contract = {"duration_ms": 3000, "visual_query": "q", "keyword": "HEADLINE ONLY", "body": ""}
        layers = scene_export._synthesize_poster_card_layers(contract)
        self.assertEqual([l["role"] for l in layers], ["background", "scrim", "text"])

    def test_registered_in_archetype_sets(self):
        self.assertIn("poster_card", llm._ALLOWED_ARCHETYPES)
        self.assertIn("poster_card", llm._TEXT_BEARING_ARCHETYPES)
        self.assertIn("poster_card", scene_export._ARCHETYPE_SYNTHESIZERS)
        # The text/textless partition test in test_composer.py already
        # verifies TEXT_BEARING | TEXTLESS == ALLOWED for the whole set.


class FakeKokoro:
    """Records calls instead of doing real inference — no model files needed."""
    def __init__(self):
        self.create_calls: list[tuple] = []

    def create(self, text, voice, speed, lang):
        self.create_calls.append((text, voice, speed, lang))
        return np.full(2400, 0.5, dtype=np.float32), 24000  # nonzero "spoken" marker


class TestSilentBeatTTS(unittest.TestCase):
    def _script(self, beats):
        return {"global": {}, "beats": beats}

    def test_silent_beat_produces_real_silence_no_kokoro_call(self):
        fake = FakeKokoro()
        beats = [
            {"id": "beat_01", "type": "hook", "keyword": "K1", "text": "a spoken line with a reasonable number of words in it", "pace": "mid"},
            {"id": "beat_02", "type": "payoff", "keyword": "REVEAL", "text": "", "silent": True, "silent_duration_s": 1.0},
        ]
        with patch.object(tts, "get_kokoro", return_value=fake):
            with tempfile.TemporaryDirectory() as td:
                out_dir = pathlib.Path(td)
                voice_path, beat_paths = tts.synthesize(self._script(beats), out_dir, sample_rate=24000)

                self.assertEqual(len(beat_paths), 2)
                # Kokoro was called exactly once — only for the non-silent beat.
                self.assertEqual(len(fake.create_calls), 1)

                samples, sr = sf.read(str(beat_paths[1]))
                self.assertTrue(np.allclose(samples, 0.0))
                self.assertAlmostEqual(len(samples) / sr, 1.0, places=2)

    def test_silent_beat_defaults_to_module_constant_duration(self):
        fake = FakeKokoro()
        beats = [{"id": "beat_01", "type": "payoff", "keyword": "K", "text": "", "silent": True}]
        with patch.object(tts, "get_kokoro", return_value=fake):
            with tempfile.TemporaryDirectory() as td:
                out_dir = pathlib.Path(td)
                _, beat_paths = tts.synthesize(self._script(beats), out_dir, sample_rate=24000)
                samples, sr = sf.read(str(beat_paths[0]))
                self.assertAlmostEqual(len(samples) / sr, tts._SILENT_BEAT_DEFAULT_S, places=2)

    def test_non_silent_beat_unaffected_normal_path(self):
        fake = FakeKokoro()
        beats = [{"id": "beat_01", "type": "hook", "keyword": "K", "text": "a perfectly normal spoken beat with plenty of words", "pace": "fast"}]
        with patch.object(tts, "get_kokoro", return_value=fake):
            with tempfile.TemporaryDirectory() as td:
                out_dir = pathlib.Path(td)
                tts.synthesize(self._script(beats), out_dir, sample_rate=24000)
                self.assertEqual(len(fake.create_calls), 1)
                # speed multiplier for "fast" pace was actually applied
                _, _, speed, _ = fake.create_calls[0]
                self.assertNotEqual(speed, 1.0)


class TestSilentBeatValidation(unittest.TestCase):
    def _profile(self):
        return ValidationProfile(beats_min=1, beats_max=10, words_per_beat_min=10, words_per_beat_max=25,
                                  total_words_min=0, total_words_max=None)

    def test_silent_beat_with_no_text_passes(self):
        data = {"title": "T", "beats": [
            {"id": "b1", "type": "hook", "keyword": "K1", "text": "a spoken line with a reasonable number of words in it"},
            {"id": "b2", "type": "payoff", "keyword": "REVEAL", "silent": True},
        ]}
        llm._validate_basic(data, self._profile())  # must not raise

    def test_same_beat_without_silent_flag_still_rejected(self):
        data = {"title": "T", "beats": [
            {"id": "b1", "type": "hook", "keyword": "K1", "text": "a spoken line with a reasonable number of words in it"},
            {"id": "b2", "type": "payoff", "keyword": "REVEAL"},  # no text, not silent
        ]}
        with self.assertRaises(KeyError):
            llm._validate_basic(data, self._profile())

    def test_total_word_count_ignores_silent_beats(self):
        data = {"title": "T", "beats": [
            {"id": "b1", "type": "hook", "keyword": "K1", "text": "a spoken line with a reasonable number of words here"},
            {"id": "b2", "type": "payoff", "keyword": "REVEAL", "text": "", "silent": True},
        ]}
        # Must not raise KeyError/TypeError summing a silent beat's absent/empty text.
        llm._validate_basic(data, self._profile())


if __name__ == "__main__":
    unittest.main()

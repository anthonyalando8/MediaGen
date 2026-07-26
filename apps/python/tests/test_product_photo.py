"""
Tests for Piece A: a user-supplied product photo replaces stock search for
poster_card beats' background only, and is a no-op (byte-for-byte today's
behavior) when no product photo is supplied.

Stdlib `unittest` only. Run from apps/python/:
  python -m unittest tests.test_product_photo -v
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
from formats import VisualProfile, MediaPlan  # noqa: E402

_FAKE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def _fixture_script():
    return {
        "title": "T", "style": "cinematic",
        "global": {"theme": "tech_blue", "voice_style": "calm_intense", "subject": "widget"},
        "beats": [
            {"id": "beat_01", "type": "hook", "keyword": "PROBLEM", "text": "a spoken hook line with enough words to be realistic",
             "pace": "mid", "intensity": 0.7, "visual_query": "person frustrated desk", "archetype": "text_over_dimmed"},
            {"id": "beat_02", "type": "payoff", "keyword": "MEET WIDGET", "text": "the reveal", "silent": True,
             "pace": "slow", "intensity": 0.5, "visual_query": "widget product shot", "archetype": "poster_card"},
        ],
    }


def _write_beat_wavs(n: int, out_dir: pathlib.Path) -> list[pathlib.Path]:
    paths = []
    for i in range(n):
        p = out_dir / f"beat_{i}.wav"
        sf.write(str(p), np.zeros(2400, dtype=np.float32), 24000)
        paths.append(p)
    return paths


class TestProductPhotoOverride(unittest.TestCase):
    def _cfg(self):
        return {"video": {"width": 1080, "height": 1920, "fps": 30}, "brand": {"name": "Test"}}

    def test_poster_card_beat_uses_product_photo_no_stock_search(self):
        script = _fixture_script()

        def _explode(*a, **k):
            raise AssertionError("resolve_visual should NOT be called for the poster_card beat's background")

        with tempfile.TemporaryDirectory() as td:
            out_dir = pathlib.Path(td)
            beat_wavs = _write_beat_wavs(2, out_dir)
            # Only patch resolve_visual for calls whose query matches the
            # poster beat; the hook beat still needs real resolution mocked
            # too since this is a fully offline test (no network).
            with patch.object(scene_export, "resolve_visual") as mock_resolve, \
                 patch.object(scene_export, "download_as_data_url", return_value={"url": "data:image/jpeg;base64,AA=="}):
                def _resolve_side_effect(query, **kwargs):
                    if "widget product shot" in query:
                        _explode()
                    return {"kind": "image", "url": "http://example.com/x.jpg", "id": "stock:1", "relevance": 0.8, "query": query}
                mock_resolve.side_effect = _resolve_side_effect

                scene_path = scene_export.build_scene(
                    script, out_dir, self._cfg(),
                    beat_durations_ms=[3000, 2500], beat_wavs=beat_wavs,
                    resolve_visuals=True,
                    visual_profile=VisualProfile(), media_plan=MediaPlan(orientation="portrait"),
                    product_image_data_url=_FAKE_DATA_URL,
                )
                import json
                scene = json.loads(scene_path.read_text(encoding="utf-8"))

                poster_beat = scene["beats"][1]
                poster_layers = poster_beat["layers"]
                bg_layer = next(l for l in poster_layers if l["role"] == "background")
                self.assertEqual(bg_layer["asset_id"], "product_photo")
                self.assertEqual(bg_layer["kind"], "image")

                product_assets = [a for a in scene["assets"] if a["id"] == "product_photo"]
                self.assertEqual(len(product_assets), 1)
                self.assertEqual(product_assets[0]["url"], _FAKE_DATA_URL)

                # The non-poster (hook) beat still went through normal stock resolution.
                self.assertTrue(mock_resolve.called)

    def test_no_product_photo_is_byte_for_byte_unchanged(self):
        script = _fixture_script()
        with tempfile.TemporaryDirectory() as td:
            out_dir = pathlib.Path(td)
            beat_wavs = _write_beat_wavs(2, out_dir)
            with patch.object(scene_export, "resolve_visual") as mock_resolve, \
                 patch.object(scene_export, "download_as_data_url", return_value={"url": "data:image/jpeg;base64,AA=="}):
                mock_resolve.return_value = {"kind": "image", "url": "http://example.com/x.jpg", "id": "stock:1", "relevance": 0.8, "query": "q"}

                scene_path = scene_export.build_scene(
                    script, out_dir, self._cfg(),
                    beat_durations_ms=[3000, 2500], beat_wavs=beat_wavs,
                    resolve_visuals=True,
                    visual_profile=VisualProfile(), media_plan=MediaPlan(orientation="portrait"),
                    # product_image_data_url omitted entirely
                )
                import json
                scene = json.loads(scene_path.read_text(encoding="utf-8"))
                self.assertFalse(any(a["id"] == "product_photo" for a in scene["assets"]))
                poster_beat = scene["beats"][1]
                bg_layer = next(l for l in poster_beat["layers"] if l["role"] == "background")
                self.assertNotEqual(bg_layer.get("asset_id"), "product_photo")
                # Stock resolution WAS attempted for the poster beat's background too.
                queries = [c.kwargs.get("query", c.args[0] if c.args else None) for c in mock_resolve.call_args_list]
                self.assertTrue(any("widget product shot" in (q or "") for q in queries))


if __name__ == "__main__":
    unittest.main()

"""
Tests for generation.py's provider selection/fallback and its isolation from
llm.py. Stdlib `unittest` only — no new test dependency.

Run from apps/python/:  python -m unittest tests.test_generation -v
"""
from __future__ import annotations
import json
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

import generation  # noqa: E402
from providers.base import Provider  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# Fakes
# ─────────────────────────────────────────────────────────────────────────────
class FakeProvider(Provider):
    """A Provider whose `generate` either returns a fixed string or raises,
    and records how many times it was called."""

    def __init__(self, cfg=None, *, result: str | None = None, error: Exception | None = None):
        super().__init__(cfg or {})
        self._result = result
        self._error = error
        self.calls = 0

    def generate(self, prompt: str) -> str:
        self.calls += 1
        if self._error is not None:
            raise self._error
        return self._result


# ─────────────────────────────────────────────────────────────────────────────
# Config resolution — pure functions, no disk I/O
# ─────────────────────────────────────────────────────────────────────────────
class TestResolveProviderConfigs(unittest.TestCase):
    def test_backcompat_flat_model_maps_to_ollama(self):
        """Today's config.yaml shape: `llm: { model: X }`, no `providers` key
        at all. Must resolve to an enabled ollama entry using that model,
        with the baked-in defaults (priority 100, 180s timeout)."""
        resolved = generation._resolve_provider_configs({"model": "gemma4:31b-cloud"})
        self.assertIn("ollama", resolved)
        self.assertEqual(resolved["ollama"]["model"], "gemma4:31b-cloud")
        self.assertTrue(resolved["ollama"]["enabled"])
        self.assertEqual(resolved["ollama"]["priority"], 100)
        self.assertEqual(resolved["ollama"]["timeout_s"], 180)

    def test_explicit_providers_block_still_gets_ollama_default(self):
        """A `providers:` block that mentions OTHER providers but never
        mentions "ollama" at all must still produce an (enabled, default-
        priority) ollama entry — the "no other models enabled -> keep using
        Ollama exactly as today" guarantee shouldn't depend on the user
        remembering to declare ollama explicitly."""
        resolved = generation._resolve_provider_configs({
            "model": "gemma4:31b-cloud",
            "providers": {"openrouter": {"enabled": False, "model": "x"}},
        })
        self.assertIn("ollama", resolved)
        self.assertTrue(resolved["ollama"]["enabled"])
        self.assertEqual(resolved["ollama"]["model"], "gemma4:31b-cloud")

    def test_explicit_ollama_model_overrides_legacy_flat_model(self):
        resolved = generation._resolve_provider_configs({
            "model": "legacy-model",
            "providers": {"ollama": {"enabled": True, "model": "new-model"}},
        })
        self.assertEqual(resolved["ollama"]["model"], "new-model")

    def test_secret_expansion_from_environ(self):
        with patch.dict(os.environ, {"TEST_FAKE_KEY": "sk-12345"}):
            resolved = generation._resolve_provider_configs({
                "providers": {"openrouter": {"enabled": False, "api_key": "${TEST_FAKE_KEY}"}},
            })
        self.assertEqual(resolved["openrouter"]["api_key"], "sk-12345")

    def test_secret_expansion_unset_env_is_empty_string(self):
        os.environ.pop("TEST_DEFINITELY_UNSET_KEY", None)
        resolved = generation._resolve_provider_configs({
            "providers": {"openrouter": {"enabled": False, "api_key": "${TEST_DEFINITELY_UNSET_KEY}"}},
        })
        self.assertEqual(resolved["openrouter"]["api_key"], "")

    def test_literal_api_key_passes_through_unexpanded(self):
        resolved = generation._resolve_provider_configs({
            "providers": {"openrouter": {"enabled": False, "api_key": "sk-literal-123"}},
        })
        self.assertEqual(resolved["openrouter"]["api_key"], "sk-literal-123")


class TestRankedProviders(unittest.TestCase):
    def test_priority_ordering_and_enabled_filter(self):
        llm = {
            "providers": {
                "ollama":     {"enabled": True, "priority": 100},
                "openrouter": {"enabled": True, "priority": 80},
                "groq":       {"enabled": False, "priority": 200},   # disabled -> excluded regardless of priority
                "gemini":     {"enabled": True, "priority": 90},
            },
        }
        ranked = generation._ranked_providers(llm)
        names = [name for name, _ in ranked]
        self.assertEqual(names, ["ollama", "gemini", "openrouter"])

    def test_all_disabled_except_ollama_default(self):
        """Every NEW provider disabled (the shipped default) -> only ollama
        ranks, matching "if no other models are enabled, keep using Ollama
        exactly as today"."""
        llm = {
            "model": "gemma4:31b-cloud",
            "providers": {
                "openrouter": {"enabled": False},
                "groq": {"enabled": False},
                "gemini": {"enabled": False},
            },
        }
        ranked = generation._ranked_providers(llm)
        self.assertEqual([name for name, _ in ranked], ["ollama"])


# ─────────────────────────────────────────────────────────────────────────────
# Fallback chain — no config file, no network
# ─────────────────────────────────────────────────────────────────────────────
class TestGenerateWithFallback(unittest.TestCase):
    def test_first_provider_success_short_circuits(self):
        p1 = FakeProvider(result="from p1")
        p2 = FakeProvider(result="from p2")
        result = generation._generate_with_fallback([("p1", p1), ("p2", p2)], "prompt")
        self.assertEqual(result, "from p1")
        self.assertEqual(p1.calls, 1)
        self.assertEqual(p2.calls, 0)   # never reached

    def test_falls_back_to_next_on_failure(self):
        p1 = FakeProvider(error=RuntimeError("p1 down"))
        p2 = FakeProvider(result="from p2")
        result = generation._generate_with_fallback([("p1", p1), ("p2", p2)], "prompt")
        self.assertEqual(result, "from p2")
        self.assertEqual(p1.calls, 1)
        self.assertEqual(p2.calls, 1)

    def test_falls_back_through_multiple_failures(self):
        p1 = FakeProvider(error=RuntimeError("p1 down"))
        p2 = FakeProvider(error=RuntimeError("p2 down"))
        p3 = FakeProvider(result="from p3")
        result = generation._generate_with_fallback([("p1", p1), ("p2", p2), ("p3", p3)], "prompt")
        self.assertEqual(result, "from p3")

    def test_all_providers_fail_raises_with_last_error_chained(self):
        p1 = FakeProvider(error=RuntimeError("p1 down"))
        p2 = FakeProvider(error=ValueError("p2 down"))
        with self.assertRaises(RuntimeError) as ctx:
            generation._generate_with_fallback([("p1", p1), ("p2", p2)], "prompt")
        self.assertIn("p2 down", str(ctx.exception.__cause__) or str(ctx.exception))


# ─────────────────────────────────────────────────────────────────────────────
# _build_providers: unknown provider names, empty-config error
# ─────────────────────────────────────────────────────────────────────────────
class TestBuildProviders(unittest.TestCase):
    def test_unknown_provider_name_is_skipped_not_fatal(self):
        with patch.object(generation, "_load_cfg", return_value={
            "llm": {
                "model": "gemma4:31b-cloud",
                "providers": {
                    "totally_unknown_backend": {"enabled": True, "priority": 999},
                    "ollama": {"enabled": True, "priority": 100},
                },
            },
        }):
            providers = generation._build_providers()
        names = [name for name, _ in providers]
        self.assertIn("ollama", names)
        self.assertNotIn("totally_unknown_backend", names)

    def test_no_enabled_providers_raises_clear_error(self):
        with patch.object(generation, "_load_cfg", return_value={
            "llm": {"providers": {"ollama": {"enabled": False}}},
        }):
            with self.assertRaises(RuntimeError) as ctx:
                generation._build_providers()
        self.assertIn("No enabled llm provider", str(ctx.exception))


# ─────────────────────────────────────────────────────────────────────────────
# llm.py isolation — provider choice cannot affect parsing/validation/
# composition. This is the proof the abstraction boundary actually holds.
# ─────────────────────────────────────────────────────────────────────────────
class TestLlmIsolationFromProvider(unittest.TestCase):
    FIXTURE_SCRIPT = {
        "title": "Remote Work Kills Focus",
        "thumbnail": "Your Office Is Lying",
        "style": "contrarian",
        "global": {"theme": "tech_blue", "music_mood": "tense", "voice_style": "calm_intense", "camera_style": "dynamic"},
        "beats": [
            {"id": "beat_01", "type": "hook", "keyword": "THE COMFORT TRAP", "text": "You think you are finally free but your home office is actually a psychological trap in disguise today.", "energy": "high", "emotion": "urgent", "pace": "fast", "visual_intent": "confrontational", "camera": "push_in", "transition": "slam_cut", "background": "glow", "layout": "left", "visual_query": "home office desk", "intensity": 0.9},
            {"id": "beat_02", "type": "insight", "keyword": "COGNITIVE FRICTION", "text": "Your brain associates your living space with relaxation not output creating constant invisible friction in your mind.", "energy": "low", "emotion": "serious", "pace": "slow", "visual_intent": "documentary", "camera": "static", "transition": "cut", "background": "grid", "layout": "center", "visual_query": "home office desk overhead", "intensity": 0.5},
            {"id": "beat_03", "type": "tension", "keyword": "THE SLURRY", "text": "Without a physical commute you never actually switch states leaving work and rest blended into one long grey stretch.", "energy": "mid", "emotion": "anxious", "pace": "mid", "visual_intent": "chaotic", "camera": "handheld", "transition": "cut", "background": "solid", "layout": "left", "visual_query": "laptop home office bed", "intensity": 0.65},
            {"id": "beat_04", "type": "climax", "keyword": "SETTLING FOR LESS", "text": "The lack of social pressure means you stop fighting for excellence and quietly start accepting mediocrity as the new normal.", "energy": "high", "emotion": "urgent", "pace": "explosive", "visual_intent": "aggressive", "camera": "snap_zoom", "transition": "slam_cut", "background": "abstract", "layout": "full", "visual_query": "home office desk monitor glow", "intensity": 1.0},
            {"id": "beat_05", "type": "cta", "keyword": "DRAW THE LINE", "text": "If you do not build a hard border between your bed and your desk you will lose both of them eventually.", "energy": "mid", "emotion": "confident", "pace": "mid", "visual_intent": "minimal", "camera": "pull_out", "transition": "dip_black", "background": "noise", "layout": "center", "visual_query": "home office desk door open", "intensity": 0.75},
        ],
    }

    def test_generate_script_unaffected_by_which_provider_produced_the_text(self):
        """Monkeypatch llm.generate (the name llm.py actually calls — NOT
        generation.generate; `from generation import generate` binds its own
        reference in llm's namespace at import time, so patching the source
        module's attribute after the fact would silently do nothing here).
        No network, no Ollama, no real provider involved at all."""
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))
        import llm
        from formats import load_format

        prompts_root = pathlib.Path(__file__).resolve().parent.parent / "prompts"
        fmt = load_format(prompts_root, "shortform_tiktok")

        fixture_text = json.dumps(self.FIXTURE_SCRIPT)
        with patch("llm.generate", return_value=fixture_text) as fake_generate:
            data = llm.generate_script("why remote work kills deep focus", fmt)

        fake_generate.assert_called_once()
        self.assertEqual(data["title"], "Remote Work Kills Focus")
        self.assertEqual(len(data["beats"]), 5)
        # _normalise_schema / assign_composition ran: every beat has an
        # archetype now, regardless of which "provider" produced the raw text.
        self.assertTrue(all("archetype" in b for b in data["beats"]))
        # assign_composition actually fired for shortform_tiktok's real
        # affinity table (min_archetypes: 3) — proves downstream composition
        # logic is untouched by provider swap, not just "didn't crash".
        archetypes = {b["archetype"] for b in data["beats"]}
        self.assertGreaterEqual(len(archetypes), 3)


if __name__ == "__main__":
    unittest.main()

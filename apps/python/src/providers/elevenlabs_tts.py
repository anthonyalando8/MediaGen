"""ElevenLabs text-to-speech — cloud API, opt-in alternative to Kokoro for
narration that needs to actually sound like a story/documentary rather than
a punchy short-form read. No SDK dependency: raw HTTP via `urllib`, same
style as providers/gemini.py.

Setup (config.yaml's `tts.elevenlabs` block):
  api_key   — an ElevenLabs API key (https://elevenlabs.io/app/settings/api-keys).
              Free tier: 10,000 credits/month ≈ 10 minutes of audio with
              eleven_multilingual_v2 (roughly half that cost with
              eleven_flash_v2_5 / eleven_turbo_v2_5 — noticeably cheaper,
              still solid narration quality).
  voice_id  — REQUIRED, no default. ElevenLabs' old built-in "Default
              voices" (Adam, Rachel, ...) are being retired for accounts
              created after March 2026 and disappear entirely end of 2026,
              so hardcoding one here would just be handing out an ID likely
              to stop working. Pick a voice from
              https://elevenlabs.io/app/voice-library (search "narration",
              "documentary", or "audiobook") and paste its Voice ID —
              narrator voice is a personal-taste choice anyway.
  model_id  — defaults to eleven_multilingual_v2.

Requests raw PCM (`output_format=pcm_<rate>`) instead of MP3, so the
response bytes ARE the samples — no audio-decoding dependency needed. PCM at
16000/22050/24000 Hz is available on the free tier; 44100 Hz PCM requires a
paid plan, so a `sample_rate` of 44100 is snapped down to 24000 here rather
than surfacing an opaque 401 mid-run.
"""
from __future__ import annotations
import json
import urllib.error
import urllib.request
import numpy as np

_BASE = "https://api.elevenlabs.io/v1/text-to-speech"
_VOICES_URL = "https://api.elevenlabs.io/v1/voices"

# output_format=pcm_<rate> — only these are free-tier-safe (44100 needs Pro+).
_PCM_RATES = (16000, 22050, 24000)

# voice_settings.speed — ElevenLabs' documented valid range.
_SPEED_MIN, _SPEED_MAX = 0.7, 1.2

_SETUP_HINT = (
    "See apps/python/src/providers/elevenlabs_tts.py for setup, or set "
    "tts.provider back to \"kokoro\" in config.yaml to keep using the free/"
    "offline narrator."
)


class ElevenLabsProvider:
    """Constructed from config.yaml's `tts.elevenlabs` block (secrets already
    expanded by the caller — see tts.py's `_get_elevenlabs_provider`)."""

    def __init__(self, cfg: dict):
        self.cfg = cfg or {}
        self.api_key = self.cfg.get("api_key") or ""
        self.voice_id = self.cfg.get("voice_id") or ""
        self.model_id = self.cfg.get("model_id") or "eleven_multilingual_v2"
        if not self.api_key:
            raise RuntimeError(
                "[tts] tts.provider is \"elevenlabs\" but tts.elevenlabs.api_key is not set "
                "(or ELEVENLABS_API_KEY is missing from apps/python/.env). " + _SETUP_HINT
            )
        if not self.voice_id:
            raise RuntimeError(
                "[tts] tts.provider is \"elevenlabs\" but tts.elevenlabs.voice_id is not set. "
                + _SETUP_HINT
            )

    def synthesize(self, text: str, voice: str, speed: float, sample_rate: int) -> tuple[np.ndarray, int]:
        """Returns (samples, sample_rate) — samples as float32 in [-1, 1],
        matching what soundfile.write and tts.py's beat-concatenation loop
        already expect from Kokoro's `.create()`. Raises on any transport/
        auth/quota failure (never returns silence on error)."""
        rate = sample_rate if sample_rate in _PCM_RATES else min(_PCM_RATES, key=lambda r: abs(r - sample_rate))
        voice_id = voice or self.voice_id
        clamped_speed = max(_SPEED_MIN, min(_SPEED_MAX, speed))

        body = json.dumps({
            "text": text,
            "model_id": self.model_id,
            "voice_settings": {"speed": clamped_speed},
        }).encode("utf-8")
        url = f"{_BASE}/{voice_id}?output_format=pcm_{rate}"
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": "application/json",
            "xi-api-key": self.api_key,
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"[tts] ElevenLabs request failed ({e.code}): {detail[:300]}") from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"[tts] ElevenLabs request failed: {e.reason}") from e

        # Raw signed 16-bit little-endian mono PCM -> float32 in [-1, 1].
        pcm16 = np.frombuffer(raw, dtype="<i2")
        samples = pcm16.astype(np.float32) / 32768.0
        return samples, rate

    def list_voices(self) -> list[dict]:
        """[{"id", "label"}, ...] for every voice on this account — not wired
        into the editor's voice picker yet (that's Kokoro's ENGLISH_VOICES
        catalog today); exposed for future use / manual inspection."""
        req = urllib.request.Request(_VOICES_URL, headers={"xi-api-key": self.api_key})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8"))
        return [{"id": v["voice_id"], "label": v.get("name", v["voice_id"])} for v in data.get("voices", [])]

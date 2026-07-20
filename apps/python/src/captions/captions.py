"""
captions.py  —  Word-level transcription via whisper-timestamped.

EDITOR EDITION — the ASS caption burn is gone. The editor renders captions
itself from the beat-relative `word_times` the timeline produces, so this
module's ONLY job now is to run whisper once and write transcript.json, which
timeline.py consumes to build that word-sync spine.

(The choreography brain — caption_director.py — is still used, by timeline.py,
to align words to beats and emit the caption-unit layer in timeline.json.)
"""

import pathlib
import json


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────
def generate_captions(wav_path: pathlib.Path, out_dir: pathlib.Path, cfg: dict,
                      script: dict | None = None) -> pathlib.Path:
    """
    Transcribe `wav_path` with word-level timestamps and write transcript.json.
    Returns the transcript path. `script` is accepted for call-site
    compatibility but no longer used (was the ASS auto-style hint).
    """
    sc = cfg["subs"]
    transcript = _transcribe(wav_path, sc["whisper_model"], sc["language"])
    out_path = out_dir / "transcript.json"
    out_path.write_text(
        json.dumps(transcript, indent=2, ensure_ascii=False), encoding="utf-8")
    n_segs = len(transcript.get("segments", []))
    print(f"[captions] ✓ transcript.json — {n_segs} segments")
    return out_path


# ─────────────────────────────────────────────────────────────────────────────
# Transcription
# ─────────────────────────────────────────────────────────────────────────────
_WHISPER_CACHE: dict = {}


def load_whisper(model_size: str):
    """Load (and cache) a whisper-timestamped model, reused across calls so the
    server warms it once at startup instead of reloading on every job."""
    import whisper_timestamped as wt
    model = _WHISPER_CACHE.get(model_size)
    if model is None:
        print(f"[captions] Loading whisper model '{model_size}' (once)…")
        model = wt.load_model(model_size)
        _WHISPER_CACHE[model_size] = model
    return model


def _transcribe(wav_path: pathlib.Path, model_size: str, language: str) -> dict:
    import whisper_timestamped as wt
    model = load_whisper(model_size)
    print(f"[captions] Transcribing (model={model_size})…")
    audio = wt.load_audio(str(wav_path))
    return wt.transcribe(model, audio, language=language,
                         detect_disfluencies=False, verbose=False)

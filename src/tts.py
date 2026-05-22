"""
tts.py  --  Voice synthesis via Kokoro-ONNX.

Renders each beat as a separate WAV (better per-sentence prosody),
then concatenates them with a short silence gap into voice.wav.

────────────────────────────────────────────────────────────────────
NARRATOR VARIATION (v2)
────────────────────────────────────────────────────────────────────
Three layers of variation prevent every video sounding identical:

  1. script.global.voice_style → Kokoro voice + base speed
       calm_intense → am_adam @ 1.00
       storyteller  → bf_emma @ 1.02
       aggressive   → am_adam @ 1.12
       documentary  → bm_daniel @ 0.98
       dramatic     → af_heart @ 0.97
       analytical   → af_sky   @ 1.00
       comedic      → bf_emma @ 1.08

  2. beat.pace modulates speed per beat
       slow=0.93x · mid=1.00x · fast=1.08x · explosive=1.15x

  3. config.yaml tts.voice/speed still wins if explicitly set
       (legacy override path — set tts.voice="" to enable variation)

Outputs
-------
  voice.wav              full narration, used for captioning & mux
  beat_0.wav … beat_N.wav   per-beat audio, used for slide timing

Model files expected in project root (MediaGen/):
  kokoro-v1_0.onnx
  voices-v1.0.bin
"""

import pathlib
import numpy as np
import soundfile as sf


# ─────────────────────────────────────────────────────────────────────────────
# Narrator vocabulary — maps script.global.voice_style → Kokoro params
# ─────────────────────────────────────────────────────────────────────────────

# Kokoro voices currently available in voices-v1.0.bin:
#   af_heart, af_sky, am_adam, bf_emma, bm_daniel
# (a* = American, b* = British; f/m = female/male)
_VOICE_BY_STYLE = {
    "calm_intense": ("am_adam",   1.00),
    "storyteller":  ("bf_emma",   1.02),
    "aggressive":   ("am_adam",   1.12),
    "documentary":  ("bm_daniel", 0.98),
    "dramatic":     ("af_heart",  0.97),
    "analytical":   ("af_sky",    1.00),
    "comedic":      ("bf_emma",   1.08),
}

# Per-beat pace multiplier applied on top of the base speed.
# Mirrors the renderer pace multipliers (slow=1.45 anim → fast TTS would
# fight; we use the INVERSE relationship: slow pace → slower narration).
_PACE_SPEED_MULT = {
    "slow":      0.93,
    "mid":       1.00,
    "fast":      1.08,
    "explosive": 1.15,
}

# Fallback when no voice_style is supplied
_DEFAULT_VOICE = "af_heart"
_DEFAULT_SPEED = 1.05


# ─────────────────────────────────────────────────────────────────────────────
# Model file resolver
# ─────────────────────────────────────────────────────────────────────────────

_ONNX_NAMES   = ["kokoro-v1_0.onnx", "kokoro-v1.0.onnx"]
_VOICES_NAMES = ["voices-v1.0.bin", "voices-v1_0.bin", "voices.bin"]


def _find_model_files() -> tuple[pathlib.Path, pathlib.Path]:
    """Search cwd, project root, src/ for Kokoro model files."""
    search_dirs = [
        pathlib.Path.cwd(),
        pathlib.Path(__file__).parent.parent,
        pathlib.Path(__file__).parent,
    ]

    def find(names: list[str], label: str) -> pathlib.Path:
        for d in search_dirs:
            for name in names:
                p = d / name
                if p.exists():
                    return p
        raise FileNotFoundError(
            f"\n[tts] Kokoro {label} not found  (tried: {', '.join(names)})\n"
            f"\n      Download into MediaGen/ with:\n"
            f"      curl -L -o kokoro-v1_0.onnx "
            f"https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1_0.onnx\n"
            f"      curl -L -o voices-v1.0.bin  "
            f"https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin\n"
        )

    return find(_ONNX_NAMES, "ONNX model"), find(_VOICES_NAMES, "voices file")


# ─────────────────────────────────────────────────────────────────────────────
# Voice selection
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_voice(script: dict, cfg_voice: str, cfg_speed: float) -> tuple[str, float]:
    """
    Decide the voice + base speed for this script.

    Priority:
      1. If cfg_voice is set AND non-empty AND not "auto" → use it (legacy)
      2. Else: read script.global.voice_style → map to voice+speed
      3. Else: fall back to default

    To enable per-script variation, set tts.voice="auto" in config.yaml.
    """
    cfg_voice_norm = (cfg_voice or "").strip().lower()

    if cfg_voice_norm and cfg_voice_norm != "auto":
        return cfg_voice, cfg_speed

    style = (script.get("global", {}) or {}).get("voice_style", "").strip().lower()
    if style in _VOICE_BY_STYLE:
        voice, base = _VOICE_BY_STYLE[style]
        print(f"[tts] voice_style='{style}' → voice='{voice}'  base_speed={base}")
        return voice, base

    print(f"[tts] No voice_style match — using default voice='{_DEFAULT_VOICE}'")
    return _DEFAULT_VOICE, _DEFAULT_SPEED


def _speed_for_beat(beat: dict, base_speed: float) -> float:
    """Apply pace multiplier to the base speed for one beat."""
    pace = beat.get("pace", "mid")
    mult = _PACE_SPEED_MULT.get(pace, 1.0)
    return round(base_speed * mult, 3)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def synthesize(
    script:      dict,
    out_dir:     pathlib.Path,
    voice:       str   = "auto",   # use "auto" to enable voice_style → voice mapping
    speed:       float = 1.05,     # base speed override; ignored if voice="auto"
    sample_rate: int   = 24000,
) -> tuple[pathlib.Path, list[pathlib.Path]]:
    """
    Synthesise each beat with the script's voice_style → Kokoro voice mapping,
    apply per-beat pace adjustment, save beat_N.wav, concatenate → voice.wav.

    Returns (voice_path, [beat_0.wav, beat_1.wav, …])
    """
    from kokoro_onnx import Kokoro

    onnx_path, voices_path = _find_model_files()

    chosen_voice, base_speed = _resolve_voice(script, voice, speed)

    print(f"[tts] Loading Kokoro — voice='{chosen_voice}'  base_speed={base_speed}")
    print(f"[tts]   onnx:   {onnx_path}")
    print(f"[tts]   voices: {voices_path}")

    kokoro = Kokoro(str(onnx_path), str(voices_path))

    silence_gap = np.zeros(int(sample_rate * 0.40), dtype=np.float32)  # 400 ms gap
    all_samples: list[np.ndarray] = []
    beat_paths:  list[pathlib.Path] = []
    final_sr = sample_rate

    for i, beat in enumerate(script["beats"]):
        # Strip *emphasis* markers before TTS — they're for the renderer only.
        # Otherwise Kokoro pronounces them as "asterisk".
        text  = beat["text"].replace("*", "").strip()
        spd   = _speed_for_beat(beat, base_speed)
        pace  = beat.get("pace", "mid")
        print(f"[tts]   Beat {i+1} [pace={pace} speed={spd}]: {text[:60]}…")

        samples, sr = kokoro.create(text, voice=chosen_voice, speed=spd, lang="en-us")
        samples  = np.asarray(samples, dtype=np.float32)
        final_sr = sr

        beat_path = out_dir / f"beat_{i}.wav"
        sf.write(str(beat_path), samples, sr)
        beat_paths.append(beat_path)

        all_samples.append(samples)
        if i < len(script["beats"]) - 1:
            all_samples.append(silence_gap)

    combined   = np.concatenate(all_samples)
    voice_path = out_dir / "voice.wav"
    sf.write(str(voice_path), combined, final_sr)

    duration = len(combined) / final_sr
    print(f"[tts] ✓ voice.wav — {duration:.1f}s  ({len(beat_paths)} beats)")
    return voice_path, beat_paths


def beat_durations(beat_paths: list[pathlib.Path]) -> list[float]:
    """Return duration in seconds for each beat WAV."""
    return [sf.info(str(p)).duration for p in beat_paths]

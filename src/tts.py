"""
tts.py  —  Voice synthesis via Kokoro-ONNX.

Renders each beat as a separate WAV (better per-sentence prosody),
then concatenates them with a short silence gap into voice.wav.

Outputs
-------
  voice.wav              full narration, used for captioning & mux
  beat_0.wav … beat_4.wav   per-beat audio, used for slide timing

Model files expected in project root (MediaGen/):
  kokoro-v1_0.onnx
  voices-v1.0.bin        ← dot, not underscore (matches the GitHub release)

Download (run from MediaGen/):
  curl -L -o kokoro-v1_0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1_0.onnx
  curl -L -o voices-v1.0.bin  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
"""

import pathlib
import numpy as np
import soundfile as sf


# ─────────────────────────────────────────────────────────────────────────────
# Model file resolver
# ─────────────────────────────────────────────────────────────────────────────

# All known filename variants across kokoro-onnx releases
_ONNX_NAMES   = ["kokoro-v1_0.onnx", "kokoro-v1.0.onnx"]
_VOICES_NAMES = ["voices-v1.0.bin", "voices-v1_0.bin", "voices.bin"]


def _find_model_files() -> tuple[pathlib.Path, pathlib.Path]:
    """
    Search for kokoro model files in:
      1. current working directory  (where the user ran python from)
      2. project root  (MediaGen/ — two levels up from src/tts.py)
      3. src/ directory itself
    Raises FileNotFoundError with download instructions if not found.
    """
    search_dirs = [
        pathlib.Path.cwd(),
        pathlib.Path(__file__).parent.parent,  # MediaGen/
        pathlib.Path(__file__).parent,          # src/
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
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def synthesize(
    script:      dict,
    out_dir:     pathlib.Path,
    voice:       str   = "af_heart",
    speed:       float = 1.05,
    sample_rate: int   = 24000,
) -> tuple[pathlib.Path, list[pathlib.Path]]:
    """
    Synthesise each beat separately, save beat_N.wav, concatenate → voice.wav.

    Returns
    -------
    (voice_path, [beat_0.wav, beat_1.wav, …])
    """
    from kokoro_onnx import Kokoro

    onnx_path, voices_path = _find_model_files()
    print(f"[tts] Loading Kokoro — voice='{voice}'  speed={speed}")
    print(f"[tts]   onnx:   {onnx_path}")
    print(f"[tts]   voices: {voices_path}")

    kokoro = Kokoro(str(onnx_path), str(voices_path))

    silence_gap = np.zeros(int(sample_rate * 0.40), dtype=np.float32)  # 400 ms gap
    all_samples: list[np.ndarray] = []
    beat_paths:  list[pathlib.Path] = []
    final_sr = sample_rate

    for i, beat in enumerate(script["beats"]):
        text = beat["text"].strip()
        print(f"[tts]   Beat {i+1}: {text[:70]}…")

        samples, sr = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
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
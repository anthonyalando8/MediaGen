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

import io
import pathlib
import numpy as np
import soundfile as sf

from visuals import _beat_scene
from formats import VoiceProfile


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
# English voice catalog — for the editor's voice picker (preview + manual
# override). voices-v1.0.bin actually ships 54 Kokoro voices across several
# languages/accents (confirmed via Kokoro.get_voices()); this is the
# English-only subset (American af_/am_, British bf_/bm_). Hardcoded rather
# than queried at request time since the set is fixed for a given model file.
# ─────────────────────────────────────────────────────────────────────────────
ENGLISH_VOICES = [
    {"id": "af_alloy",    "label": "Alloy",    "accent": "American", "gender": "female"},
    {"id": "af_aoede",    "label": "Aoede",    "accent": "American", "gender": "female"},
    {"id": "af_bella",    "label": "Bella",    "accent": "American", "gender": "female"},
    {"id": "af_heart",    "label": "Heart",    "accent": "American", "gender": "female"},
    {"id": "af_jessica",  "label": "Jessica",  "accent": "American", "gender": "female"},
    {"id": "af_kore",     "label": "Kore",     "accent": "American", "gender": "female"},
    {"id": "af_nicole",   "label": "Nicole",   "accent": "American", "gender": "female"},
    {"id": "af_nova",     "label": "Nova",     "accent": "American", "gender": "female"},
    {"id": "af_river",    "label": "River",    "accent": "American", "gender": "female"},
    {"id": "af_sarah",    "label": "Sarah",    "accent": "American", "gender": "female"},
    {"id": "af_sky",      "label": "Sky",      "accent": "American", "gender": "female"},
    {"id": "am_adam",     "label": "Adam",     "accent": "American", "gender": "male"},
    {"id": "am_echo",     "label": "Echo",     "accent": "American", "gender": "male"},
    {"id": "am_eric",     "label": "Eric",     "accent": "American", "gender": "male"},
    {"id": "am_fenrir",   "label": "Fenrir",   "accent": "American", "gender": "male"},
    {"id": "am_liam",     "label": "Liam",     "accent": "American", "gender": "male"},
    {"id": "am_michael",  "label": "Michael",  "accent": "American", "gender": "male"},
    {"id": "am_onyx",     "label": "Onyx",     "accent": "American", "gender": "male"},
    {"id": "am_puck",     "label": "Puck",     "accent": "American", "gender": "male"},
    {"id": "am_santa",    "label": "Santa",    "accent": "American", "gender": "male"},
    {"id": "bf_alice",    "label": "Alice",    "accent": "British",  "gender": "female"},
    {"id": "bf_emma",     "label": "Emma",     "accent": "British",  "gender": "female"},
    {"id": "bf_isabella", "label": "Isabella", "accent": "British",  "gender": "female"},
    {"id": "bf_lily",     "label": "Lily",     "accent": "British",  "gender": "female"},
    {"id": "bm_daniel",   "label": "Daniel",   "accent": "British",  "gender": "male"},
    {"id": "bm_fable",    "label": "Fable",    "accent": "British",  "gender": "male"},
    {"id": "bm_george",   "label": "George",   "accent": "British",  "gender": "male"},
    {"id": "bm_lewis",    "label": "Lewis",    "accent": "British",  "gender": "male"},
]
_ENGLISH_VOICE_IDS = {v["id"] for v in ENGLISH_VOICES}

_PREVIEW_TEXT = "This is a quick preview of how this voice sounds."


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

def _resolve_voice(script: dict, cfg_voice: str, cfg_speed: float, profile_style: str = "", direct_voice: str | None = None) -> tuple[str, float]:
    """
    Decide the voice + base speed for this script.

    Priority:
      1. direct_voice — an explicit per-generation pick from the editor's
         voice picker. Highest priority: a deliberate UI selection is the
         most specific signal there is, so it wins even over the legacy
         cfg_voice override.
      2. If cfg_voice is set AND non-empty AND not "auto" → use it (legacy)
      3. Else: profile_style (genre's VoiceProfile.style) if non-empty — forces
         the voice regardless of what the LLM emitted for this run.
      4. Else: read script.global.voice_style → map to voice+speed (LLM-driven,
         now a fallback for genres that don't force a style)
      5. Else: fall back to default

    To enable per-script variation, set tts.voice="auto" in config.yaml.
    """
    if direct_voice:
        print(f"[tts] direct voice pick → voice='{direct_voice}'  base_speed={_DEFAULT_SPEED}")
        return direct_voice, _DEFAULT_SPEED

    cfg_voice_norm = (cfg_voice or "").strip().lower()

    if cfg_voice_norm and cfg_voice_norm != "auto":
        return cfg_voice, cfg_speed

    profile_style_norm = (profile_style or "").strip().lower()
    if profile_style_norm in _VOICE_BY_STYLE:
        voice, base = _VOICE_BY_STYLE[profile_style_norm]
        print(f"[tts] genre voice='{profile_style_norm}' (forced) → voice='{voice}'  base_speed={base}")
        return voice, base

    style = (script.get("global", {}) or {}).get("voice_style", "").strip().lower()
    if style in _VOICE_BY_STYLE:
        voice, base = _VOICE_BY_STYLE[style]
        print(f"[tts] voice_style='{style}' → voice='{voice}'  base_speed={base}")
        return voice, base

    print(f"[tts] No voice_style match — using default voice='{_DEFAULT_VOICE}'")
    return _DEFAULT_VOICE, _DEFAULT_SPEED


def _speed_for_beat(beat: dict, base_speed: float, scene: str = "", pace_map: dict | None = None) -> float:
    """Apply pace multiplier to the base speed for one beat. `pace_map`
    (genre's VoiceProfile.pace_map, keyed by scene: hook/insight/climax/…)
    forces the pace for that scene, ahead of the beat's own LLM-supplied
    pace — empty pace_map (the default) falls through unchanged."""
    pace = (pace_map or {}).get(scene) or beat.get("pace", "mid")
    mult = _PACE_SPEED_MULT.get(pace, 1.0)
    return round(base_speed * mult, 3)


# ─────────────────────────────────────────────────────────────────────────────
# Model cache — load Kokoro ONCE and reuse (server warms it at startup so the
# first generate isn't cold; the CLI benefits across a --batch run too).
# ─────────────────────────────────────────────────────────────────────────────

_KOKORO = None


def get_kokoro():
    """Return a cached Kokoro instance, loading the model files on first use."""
    global _KOKORO
    if _KOKORO is None:
        from kokoro_onnx import Kokoro
        onnx_path, voices_path = _find_model_files()
        print(f"[tts] Loading Kokoro (once)…")
        print(f"[tts]   onnx:   {onnx_path}")
        print(f"[tts]   voices: {voices_path}")
        _KOKORO = Kokoro(str(onnx_path), str(voices_path))
    return _KOKORO


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def synthesize(
    script:      dict,
    out_dir:     pathlib.Path,
    voice:       str   = "auto",   # use "auto" to enable voice_style → voice mapping
    speed:       float = 1.05,     # base speed override; ignored if voice="auto"
    sample_rate: int   = 24000,
    progress=None,                 # optional callback(i, n) after each beat wav
    voice_profile: VoiceProfile | None = None,   # genre's say over voice + pace (formats.VoiceProfile)
    voice_override: str | None = None,   # explicit per-generation pick from the editor's voice picker
) -> tuple[pathlib.Path, list[pathlib.Path]]:
    """
    Synthesise each beat with the script's voice_style → Kokoro voice mapping,
    apply per-beat pace adjustment, save beat_N.wav, concatenate → voice.wav.

    Returns (voice_path, [beat_0.wav, beat_1.wav, …])
    """
    voice_profile = voice_profile or VoiceProfile()
    chosen_voice, base_speed = _resolve_voice(script, voice, speed, voice_profile.style, voice_override)
    print(f"[tts] voice='{chosen_voice}'  base_speed={base_speed}")
    kokoro = get_kokoro()

    silence_gap = np.zeros(int(sample_rate * 0.40), dtype=np.float32)  # 400 ms gap
    all_samples: list[np.ndarray] = []
    beat_paths:  list[pathlib.Path] = []
    final_sr = sample_rate
    total_beats = len(script["beats"])

    for i, beat in enumerate(script["beats"]):
        # Strip *emphasis* markers before TTS — they're for the renderer only.
        # Otherwise Kokoro pronounces them as "asterisk".
        text  = beat["text"].replace("*", "").strip()
        scene = _beat_scene(beat, i, total_beats)
        spd   = _speed_for_beat(beat, base_speed, scene, voice_profile.pace_map)
        pace  = voice_profile.pace_map.get(scene) or beat.get("pace", "mid")
        print(f"[tts]   Beat {i+1} [pace={pace} speed={spd}]: {text[:60]}…")

        samples, sr = kokoro.create(text, voice=chosen_voice, speed=spd, lang="en-us")
        samples  = np.asarray(samples, dtype=np.float32)
        final_sr = sr

        beat_path = out_dir / f"beat_{i}.wav"
        sf.write(str(beat_path), samples, sr)
        beat_paths.append(beat_path)
        if progress:
            progress(i, len(script["beats"]))

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


def synthesize_preview(voice_id: str, speed: float = 1.05) -> bytes:
    """
    Synthesise a short fixed sample line with `voice_id` — the editor's
    voice-picker preview button. Reuses the already-warm Kokoro instance;
    a single short line is sub-second, so this has no job/queue machinery,
    unlike the full pipeline. Returns WAV bytes (no disk I/O — soundfile
    writes to an in-memory buffer).
    """
    kokoro = get_kokoro()
    samples, sr = kokoro.create(_PREVIEW_TEXT, voice=voice_id, speed=speed, lang="en-us")
    buf = io.BytesIO()
    sf.write(buf, np.asarray(samples, dtype=np.float32), sr, format="WAV")
    return buf.getvalue()

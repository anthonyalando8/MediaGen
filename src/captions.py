"""
captions.py  —  Word-level captions via whisper-timestamped → ASS format.

Why ASS instead of SRT?
  ASS supports the {\\kf<cs>} karaoke tag — each word lights up (yellow,
  slightly larger) exactly when it is spoken.  SRT only does line-level
  timing, which looks dated on TikTok.

Output
------
  captions.ass   burned into the video by FFmpeg
  transcript.json  raw whisper output (for debugging)
"""

import pathlib
import json


# ─────────────────────────────────────────────────────────────────────────────
# ASS template
# ─────────────────────────────────────────────────────────────────────────────

_HEADER = """\
[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,Space Grotesk,{fs},&H00FFFFFF,&H000000FF,&H00000000,{back},1,0,0,0,100,100,1,0,1,4,2,2,80,80,220,1
Style: Active,Space Grotesk,{fs_hi},{hi},&H000000FF,&H00000000,{back},1,0,0,0,100,100,1,0,1,4,2,2,80,80,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

_MAX_WORDS_PER_LINE = 6     # how many words share one caption line
_LINE_LINGER        = 0.18  # seconds caption stays visible after last word


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts(sec: float) -> str:
    """Float seconds → ASS timestamp  H:MM:SS.cc"""
    h  = int(sec // 3600)
    m  = int((sec % 3600) // 60)
    s  = sec % 60
    cs = int(round((s - int(s)) * 100))
    return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"


def _karaoke_line(words: list[dict]) -> str:
    """
    Build the karaoke-tagged text for one caption line.
    {\\kf<cs>}word  — the word lights up for <cs> centiseconds.
    """
    parts = []
    for w in words:
        dur_cs = max(1, int(round((w["end"] - w["start"]) * 100)))
        parts.append(f"{{\\kf{dur_cs}}}{w['text'].strip()} ")
    return "".join(parts).rstrip()


# ─────────────────────────────────────────────────────────────────────────────
# Transcription
# ─────────────────────────────────────────────────────────────────────────────

def _transcribe(wav_path: pathlib.Path, model_size: str, language: str) -> dict:
    import whisper_timestamped as wt
    print(f"[captions] Transcribing with whisper-timestamped (model={model_size})…")
    model  = wt.load_model(model_size)
    audio  = wt.load_audio(str(wav_path))
    result = wt.transcribe(
        model, audio,
        language=language,
        detect_disfluencies=False,
        verbose=False,
    )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# ASS builder
# ─────────────────────────────────────────────────────────────────────────────

def _build_ass(transcript: dict, out_path: pathlib.Path, cfg: dict) -> pathlib.Path:
    sc   = cfg["subs"]
    vid  = cfg["video"]
    fs   = sc["font_size"]
    fs_h = sc["font_size_active"]
    hi   = sc["highlight_color"]
    back = sc["back_color"]

    header = _HEADER.format(
        w=vid["width"], h=vid["height"],
        fs=fs, fs_hi=fs_h, hi=hi, back=back,
    )

    dialogue_lines: list[str] = []

    for seg in transcript.get("segments", []):
        words = seg.get("words", [])

        # fallback — no word timestamps: treat the whole segment as one word
        if not words:
            words = [{"text": seg["text"], "start": seg["start"], "end": seg["end"]}]

        # chunk into lines of ≤ MAX_WORDS_PER_LINE
        for chunk_i in range(0, len(words), _MAX_WORDS_PER_LINE):
            chunk = words[chunk_i: chunk_i + _MAX_WORDS_PER_LINE]
            t_in  = chunk[0]["start"]
            t_out = chunk[-1]["end"] + _LINE_LINGER
            kline = _karaoke_line(chunk)
            dialogue_lines.append(
                f"Dialogue: 0,{_ts(t_in)},{_ts(t_out)},Base,,0,0,0,,{{\\k0}}{kline}"
            )

    content = header + "\n".join(dialogue_lines) + "\n"
    out_path.write_text(content, encoding="utf-8")
    print(f"[captions] ✓ captions.ass — {len(dialogue_lines)} lines")
    return out_path


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def generate_captions(
    wav_path: pathlib.Path,
    out_dir:  pathlib.Path,
    cfg:      dict,
) -> pathlib.Path:
    """
    Transcribe voice.wav and write captions.ass.
    Also saves transcript.json for debugging.
    Returns path to .ass file.
    """
    sc = cfg["subs"]
    transcript = _transcribe(wav_path, sc["whisper_model"], sc["language"])

    # save raw transcript
    (out_dir / "transcript.json").write_text(
        json.dumps(transcript, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    ass_path = out_dir / "captions.ass"
    return _build_ass(transcript, ass_path, cfg)
"""
captions.py  —  Word-level captions via whisper-timestamped → ASS format.

Caption styles (set via config.yaml  subs.style):
  auto         NEW v2 — picks a style from script.style / global.voice_style
  karaoke      White text, yellow active word, semi-transparent box (TikTok classic)
  glow         Light-cyan glow halo on active word, no box
  neon         Dark box, electric cyan active word, aggressive glow
  minimal      Clean white text, no box, subtle cyan accent shift
  bold_drop    Large bold, heavy drop shadow, bright yellow active

────────────────────────────────────────────────────────────────────
v2 — AUTO-STYLE
────────────────────────────────────────────────────────────────────
When config.yaml sets subs.style: "auto", the style is derived from the
script so every video gets captions that match its emotional register:

  contrarian / builder       → bold_drop  (punchy, max readability)
  intense                    → neon       (aggressive)
  cinematic                  → minimal    (editorial restraint)
  calm / analytical          → minimal    (refined)
  humorous                   → glow       (bright, friendly)

Explicit config values still win — only "auto" triggers the mapping.
"""

import pathlib
import json


# ─────────────────────────────────────────────────────────────────────────────
# ASS colour helpers
# ─────────────────────────────────────────────────────────────────────────────
# ASS colour format: &HAABBGGRR  (alpha, blue, green, red)
# Alpha: 00 = opaque, FF = transparent

def _rgba(r: int, g: int, b: int, a: int = 0) -> str:
    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"

_WHITE      = _rgba(255, 255, 255)
_BLACK      = _rgba(0,   0,   0  )
_YELLOW     = _rgba(255, 255, 0  )
_CYAN_LIGHT = _rgba(180, 240, 255)
_CYAN_HOT   = _rgba(80,  220, 255)
_CYAN_NEON  = _rgba(0,   255, 240)
_TRANS      = _rgba(0,   0,   0, 255)
_BOX_DARK   = _rgba(0,   0,   0, 96)
_BOX_NEON   = _rgba(0,   0,   0, 140)


# ─────────────────────────────────────────────────────────────────────────────
# AUTO-STYLE MAPPING — script.style → caption style
# ─────────────────────────────────────────────────────────────────────────────

_CAPTION_BY_SCRIPT_STYLE = {
    "contrarian":  "bold_drop",
    "builder":     "bold_drop",
    "intense":     "neon",
    "cinematic":   "minimal",
    "calm":        "minimal",
    "analytical":  "minimal",
    "humorous":    "glow",
}

# Voice-style fallback for cases where script.style is missing/unknown
_CAPTION_BY_VOICE_STYLE = {
    "calm_intense": "minimal",
    "storyteller":  "glow",
    "aggressive":   "bold_drop",
    "documentary":  "minimal",
    "dramatic":     "neon",
    "analytical":   "minimal",
    "comedic":      "glow",
}

_FALLBACK_STYLE = "karaoke"


def _auto_style_for_script(script: dict | None) -> str:
    """Pick a caption style based on the script's style + voice_style."""
    if not script:
        return _FALLBACK_STYLE

    script_style = (script.get("style", "") or "").strip().lower()
    if script_style in _CAPTION_BY_SCRIPT_STYLE:
        return _CAPTION_BY_SCRIPT_STYLE[script_style]

    voice_style = (script.get("global", {}) or {}).get("voice_style", "").strip().lower()
    if voice_style in _CAPTION_BY_VOICE_STYLE:
        return _CAPTION_BY_VOICE_STYLE[voice_style]

    return _FALLBACK_STYLE


# ─────────────────────────────────────────────────────────────────────────────
# Style definitions
# ─────────────────────────────────────────────────────────────────────────────

def _get_style_def(style: str, fs: int, fs_hi: int) -> dict:
    """Return ASS Style + per-line override tags for one caption style."""

    if style == "glow":
        return {
            "header_base": (
                f"Style: Base,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_rgba(0,0,0,200)},{_TRANS},"
                f"1,0,0,0,100,100,0,0,1,1.5,0,2,80,80,220,1"
            ),
            "header_active": (
                f"Style: Active,Space Grotesk,{fs_hi},"
                f"{_CYAN_LIGHT},{_TRANS},{_CYAN_HOT},{_TRANS},"
                f"1,0,0,0,100,100,0,0,1,5,0,2,80,80,220,1"
            ),
            "base_tag":   r"{\blur0}",
            "active_tag": r"{\1c" + _CYAN_LIGHT + r"\3c" + _CYAN_HOT + r"\bord6\blur8\fs" + str(fs_hi) + r"}",
        }

    elif style == "neon":
        return {
            "header_base": (
                f"Style: Base,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_BLACK},{_BOX_NEON},"
                f"1,0,0,0,100,100,0,0,1,2,0,2,80,80,220,1"
            ),
            "header_active": (
                f"Style: Active,Space Grotesk,{fs_hi},"
                f"{_CYAN_NEON},{_TRANS},{_CYAN_NEON},{_BOX_NEON},"
                f"1,0,0,0,100,100,0,0,1,6,0,2,80,80,220,1"
            ),
            "base_tag":   r"{\blur0}",
            "active_tag": r"{\1c" + _CYAN_NEON + r"\3c" + _CYAN_NEON + r"\bord8\blur12\fs" + str(fs_hi) + r"}",
        }

    elif style == "minimal":
        return {
            "header_base": (
                f"Style: Base,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_rgba(0,0,0,160)},{_TRANS},"
                f"0,0,0,0,100,100,0,0,1,1,0,2,80,80,220,1"
            ),
            "header_active": (
                f"Style: Active,Space Grotesk,{fs_hi},"
                f"{_CYAN_LIGHT},{_TRANS},{_rgba(0,0,0,180)},{_TRANS},"
                f"0,0,0,0,100,100,0,0,1,1,0,2,80,80,220,1"
            ),
            "base_tag":   r"{\blur0}",
            "active_tag": r"{\1c" + _CYAN_LIGHT + r"\bord1\blur0\fs" + str(fs_hi) + r"}",
        }

    elif style == "bold_drop":
        _SHADOW_COL = _rgba(0, 0, 0, 40)
        return {
            "header_base": (
                f"Style: Base,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_BLACK},{_SHADOW_COL},"
                f"1,0,0,0,100,100,0,0,1,2,4,2,80,80,220,1"
            ),
            "header_active": (
                f"Style: Active,Space Grotesk,{fs_hi},"
                f"{_YELLOW},{_TRANS},{_BLACK},{_SHADOW_COL},"
                f"1,0,0,0,100,100,0,0,1,2,4,2,80,80,220,1"
            ),
            "base_tag":   r"{\blur0\shad4}",
            "active_tag": r"{\1c" + _YELLOW + r"\shad5\bord2\blur0\fs" + str(fs_hi) + r"}",
        }

    else:
        # ── KARAOKE (default) ─────────────────────────────────────
        hi   = "&H0000FFFF"
        back = "&H60000000"
        return {
            "header_base": (
                f"Style: Base,Space Grotesk,{fs},"
                f"&H00FFFFFF,&H000000FF,&H00000000,{back},"
                f"1,0,0,0,100,100,1,0,1,4,2,2,80,80,220,1"
            ),
            "header_active": (
                f"Style: Active,Space Grotesk,{fs_hi},"
                f"{hi},&H000000FF,&H00000000,{back},"
                f"1,0,0,0,100,100,1,0,1,4,2,2,80,80,220,1"
            ),
            "base_tag":   r"{\k0}",
            "active_tag": None,
        }


# ─────────────────────────────────────────────────────────────────────────────
# ASS header
# ─────────────────────────────────────────────────────────────────────────────

_HEADER_TMPL = """\
[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{style_base}
{style_active}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

_MAX_WORDS_PER_LINE = 6
_LINE_LINGER        = 0.18


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts(sec: float) -> str:
    h  = int(sec // 3600)
    m  = int((sec % 3600) // 60)
    s  = sec % 60
    cs = int(round((s - int(s)) * 100))
    return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"


def _karaoke_line(words: list[dict], active_tag: str | None) -> str:
    parts = []
    for w in words:
        dur_cs = max(1, int(round((w["end"] - w["start"]) * 100)))
        word   = w["text"].strip()
        if active_tag is None:
            parts.append(f"{{\\kf{dur_cs}}}{word} ")
        else:
            parts.append(f"{{\\kf{dur_cs}}}{active_tag}{word}{{\\r}} ")
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

def _build_ass(
    transcript: dict,
    out_path:   pathlib.Path,
    cfg:        dict,
    script:     dict | None = None,
) -> pathlib.Path:
    sc      = cfg["subs"]
    vid     = cfg["video"]
    fs      = sc["font_size"]
    fs_hi   = sc["font_size_active"]

    raw_style = (sc.get("style", "karaoke") or "karaoke").strip().lower()
    if raw_style == "auto":
        style = _auto_style_for_script(script)
        print(f"[captions] subs.style='auto' → resolved to '{style}' "
              f"(script.style='{(script or {}).get('style','')}')")
    else:
        style = raw_style
        print(f"[captions] Caption style: {style}")

    sdef = _get_style_def(style, fs, fs_hi)

    header = _HEADER_TMPL.format(
        w=vid["width"],
        h=vid["height"],
        style_base=sdef["header_base"],
        style_active=sdef["header_active"],
    )

    active_tag      = sdef["active_tag"]
    base_tag_prefix = sdef["base_tag"]
    dialogue_lines: list[str] = []

    for seg in transcript.get("segments", []):
        words = seg.get("words", [])
        if not words:
            words = [{"text": seg["text"], "start": seg["start"], "end": seg["end"]}]

        for chunk_i in range(0, len(words), _MAX_WORDS_PER_LINE):
            chunk  = words[chunk_i: chunk_i + _MAX_WORDS_PER_LINE]
            t_in   = chunk[0]["start"]
            t_out  = chunk[-1]["end"] + _LINE_LINGER
            kline  = _karaoke_line(chunk, active_tag)
            dialogue_lines.append(
                f"Dialogue: 0,{_ts(t_in)},{_ts(t_out)},Base,,0,0,0,,{base_tag_prefix}{kline}"
            )

    content = header + "\n".join(dialogue_lines) + "\n"
    out_path.write_text(content, encoding="utf-8")
    print(f"[captions] ✓ captions.ass — {len(dialogue_lines)} lines  [{style}]")
    return out_path


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def generate_captions(
    wav_path: pathlib.Path,
    out_dir:  pathlib.Path,
    cfg:      dict,
    script:   dict | None = None,
) -> pathlib.Path:
    """
    Transcribe voice.wav and write captions.ass.

    script (optional) — when provided AND cfg.subs.style == "auto",
    the caption style is derived from script.style / global.voice_style.

    Returns path to .ass file.
    """
    sc = cfg["subs"]
    transcript = _transcribe(wav_path, sc["whisper_model"], sc["language"])

    (out_dir / "transcript.json").write_text(
        json.dumps(transcript, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    ass_path = out_dir / "captions.ass"
    return _build_ass(transcript, ass_path, cfg, script=script)

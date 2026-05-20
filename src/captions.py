"""
captions.py  —  Word-level captions via whisper-timestamped → ASS format.

Why ASS instead of SRT?
  ASS supports the {\\kf<cs>} karaoke tag — each word lights up exactly
  when it is spoken. SRT only does line-level timing.

Caption styles (set via config.yaml  subs.style):
  karaoke      Default. White text, yellow active word, semi-transparent box.
               Classic TikTok look.
  glow         White text, light-blue/cyan glowing border on active word.
               No background box — glow effect via \\blur + wide border.
               The style you see on premium motion caption edits.
  neon         Dark background box, electric cyan active word, heavy glow.
               More aggressive than glow — works on busy backgrounds.
  minimal      Clean white text, no box, thin accent underline via colour.
               Flat, editorial feel matching the scene aesthetics.
  bold_drop    Large bold text, heavy black drop shadow, bright yellow active.
               Maximum readability, slightly retro energy.

Output
------
  captions.ass   burned into the video by FFmpeg
  transcript.json  raw whisper output (for debugging)
"""

import pathlib
import json


# ─────────────────────────────────────────────────────────────────────────────
# ASS colour helpers
# ─────────────────────────────────────────────────────────────────────────────
# ASS colour format: &HAABBGGRR  (alpha, blue, green, red — all hex pairs)
# Alpha: 00 = fully opaque, FF = fully transparent

def _rgba(r: int, g: int, b: int, a: int = 0) -> str:
    """Return ASS colour string  &HAABBGGRR"""
    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"

# Common colours
_WHITE      = _rgba(255, 255, 255)
_BLACK      = _rgba(0,   0,   0  )
_YELLOW     = _rgba(255, 255, 0  )
_CYAN_LIGHT = _rgba(180, 240, 255)   # very light blue-cyan — the glow base
_CYAN_HOT   = _rgba(80,  220, 255)   # saturated cyan — active word glow
_CYAN_NEON  = _rgba(0,   255, 240)   # electric neon cyan
_TRANS      = _rgba(0,   0,   0, 255)  # fully transparent (used to hide elements)
_BOX_DARK   = _rgba(0,   0,   0, 96)   # semi-transparent black box (~62% opacity)
_BOX_NEON   = _rgba(0,   0,   0, 140)  # darker box for neon style


# ─────────────────────────────────────────────────────────────────────────────
# Style definitions
# ─────────────────────────────────────────────────────────────────────────────

def _get_style_def(style: str, fs: int, fs_hi: int) -> dict:
    """
    Return a dict with all parameters needed to build the ASS header
    and per-dialogue override tags for a given style.

    Keys:
      header_base    ASS Style line for inactive (Base) words
      header_active  ASS Style line for active (highlighted) words
      base_tag       Override tags prepended to every dialogue line
      active_tag     Override tags applied to the active word span
                     (replaces the \\kf tag context)
    """

    if style == "glow":
        # ── GLOW ─────────────────────────────────────────────────────────
        # White text, NO background box.
        # Active word: light-cyan primary colour + wide soft border (the glow).
        # Border is rendered as a coloured halo via \\bord + \\blur.
        # Inactive words: white with a very thin dark border for readability.
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
            # Per-line override: no blur on base, keep it clean
            "base_tag":   r"{\blur0}",
            # Active word gets the glow: saturated cyan + soft blur
            # The \\blur spreads the border colour outward as a luminous halo
            "active_tag": r"{\1c" + _CYAN_LIGHT + r"\3c" + _CYAN_HOT + r"\bord6\blur8\fs" + str(fs_hi) + r"}",
        }

    elif style == "neon":
        # ── NEON ─────────────────────────────────────────────────────────
        # Dark box behind each line. Active word is electric cyan with
        # an aggressive glow radius. Feels more nightclub than editorial.
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
        # ── MINIMAL ──────────────────────────────────────────────────────
        # No box. Clean white text with thin outline.
        # Active word: accent shifts to light cyan, slightly larger.
        # Feels like the scene's own typography system — editorial, flat.
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
        # ── BOLD DROP ────────────────────────────────────────────────────
        # Large bold white text, heavy drop shadow (no box).
        # Active word: bright yellow. Maximum legibility, slightly retro.
        _SHADOW_COL = _rgba(0, 0, 0, 40)  # near-opaque shadow
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
        # ── KARAOKE (default) ────────────────────────────────────────────
        # Original style. White text, yellow active word, dark semi-transparent
        # background box. Classic high-retention TikTok caption look.
        hi   = "&H0000FFFF"  # yellow (ASS format) — keep original config value
        back = "&H60000000"  # semi-transparent box
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
            "active_tag": None,  # karaoke uses native kf tag, no extra override needed
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
    """Float seconds → ASS timestamp  H:MM:SS.cc"""
    h  = int(sec // 3600)
    m  = int((sec % 3600) // 60)
    s  = sec % 60
    cs = int(round((s - int(s)) * 100))
    return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"


def _karaoke_line(words: list[dict], active_tag: str | None) -> str:
    """
    Build the karaoke-tagged text for one caption line.

    karaoke style:  {\\kf<cs>}word  — native ASS karaoke colouring.
    other styles:   {\\kf<cs>}{active_tag}word{reset}  — each word
                    gets the active override for its spoken duration,
                    then resets to base style.
    """
    parts = []
    for w in words:
        dur_cs = max(1, int(round((w["end"] - w["start"]) * 100)))
        word   = w["text"].strip()

        if active_tag is None:
            # Native karaoke — ASS handles the colour transition automatically
            parts.append(f"{{\\kf{dur_cs}}}{word} ")
        else:
            # Manual per-word override: word lights up with active_tag for dur_cs,
            # then the reset tag (empty braces restore Base style context)
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

def _build_ass(transcript: dict, out_path: pathlib.Path, cfg: dict) -> pathlib.Path:
    sc      = cfg["subs"]
    vid     = cfg["video"]
    fs      = sc["font_size"]
    fs_hi   = sc["font_size_active"]
    style   = sc.get("style", "karaoke").lower().strip()

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
) -> pathlib.Path:
    """
    Transcribe voice.wav and write captions.ass.
    Also saves transcript.json for debugging.
    Returns path to .ass file.
    """
    sc = cfg["subs"]
    transcript = _transcribe(wav_path, sc["whisper_model"], sc["language"])

    (out_dir / "transcript.json").write_text(
        json.dumps(transcript, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    ass_path = out_dir / "captions.ass"
    return _build_ass(transcript, ass_path, cfg)
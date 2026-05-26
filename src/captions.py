"""
captions.py  —  Word-level captions via whisper-timestamped → ASS format.

Caption styles (set via config.yaml  subs.style):
  auto         picks a style from script.style / global.voice_style
  karaoke      White text, yellow active word (native \\kf fill)
  glow         Light-cyan glow halo on active word
  neon         Dark box, electric cyan active word
  minimal      Clean white text, no box, subtle accent on active word
  bold_drop    Large bold, heavy drop shadow, bright yellow active
  documentary  White/grey text, single-word highlight, no glow (NEW — editorial)

────────────────────────────────────────────────────────────────────
v3 — PER-WORD DIALOGUE ENGINE
────────────────────────────────────────────────────────────────────
Replaces the broken \\kf inline-tag approach with per-word Dialogue events.

The old approach put active_tag AFTER \\kf in the same Dialogue line:
  {dim}{\\kf100}{active_tag}{word}{\\r}
This applied active_tag immediately to ALL words (ASS override tags
apply to all following text in the same event). Every word appeared
at full brightness from frame 1 regardless of timing.

The new approach (industry standard — matches CapCut/TikTok):
  One Dialogue event per word, timed to its exact start/end.
  A context window of ±CONTEXT_WORDS words is shown simultaneously.
  - Active word:  bright accent colour, slightly larger
  - Past words:   full white (already spoken)
  - Future words: dim (50% white, upcoming)

This eliminates all \\kf timing ambiguity and works reliably with
ffmpeg's libass renderer.
"""

import pathlib
import json


# ─────────────────────────────────────────────────────────────────────────────
# ASS colour helpers
# ─────────────────────────────────────────────────────────────────────────────
def _rgba(r: int, g: int, b: int, a: int = 0) -> str:
    """ASS colour: &HAABBGGRR  (alpha 00=opaque, FF=transparent)"""
    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"

_WHITE       = _rgba(255, 255, 255)
_WHITE_DIM   = _rgba(255, 255, 255, 128)   # 50% alpha — unspoken words
_BLACK       = _rgba(0,   0,   0  )
_YELLOW      = _rgba(255, 255, 0  )
_CYAN_LIGHT  = _rgba(180, 240, 255)
_CYAN_HOT    = _rgba(80,  220, 255)
_CYAN_NEON   = _rgba(0,   255, 240)
_TRANS       = _rgba(0,   0,   0,  255)
_BOX_DARK    = _rgba(0,   0,   0,  96 )
_GREY_MID    = _rgba(160, 160, 160)        # documentary past-word colour


# ─────────────────────────────────────────────────────────────────────────────
# AUTO-STYLE MAPPING
# ─────────────────────────────────────────────────────────────────────────────

_CAPTION_BY_SCRIPT_STYLE = {
    "contrarian":  "bold_drop",
    "builder":     "bold_drop",
    "intense":     "documentary",    # was "neon" — too garish for editorial
    "cinematic":   "documentary",
    "calm":        "minimal",
    "analytical":  "minimal",
    "humorous":    "glow",
}

_CAPTION_BY_VOICE_STYLE = {
    "calm_intense": "documentary",
    "storyteller":  "glow",
    "aggressive":   "bold_drop",
    "documentary":  "documentary",
    "dramatic":     "documentary",
    "analytical":   "minimal",
    "comedic":      "glow",
}

_FALLBACK_STYLE = "documentary"     # was "karaoke" — documentary is a better default


def _auto_style_for_script(script: dict | None) -> str:
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
# Each style returns a dict with:
#   ass_style_line   — single ASS Style: line used for ALL words
#   active_colour    — &HBBGGRR for the speaking word
#   past_colour      — colour for already-spoken words
#   future_colour    — colour for upcoming words
#   active_bold      — True/False
#   active_size_add  — pixels added to font_size for active word
#   outline          — outline width
#   shadow           — shadow depth
#   border_style     — 1=outline+shadow  3=opaque box
#   back_colour      — box/shadow background colour

def _get_style_def(style: str, fs: int) -> dict:

    if style == "documentary":
        # ── Clean editorial: white past, accent active, dim future ──
        # No glow, no box — matches the cinematic scene aesthetic.
        return dict(
            ass_style_line=(
                f"Style: Cap,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_rgba(0,0,0,180)},{_TRANS},"
                f"0,0,0,0,100,100,0,0,1,1.5,0,2,80,80,160,1"
            ),
            active_colour  = _CYAN_LIGHT,
            past_colour    = _WHITE,
            future_colour  = _WHITE_DIM,
            active_bold    = True,
            active_size_add= 4,
            outline        = 1.5,
            shadow         = 0,
            border_style   = 1,
            back_colour    = _TRANS,
        )

    elif style == "minimal":
        return dict(
            ass_style_line=(
                f"Style: Cap,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_rgba(0,0,0,160)},{_TRANS},"
                f"0,0,0,0,100,100,0,0,1,1,0,2,80,80,160,1"
            ),
            active_colour  = _CYAN_LIGHT,
            past_colour    = _WHITE,
            future_colour  = _WHITE_DIM,
            active_bold    = False,
            active_size_add= 2,
            outline        = 1,
            shadow         = 0,
            border_style   = 1,
            back_colour    = _TRANS,
        )

    elif style == "bold_drop":
        _SHADOW_COL = _rgba(0, 0, 0, 40)
        return dict(
            ass_style_line=(
                f"Style: Cap,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_BLACK},{_SHADOW_COL},"
                f"1,0,0,0,100,100,0,0,1,2,4,2,80,80,160,1"
            ),
            active_colour  = _YELLOW,
            past_colour    = _WHITE,
            future_colour  = _WHITE_DIM,
            active_bold    = True,
            active_size_add= 6,
            outline        = 2,
            shadow         = 4,
            border_style   = 1,
            back_colour    = _SHADOW_COL,
        )

    elif style == "glow":
        return dict(
            ass_style_line=(
                f"Style: Cap,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_rgba(0,0,0,200)},{_TRANS},"
                f"1,0,0,0,100,100,0,0,1,1.5,0,2,80,80,160,1"
            ),
            active_colour  = _CYAN_LIGHT,
            past_colour    = _WHITE,
            future_colour  = _WHITE_DIM,
            active_bold    = True,
            active_size_add= 4,
            outline        = 5,      # glow via thick outline
            shadow         = 0,
            border_style   = 1,
            back_colour    = _TRANS,
        )

    elif style == "neon":
        return dict(
            ass_style_line=(
                f"Style: Cap,Space Grotesk,{fs},"
                f"{_WHITE},{_TRANS},{_BLACK},{_BOX_DARK},"
                f"1,0,0,0,100,100,0,0,1,2,0,2,80,80,160,1"
            ),
            active_colour  = _CYAN_NEON,
            past_colour    = _WHITE,
            future_colour  = _WHITE_DIM,
            active_bold    = True,
            active_size_add= 4,
            outline        = 2,
            shadow         = 0,
            border_style   = 1,
            back_colour    = _BOX_DARK,
        )

    else:
        # karaoke — native \kf, no per-word engine
        return dict(
            ass_style_line=(
                f"Style: Cap,Space Grotesk,{fs},"
                f"&H00FFFFFF,&H000000FF,&H00000000,&H60000000,"
                f"1,0,0,0,100,100,1,0,1,4,2,2,80,80,160,1"
            ),
            active_colour  = None,   # sentinel: use legacy \kf path
            past_colour    = _WHITE,
            future_colour  = None,
            active_bold    = False,
            active_size_add= 0,
            outline        = 4,
            shadow         = 2,
            border_style   = 1,
            back_colour    = _rgba(0,0,0,96),
        )


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
{style_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

# Fixed-line karaoke config
_MAX_PER_LINE   = 5      # words per line — fits 1080px at 58px font
_LINE_LINGER    = 0.12   # seconds last word in chunk stays visible


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts(sec: float) -> str:
    h  = int(sec // 3600)
    m  = int((sec % 3600) // 60)
    s  = sec % 60
    cs = int(round((s - int(s)) * 100))
    return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"


def _colour_tag(colour: str) -> str:
    return "{\\1c" + colour + "}"


def _bold_tag(on: bool) -> str:
    return "{\\b1}" if on else "{\\b0}"


def _size_tag(fs: int) -> str:
    return "{\\fs" + str(fs) + "}"


def _reset_tag() -> str:
    return "{\\r}"


# ─────────────────────────────────────────────────────────────────────────────
# Per-word Dialogue engine
# ─────────────────────────────────────────────────────────────────────────────

def _build_per_word_events(
    words:     list[dict],
    sdef:      dict,
    fs:        int,
    fs_active: int,
) -> list[str]:
    """
    Fixed-line karaoke engine (v4).

    Words are grouped into fixed chunks of _MAX_PER_LINE.
    For each active word position within a chunk, ONE Dialogue event is
    emitted. The line text is identical across all events in the chunk —
    only the colour tags change. The caption line stays visually static
    (no words sliding in/out) — reader tracks the highlight, not the text.

    This matches TikTok/CapCut rendering.
    """
    events = []
    n      = len(words)

    for chunk_start in range(0, n, _MAX_PER_LINE):
        chunk          = words[chunk_start: chunk_start + _MAX_PER_LINE]
        chunk_end_time = chunk[-1]["end"] + _LINE_LINGER

        for local_i, w in enumerate(chunk):
            t_start = w["start"]

            # End = next word start (no gap, no overlap within chunk)
            if local_i + 1 < len(chunk):
                t_end = chunk[local_i + 1]["start"]
            else:
                # Last word: linger, but clamp to next chunk start
                next_start = words[chunk_start + _MAX_PER_LINE]["start"] \
                    if chunk_start + _MAX_PER_LINE < n else float("inf")
                t_end = min(chunk_end_time, next_start)

            # Build line — ALL words in chunk visible, colours differ only
            parts = []
            for j, ctx_word in enumerate(chunk):
                text = ctx_word["text"].strip()
                if not text:
                    continue
                if j == local_i:
                    tag = (
                        _reset_tag()
                        + _colour_tag(sdef["active_colour"])
                        + (_bold_tag(True) if sdef["active_bold"] else "")
                        + _size_tag(fs_active)
                    )
                elif j < local_i:
                    tag = _reset_tag() + _colour_tag(sdef["past_colour"])
                else:
                    tag = _reset_tag() + _colour_tag(sdef["future_colour"])
                parts.append(f"{tag}{text}")

            events.append(
                f"Dialogue: 0,{_ts(t_start)},{_ts(t_end)},Cap,,0,0,0,,{' '.join(parts)}"
            )

    return events


def _build_legacy_karaoke_events(words: list[dict]) -> list[str]:
    """Native \\kf karaoke — only used for style='karaoke'."""
    events = []
    for chunk_i in range(0, len(words), _MAX_WORDS_PER_LINE):
        chunk  = words[chunk_i: chunk_i + _MAX_WORDS_PER_LINE]
        t_in   = chunk[0]["start"]
        t_out  = chunk[-1]["end"] + 0.18
        parts  = []
        for w in chunk:
            dur_cs = max(1, int(round((w["end"] - w["start"]) * 100)))
            parts.append(f"{{\\kf{dur_cs}}}{w['text'].strip()} ")
        events.append(
            f"Dialogue: 0,{_ts(t_in)},{_ts(t_out)},Cap,,0,0,0,,{''.join(parts).rstrip()}"
        )
    return events


# ─────────────────────────────────────────────────────────────────────────────
# ASS builder
# ─────────────────────────────────────────────────────────────────────────────

def _build_ass(
    transcript: dict,
    out_path:   pathlib.Path,
    cfg:        dict,
    script:     dict | None = None,
) -> pathlib.Path:
    sc  = cfg["subs"]
    vid = cfg["video"]
    fs      = sc.get("font_size",        58)   # reduced from ~80 → cleaner
    fs_hi   = sc.get("font_size_active", 66)   # active word slightly larger

    raw_style = (sc.get("style", "auto") or "auto").strip().lower()
    if raw_style == "auto":
        style = _auto_style_for_script(script)
        print(f"[captions] subs.style='auto' → resolved to '{style}'")
    else:
        style = raw_style
        print(f"[captions] Caption style: {style}")

    sdef = _get_style_def(style, fs)

    header = _HEADER_TMPL.format(
        w=vid["width"],
        h=vid["height"],
        style_line=sdef["ass_style_line"],
    )

    all_words: list[dict] = []
    for seg in transcript.get("segments", []):
        words = seg.get("words", [])
        if not words:
            # No word-level timestamps — treat segment as single word
            words = [{"text": seg["text"], "start": seg["start"], "end": seg["end"]}]
        all_words.extend(words)

    # Build Dialogue events
    if sdef["active_colour"] is None:
        # Legacy karaoke path
        dialogue_lines = _build_legacy_karaoke_events(all_words)
    else:
        # Per-word engine (all other styles)
        dialogue_lines = _build_per_word_events(all_words, sdef, fs, fs_hi)

    content = header + "\n".join(dialogue_lines) + "\n"
    out_path.write_text(content, encoding="utf-8")
    print(f"[captions] ✓ captions.ass — {len(dialogue_lines)} events  [{style}]  "
          f"fs={fs}/{fs_hi}")
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

    script (optional) — when provided AND cfg.subs.style == 'auto',
    the caption style is derived from script.style / global.voice_style.
    """
    sc = cfg["subs"]
    transcript = _transcribe(wav_path, sc["whisper_model"], sc["language"])

    (out_dir / "transcript.json").write_text(
        json.dumps(transcript, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    ass_path = out_dir / "captions.ass"
    return _build_ass(transcript, ass_path, cfg, script=script)


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
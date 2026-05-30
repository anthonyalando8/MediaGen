"""
captions.py  —  Word-level captions via whisper-timestamped → ASS format.

v4 — CINEMATIC CAPTION DIRECTOR
────────────────────────────────────────────────────────────────────
The old engine grouped words into fixed 5-word chunks and rendered every
chunk identically (a moving highlight). It "thought in words".

This version thinks in EMOTIONAL PHRASES. caption_director.py chunks the
word stream into phrases, finds hero words, picks a choreography mode per
phrase, and adapts everything to the beat's emotion/energy/pace/intensity.
captions.py then RENDERS each mode to animated ASS using libass override
tags (\\pos, \\an, \\t scale, \\fad, \\fscx/\\fscy, \\1c, \\b, \\blur).

Choreography modes (per phrase):
    standard    phrase shown, active word pops as it's spoken
    stacked     long phrase on two lines
    impact      whole phrase slams in with a scale punch
    hero        single event word fills the frame, replaces flow, holds
    isolated    short phrase alone, centred, generous air
    escalation  each word renders progressively larger
    whisper     small, dim, low — reflective beats
    split       phrase split across its internal pause

Caption styles (set via config.yaml subs.style) still select the palette /
font treatment (documentary, minimal, bold_drop, glow, neon, karaoke, auto).
The DIRECTOR controls layout + motion; the STYLE controls colour + weight.
"""

import pathlib
import json

from .caption_director import direct_transcript, CaptionUnit, CapWord


# ─────────────────────────────────────────────────────────────────────────────
# ASS colour helpers
# ─────────────────────────────────────────────────────────────────────────────
def _rgba(r: int, g: int, b: int, a: int = 0) -> str:
    """ASS colour: &HAABBGGRR  (alpha 00=opaque, FF=transparent)"""
    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"

_WHITE       = _rgba(255, 255, 255)
_WHITE_DIM   = _rgba(255, 255, 255, 128)
_BLACK       = _rgba(0,   0,   0  )
_YELLOW      = _rgba(255, 255, 0  )
_CYAN_LIGHT  = _rgba(180, 240, 255)
_CYAN_HOT    = _rgba(80,  220, 255)
_CYAN_NEON   = _rgba(0,   255, 240)
_TRANS       = _rgba(0,   0,   0,  255)
_BOX_DARK    = _rgba(0,   0,   0,  96 )
_GREY_MID    = _rgba(160, 160, 160)


# ─────────────────────────────────────────────────────────────────────────────
# AUTO-STYLE MAPPING (unchanged)
# ─────────────────────────────────────────────────────────────────────────────
_CAPTION_BY_SCRIPT_STYLE = {
    "contrarian": "bold_drop", "builder": "bold_drop", "intense": "documentary",
    "cinematic": "documentary", "calm": "minimal", "analytical": "minimal",
    "humorous": "glow",
}
_CAPTION_BY_VOICE_STYLE = {
    "calm_intense": "documentary", "storyteller": "glow", "aggressive": "bold_drop",
    "documentary": "documentary", "dramatic": "documentary", "analytical": "minimal",
    "comedic": "glow",
}
_FALLBACK_STYLE = "documentary"


def _auto_style_for_script(script: dict | None) -> str:
    if not script:
        return _FALLBACK_STYLE
    s = (script.get("style", "") or "").strip().lower()
    if s in _CAPTION_BY_SCRIPT_STYLE:
        return _CAPTION_BY_SCRIPT_STYLE[s]
    v = (script.get("global", {}) or {}).get("voice_style", "").strip().lower()
    if v in _CAPTION_BY_VOICE_STYLE:
        return _CAPTION_BY_VOICE_STYLE[v]
    return _FALLBACK_STYLE


# ─────────────────────────────────────────────────────────────────────────────
# Style definitions — palette + weight only (director owns layout/motion)
# ─────────────────────────────────────────────────────────────────────────────
def _get_style_def(style: str, fs: int) -> dict:
    common = dict(active_colour=_CYAN_LIGHT, past_colour=_WHITE, future_colour=_WHITE_DIM,
                  active_bold=True, outline=1.5, shadow=0, back_colour=_TRANS)
    if style == "documentary":
        return dict(common, ass_style_line=(
            f"Style: Cap,Space Grotesk,{fs},{_WHITE},{_TRANS},{_rgba(0,0,0,180)},{_TRANS},"
            f"0,0,0,0,100,100,0,0,1,1.5,0,2,80,80,160,1"))
    if style == "minimal":
        return dict(common, active_bold=False, outline=1, ass_style_line=(
            f"Style: Cap,Space Grotesk,{fs},{_WHITE},{_TRANS},{_rgba(0,0,0,160)},{_TRANS},"
            f"0,0,0,0,100,100,0,0,1,1,0,2,80,80,160,1"))
    if style == "bold_drop":
        sh = _rgba(0, 0, 0, 40)
        return dict(common, active_colour=_YELLOW, outline=2, shadow=4, back_colour=sh,
                    ass_style_line=(
            f"Style: Cap,Space Grotesk,{fs},{_WHITE},{_TRANS},{_BLACK},{sh},"
            f"1,0,0,0,100,100,0,0,1,2,4,2,80,80,160,1"))
    if style == "glow":
        return dict(common, outline=5, ass_style_line=(
            f"Style: Cap,Space Grotesk,{fs},{_WHITE},{_TRANS},{_rgba(0,0,0,200)},{_TRANS},"
            f"1,0,0,0,100,100,0,0,1,1.5,0,2,80,80,160,1"))
    if style == "neon":
        return dict(common, active_colour=_CYAN_NEON, outline=2, back_colour=_BOX_DARK,
                    ass_style_line=(
            f"Style: Cap,Space Grotesk,{fs},{_WHITE},{_TRANS},{_BLACK},{_BOX_DARK},"
            f"1,0,0,0,100,100,0,0,1,2,0,2,80,80,160,1"))
    # karaoke fallback keeps the legacy look (still director-chunked)
    return dict(common, active_colour=_YELLOW, outline=4, shadow=2, back_colour=_rgba(0, 0, 0, 96),
                ass_style_line=(
        f"Style: Cap,Space Grotesk,{fs},{_WHITE},{_rgba(0,0,0,255)},{_BLACK},{_rgba(0,0,0,96)},"
        f"1,0,0,0,100,100,0,0,1,4,2,2,80,80,160,1"))


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


# ─────────────────────────────────────────────────────────────────────────────
# Frame geometry — CAPTION SAFE ZONE
# ----------------------------------------------------------------------------
# Captions and scene typography are composited in SEPARATE passes (captions are
# burned last by libass — the scene cannot react to them). So they coexist via a
# static ZONE CONTRACT: the scene keyword owns the centre, captions own the lower
# band. NOTHING renders at frame centre, so captions never collide with the
# scene's own title. The scene already reserves --safe-bot:500px for this band.
# ─────────────────────────────────────────────────────────────────────────────
def _geom(w: int, h: int) -> dict:
    return dict(
        cx=w // 2,
        # bottom-anchored baseline for line modes (an=2): grows UP within the zone
        band_base_y=int(h * 0.90),    # ≈1728 — standard / stacked / split
        low_y=int(h * 0.925),         # ≈1776 — whisper (sits lowest)
        # centred within the band (an=5) for the "event" modes
        band_center_y=int(h * 0.82),  # ≈1574 — hero / impact / isolated / escalation
        scrim_top=int(h * 0.66),      # gradient scrim starts here, fades upward
        line_gap=int(h * 0.052),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Time + tag helpers
# ─────────────────────────────────────────────────────────────────────────────
def _ts(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    cs = int(round((s - int(s)) * 100))
    if cs == 100:
        cs = 0
        s += 1
    return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"


def _c(colour: str) -> str:   return "{\\1c" + colour + "}"
def _b(on: bool) -> str:      return "{\\b1}" if on else "{\\b0}"
def _fs(size: int) -> str:    return "{\\fs" + str(int(size)) + "}"
def _r() -> str:              return "{\\r}"


def _ms(sec: float) -> int:
    return int(round(sec * 1000))


# ─────────────────────────────────────────────────────────────────────────────
# Per-mode renderers — each returns a list of Dialogue lines
# ─────────────────────────────────────────────────────────────────────────────
class _Renderer:
    def __init__(self, sdef: dict, geom: dict, fs: int, fs_hi: int):
        self.s = sdef
        self.g = geom
        self.fs = fs
        self.fs_hi = fs_hi

    # -- colour for a word given its role at the active index --------------
    def _word_colour(self, w, j, active_i):
        # Strict karaoke roles: ONLY the active word is highlighted. (Tier-1
        # "event" words used to pre-glow in the active colour — that read as a
        # not-yet-spoken word being highlighted, which was confusing. Event
        # emphasis now lives at the MODE level: hero / impact, not per-word.)
        if j == active_i:
            return self.s["active_colour"]
        if j < active_i:
            return self.s["past_colour"]
        return self.s["future_colour"]

    def _word_size(self, w, j, active_i, base):
        size = base
        if w.tier == 1:
            size = int(base * 1.18)
        if j == active_i:
            size = max(size, self.fs_hi)
        return size

    # -- STANDARD / STACKED: static line in the lower band, highlight walks --
    def standard(self, u: CaptionUnit, layer=1):
        return self._walking_line(u, anchor=2, y=self.g["band_base_y"], layer=layer)

    def stacked(self, u: CaptionUnit, layer=1):
        return self._walking_line(u, anchor=2, y=self.g["band_base_y"], stacked=True, layer=layer)

    def whisper(self, u: CaptionUnit, layer=1):
        return self._walking_line(u, anchor=2, y=self.g["low_y"],
                                  base=int(self.fs * 0.78), dim_all=True, fade=(180, 220), layer=layer)

    def split(self, u: CaptionUnit, layer=1):
        return self._walking_line(u, anchor=2, y=self.g["band_base_y"], split=True, layer=layer)

    def _walking_line(self, u, anchor, y, base=None, stacked=False, dim_all=False,
                      fade=None, split=False, layer=1):
        base = base or self.fs
        events = []
        words = u.words
        n = len(words)
        cx = self.g["cx"]
        fin, fout = fade or (90, 90)

        # one Dialogue per active-word window; the whole phrase stays visible.
        for i in range(n):
            t_start = words[i].start
            t_end = words[i + 1].start if i + 1 < n else u.end
            parts = []
            for j, w in enumerate(words):
                col = self._word_colour(w, j, i)
                if dim_all and j != i:
                    col = self.s["future_colour"]
                # ACTIVE word = colour + a VERTICAL-ONLY scale pop (\fscy).
                # Vertical scale doesn't change advance width, so the line never
                # reflows → "bigger == being spoken" with zero horizontal shift.
                # All words share ONE font size (no constant tier bump → no
                # non-spoken word looks permanently large).
                pop = "{\\fscy118}" if (j == i and not dim_all) else ""
                tag = _r() + _c(col) + pop + _fs(base)
                nl = ""
                if (stacked or split) and j > 0 and j == (n + 1) // 2:
                    nl = "\\N"
                parts.append(f"{nl}{tag}{w.text.strip()}")
            # FADE ONLY AT PHRASE BOUNDARIES. Fading every word-event made the
            # caption flash out→in at each highlight step (the flicker).
            if n == 1:
                ftag = "{\\fad(%d,%d)}" % (fin, fout)
            elif i == 0:
                ftag = "{\\fad(%d,0)}" % fin
            elif i == n - 1:
                ftag = "{\\fad(0,%d)}" % fout
            else:
                ftag = ""
            txt = f"{{\\an{anchor}}}{{\\pos({cx},{y})}}{ftag}" + " ".join(parts).replace(" \\N", "\\N")
            events.append(f"Dialogue: {layer},{_ts(t_start)},{_ts(t_end)},Cap,,0,0,0,,{txt}")
        return events

    # -- IMPACT: whole phrase slams into the band, then walks -------------
    def impact(self, u: CaptionUnit, layer=1):
        events = []
        words = u.words
        n = len(words)
        cx, y = self.g["cx"], self.g["band_center_y"]
        # entrance event: scale punch 118 → 100 over 220ms + fade
        ent_end = min(u.words[0].start + 0.22, u.end)
        intro = (f"{{\\an5}}{{\\pos({cx},{y})}}{{\\fad(60,0)}}"
                 f"{{\\fscx118\\fscy118}}{{\\t(0,220,\\fscx100\\fscy100)}}"
                 + " ".join(_r() + _c(self.s["future_colour"]) + _fs(int(self.fs * 1.05)) + w.text.strip()
                           for w in words))
        events.append(f"Dialogue: {layer},{_ts(u.words[0].start)},{_ts(ent_end)},Cap,,0,0,0,,{intro}")
        # then walking highlight, centred in the band
        for i in range(n):
            t_start = max(words[i].start, ent_end if i == 0 else words[i].start)
            t_end = words[i + 1].start if i + 1 < n else u.end
            if t_end <= t_start:
                continue
            parts = []
            for j, w in enumerate(words):
                col = self._word_colour(w, j, i)
                pop = "{\\fscy118}" if j == i else ""
                tag = _r() + _c(col) + pop + _fs(int(self.fs * 1.05))
                parts.append(f"{tag}{w.text.strip()}")
            txt = f"{{\\an5}}{{\\pos({cx},{y})}}" + " ".join(parts)
            events.append(f"Dialogue: {layer},{_ts(t_start)},{_ts(t_end)},Cap,,0,0,0,,{txt}")
        return events

    # -- ISOLATED: short phrase alone, centred in the band, gentle scale-in --
    def isolated(self, u: CaptionUnit, layer=1):
        words = u.words
        n = len(words)
        cx, y = self.g["cx"], self.g["band_center_y"]
        size = int(self.fs * 1.4)
        events = []
        for i in range(n):
            t_start = words[i].start
            t_end = words[i + 1].start if i + 1 < n else u.end
            parts = []
            for j, w in enumerate(words):
                col = self.s["active_colour"] if j == i else (self.s["past_colour"] if j < i else self.s["future_colour"])
                tag = _r() + _c(col) + _b(True) + _fs(size)
                parts.append(f"{tag}{w.text.strip()}")
            anim = "{\\fad(140,0)}{\\fscx92\\fscy92}{\\t(0,260,\\fscx100\\fscy100)}" if i == 0 else "{\\fad(0,160)}" if i == n - 1 else ""
            txt = f"{{\\an5}}{{\\pos({cx},{y})}}{anim}" + " ".join(parts)
            events.append(f"Dialogue: {layer},{_ts(t_start)},{_ts(t_end)},Cap,,0,0,0,,{txt}")
        return events

    # -- ESCALATION: each word progressively larger, centred in the band ---
    def escalation(self, u: CaptionUnit, layer=1):
        words = u.words
        n = len(words)
        cx, y = self.g["cx"], self.g["band_center_y"]
        events = []
        for i in range(n):
            t_start = words[i].start
            t_end = words[i + 1].start if i + 1 < n else u.end
            parts = []
            for j, w in enumerate(words):
                grow = 1.0 + j * 0.26
                size = int(self.fs * grow)
                col = self.s["active_colour"] if j == i else (self.s["past_colour"] if j < i else self.s["future_colour"])
                tag = _r() + _c(col) + _b(True) + _fs(size)
                parts.append(f"{tag}{w.text.strip()}")
            # boundary-only fade (per-event fade flickered)
            if n == 1:
                ftag = "{\\fad(80,80)}"
            elif i == 0:
                ftag = "{\\fad(80,0)}"
            elif i == n - 1:
                ftag = "{\\fad(0,80)}"
            else:
                ftag = ""
            txt = f"{{\\an5}}{{\\pos({cx},{y})}}{ftag}" + " ".join(parts)
            events.append(f"Dialogue: {layer},{_ts(t_start)},{_ts(t_end)},Cap,,0,0,0,,{txt}")
        return events

    # -- HERO: single event word dominates the band, holds ----------------
    def hero(self, u: CaptionUnit, layer=1):
        hi = u.lines[0][0] if u.lines and u.lines[0] else 0
        w = u.words[hi]
        cx, y = self.g["cx"], self.g["band_center_y"]
        size = int(self.fs * 3.0)        # big, but sized to live IN the band (not frame-centre)
        col = self.s["active_colour"]
        # scale-in with overshoot + long hold + soft out
        anim = ("{\\fad(120,200)}"
                "{\\fscx40\\fscy40}{\\t(0,180,\\fscx108\\fscy108)}{\\t(180,300,\\fscx100\\fscy100)}")
        txt = f"{{\\an5}}{{\\pos({cx},{y})}}{anim}{_c(col)}{_b(True)}{_fs(size)}{w.text.strip().upper()}"
        return [f"Dialogue: {layer},{_ts(u.start)},{_ts(u.end)},Cap,,0,0,0,,{txt}"]


_MODE_FN = {
    "standard": "standard", "stacked": "stacked", "impact": "impact",
    "hero": "hero", "isolated": "isolated", "escalation": "escalation",
    "whisper": "whisper", "split": "split",
}


# ─────────────────────────────────────────────────────────────────────────────
# Caption scrim — a feathered gradient backing burned UNDER the captions
# (Layer 0; text is Layer 1+). Gives legibility over any photo/scene without
# hiding the scene. Three stacked, blurred, increasingly-opaque black bands fake
# a smooth bottom-up gradient. Present only during contiguous caption runs, so
# pure-visual beats stay clean. Toggle via cfg.subs.scrim (default True).
# ─────────────────────────────────────────────────────────────────────────────
_SCRIM_STYLE = (
    "Style: Scrim,Space Grotesk,10,&H00000000,&H000000FF,&H00000000,&H00000000,"
    "0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1"
)
# (y-fraction where this band starts, primary-alpha 00=opaque..FF=clear)
_SCRIM_BANDS = [(0.64, "E6"), (0.77, "B4"), (0.87, "72")]


def _merge_runs(units: list[CaptionUnit], max_gap: float = 0.5) -> list[tuple[float, float]]:
    """Collapse caption units into contiguous on-screen runs (for the scrim)."""
    runs: list[list[float]] = []
    for u in units:
        if runs and u.start - runs[-1][1] <= max_gap:
            runs[-1][1] = max(runs[-1][1], u.end)
        else:
            runs.append([u.start, u.end])
    return [(a, b) for a, b in runs]


def _scrim_events(units: list[CaptionUnit], w: int, h: int) -> list[str]:
    events = []
    for t0, t1 in _merge_runs(units):
        for y_frac, alpha in _SCRIM_BANDS:
            top = int(h * y_frac)
            rh = (h - top) + 80          # run off the bottom edge so only the top feathers
            draw = (f"{{\\an7\\pos(-60,{top})\\bord0\\shad0\\blur28"
                    f"\\1c&H000000&\\1a&H{alpha}&\\p1}}"
                    f"m 0 0 l {w + 120} 0 {w + 120} {rh} 0 {rh}{{\\p0}}")
            events.append(f"Dialogue: 0,{_ts(t0)},{_ts(t1)},Scrim,,0,0,0,,{{\\fad(150,180)}}{draw}")
    return events


# ─────────────────────────────────────────────────────────────────────────────
# ASS builder
# ─────────────────────────────────────────────────────────────────────────────
def _build_ass(transcript: dict, out_path: pathlib.Path, cfg: dict,
               script: dict | None = None) -> pathlib.Path:
    sc = cfg["subs"]
    vid = cfg["video"]
    fs    = sc.get("font_size",        58)
    fs_hi = sc.get("font_size_active", 66)

    raw_style = (sc.get("style", "auto") or "auto").strip().lower()
    if raw_style == "auto":
        style = _auto_style_for_script(script)
        print(f"[captions] subs.style='auto' → resolved to '{style}'")
    else:
        style = raw_style
        print(f"[captions] Caption style: {style}")

    sdef = _get_style_def(style, fs)
    geom = _geom(vid["width"], vid["height"])

    scrim_on = sc.get("scrim", True)
    style_block = sdef["ass_style_line"]
    if scrim_on:
        style_block = style_block + "\n" + _SCRIM_STYLE
    header = _HEADER_TMPL.format(w=vid["width"], h=vid["height"], style_line=style_block)

    # DIRECT: transcript → choreographed caption units
    units = direct_transcript(transcript, script, seed=sc.get("seed", 7))

    # GLOBAL de-overlap. direct_beat schedules units PER BEAT, so a hold on a
    # beat's last phrase (hero +0.7s, isolated +0.4s) can overrun the FIRST
    # phrase of the next beat → two captions on screen at once. Clamp every
    # unit to clear out before the next one begins, across the whole video.
    _GAP = 0.04
    for i in range(len(units) - 1):
        u, nxt = units[i], units[i + 1]
        min_end = u.words[-1].start + 0.06        # keep the last word briefly visible
        target = nxt.start - _GAP
        if u.end > target:
            u.end = max(min_end, target)

    renderer = _Renderer(sdef, geom, fs, fs_hi)
    dialogue: list[str] = []
    # scrim first (Layer 0 — under the text)
    if scrim_on:
        dialogue.extend(_scrim_events(units, vid["width"], vid["height"]))
    mode_counts: dict[str, int] = {}
    for u in units:
        fn = getattr(renderer, _MODE_FN.get(u.mode, "standard"))
        dialogue.extend(fn(u))
        mode_counts[u.mode] = mode_counts.get(u.mode, 0) + 1

    content = header + "\n".join(dialogue) + "\n"
    out_path.write_text(content, encoding="utf-8")
    summary = " ".join(f"{k}:{v}" for k, v in sorted(mode_counts.items()))
    print(f"[captions] ✓ captions.ass — {len(units)} phrases, {len(dialogue)} events "
          f"[{style}] fs={fs}/{fs_hi}")
    print(f"[captions]   choreography: {summary}")
    return out_path


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────
def generate_captions(wav_path: pathlib.Path, out_dir: pathlib.Path, cfg: dict,
                      script: dict | None = None) -> pathlib.Path:
    sc = cfg["subs"]
    transcript = _transcribe(wav_path, sc["whisper_model"], sc["language"])
    (out_dir / "transcript.json").write_text(
        json.dumps(transcript, indent=2, ensure_ascii=False), encoding="utf-8")
    ass_path = out_dir / "captions.ass"
    return _build_ass(transcript, ass_path, cfg, script=script)


# ─────────────────────────────────────────────────────────────────────────────
# Transcription (unchanged)
# ─────────────────────────────────────────────────────────────────────────────
def _transcribe(wav_path: pathlib.Path, model_size: str, language: str) -> dict:
    import whisper_timestamped as wt
    print(f"[captions] Transcribing with whisper-timestamped (model={model_size})…")
    model = wt.load_model(model_size)
    audio = wt.load_audio(str(wav_path))
    return wt.transcribe(model, audio, language=language,
                         detect_disfluencies=False, verbose=False)

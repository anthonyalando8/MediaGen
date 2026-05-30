"""
caption_director.py  —  The caption "brain" (production port of caption-director.js)

Turns a flat whisper word stream into choreographed CAPTION UNITS — emotional
phrases and hero events — that captions.py renders to animated ASS.

This is pure decision logic. It does NOT touch ASS, ffmpeg, or whisper. It answers
only: WHAT to show, WHEN, HOW BIG, and in WHICH choreography mode.

Pipeline:
    words → chunk_phrases() → classify_heroes() → choose_mode() → schedule()
          → [CaptionUnit]

Mirrors renderer/lab/caption-director.js 1:1 so the Caption Lab preview matches
the rendered output. Keep the two in sync when tuning.
"""

from __future__ import annotations
import re
import random
from dataclasses import dataclass, field


# ─────────────────────────────────────────────────────────────────────────────
# Lexicons
# ─────────────────────────────────────────────────────────────────────────────
ABSOLUTES = {
    "never", "nothing", "everything", "always", "nobody", "everyone", "none",
    "stop", "all", "forever", "gone", "dead", "over", "done", "lost", "everywhere",
    "anyone", "no", "yes", "now", "today", "tonight", "wrong", "lie", "lied", "lies",
}
ABSOLUTE_PAIRS = {
    "too late", "no one", "not for you", "already gone", "game over", "years ago",
}
NUMBER_WORDS = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "twenty", "thirty", "forty", "fifty", "hundred", "thousand",
    "million", "billion", "dozen", "half", "double", "triple",
}
TIME_UNITS = {
    "second", "seconds", "minute", "minutes", "hour", "hours", "day", "days",
    "week", "weeks", "month", "months", "year", "years", "decade", "decades",
}
BREAK_BEFORE = {
    "until", "but", "because", "so", "and", "then", "when", "before", "after",
    "while", "even", "yet", "still", "unless", "though", "although", "which",
    "who", "that", "or", "if", "once", "since",
}


def _strip(t: str) -> str:
    return re.sub(r"[^A-Za-z0-9']", "", t or "")


def _lower(t: str) -> str:
    return _strip(t).lower()


def _is_all_caps(t: str) -> bool:
    s = _strip(t)
    return len(s) > 2 and s == s.upper() and bool(re.search(r"[A-Z]", s))


def _is_numeric(t: str) -> bool:
    return bool(re.search(r"\d", t)) or _lower(t) in NUMBER_WORDS


# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class CapWord:
    text: str
    start: float
    end: float
    emph: bool = False
    tier: int = 3          # 1 = event, 2 = strong, 3 = normal


@dataclass
class CaptionUnit:
    words: list[CapWord]
    start: float
    end: float
    mode: str = "standard"
    hold: float = 0.0
    lines: list[list[int]] = field(default_factory=list)
    profile: dict = field(default_factory=dict)
    beat_index: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# Emotion → behaviour profile
# ─────────────────────────────────────────────────────────────────────────────
_BASE = dict(
    pauseThreshold=0.30, minWords=2, maxWords=5, maxDur=2.4,
    leadIn=0.06, linger=0.22, activeBoost=1.22, heroBudget=2, allowHero=True,
    pauseVisible=0.55, snap=0.55, dim=0.50,
    modeBias={"standard": 3, "stacked": 2, "isolated": 1},
)

_EMOTION = {
    "urgent":     dict(pauseThreshold=0.24, maxWords=4, maxDur=1.8, linger=0.16, activeBoost=1.45, snap=0.9,  heroBudget=2, modeBias={"impact": 3, "standard": 2, "hero": 2, "escalation": 1}),
    "angry":      dict(pauseThreshold=0.22, maxWords=4, maxDur=1.7, linger=0.14, activeBoost=1.5,  snap=1.0,  heroBudget=2, modeBias={"impact": 4, "hero": 2, "standard": 1}),
    "anxious":    dict(pauseThreshold=0.26, maxWords=4, maxDur=1.9, linger=0.18, activeBoost=1.3,  snap=0.85, heroBudget=1, modeBias={"split": 3, "impact": 2, "standard": 2}),
    "tense":      dict(pauseThreshold=0.32, maxWords=4, maxDur=2.1, linger=0.30, activeBoost=1.28, snap=0.7,  heroBudget=1, pauseVisible=0.42, modeBias={"split": 3, "isolated": 2, "standard": 2, "impact": 1}),
    "serious":    dict(pauseThreshold=0.36, maxWords=5, maxDur=2.4, linger=0.34, activeBoost=1.2,  snap=0.4,  heroBudget=1, modeBias={"standard": 3, "isolated": 2, "stacked": 1}),
    "cold":       dict(pauseThreshold=0.40, maxWords=5, maxDur=2.6, linger=0.40, activeBoost=1.18, snap=0.3,  heroBudget=1, modeBias={"isolated": 3, "standard": 2, "stacked": 1}),
    "melancholic":dict(pauseThreshold=0.44, maxWords=5, maxDur=2.8, linger=0.52, activeBoost=1.15, snap=0.2,  heroBudget=1, pauseVisible=0.40, modeBias={"whisper": 3, "isolated": 2, "standard": 2}),
    "confident":  dict(pauseThreshold=0.30, maxWords=4, maxDur=2.1, linger=0.24, activeBoost=1.35, snap=0.75, heroBudget=2, modeBias={"escalation": 3, "impact": 2, "standard": 2, "hero": 1}),
    "hopeful":    dict(pauseThreshold=0.32, maxWords=5, maxDur=2.3, linger=0.28, activeBoost=1.25, snap=0.5,  heroBudget=1, modeBias={"standard": 3, "stacked": 2, "isolated": 1}),
    "playful":    dict(pauseThreshold=0.28, maxWords=4, maxDur=2.0, linger=0.20, activeBoost=1.3,  snap=0.8,  heroBudget=1, modeBias={"standard": 2, "impact": 2, "isolated": 1, "escalation": 1}),
    "amused":     dict(pauseThreshold=0.28, maxWords=4, maxDur=2.0, linger=0.22, activeBoost=1.28, snap=0.75, heroBudget=1, modeBias={"standard": 3, "impact": 1, "isolated": 1}),
    "surprised":  dict(pauseThreshold=0.24, maxWords=3, maxDur=1.6, linger=0.18, activeBoost=1.45, snap=0.95, heroBudget=2, modeBias={"impact": 3, "hero": 2, "isolated": 1}),
}


def profile_for(beat: dict) -> dict:
    p = dict(_BASE)
    p["modeBias"] = dict(_BASE["modeBias"])
    e = _EMOTION.get((beat.get("emotion") or "").strip().lower())
    if e:
        for k, v in e.items():
            p[k] = dict(v) if k == "modeBias" else v

    energy = (beat.get("energy") or "mid").lower()
    e_mul = 1.15 if energy == "high" else 0.85 if energy == "low" else 1.0
    p["activeBoost"] = 1 + (p["activeBoost"] - 1) * e_mul
    if energy == "low":
        p["heroBudget"] = max(0, p["heroBudget"] - 1)

    pace = (beat.get("pace") or "mid").lower()
    t_mul = {"explosive": 0.6, "fast": 0.78, "slow": 1.3}.get(pace, 1.0)
    p["pauseThreshold"] *= t_mul
    p["linger"] *= t_mul
    if pace == "slow":
        p["maxDur"] *= 1.15
    if pace in ("explosive", "fast"):
        p["modeBias"]["impact"] = p["modeBias"].get("impact", 0) + 2

    intensity = beat.get("intensity")
    intensity = intensity if isinstance(intensity, (int, float)) else 0.65
    if intensity >= 0.9:
        p["heroBudget"] += 1
        p["activeBoost"] += 0.08
    if intensity <= 0.5:
        p["heroBudget"] = max(0, p["heroBudget"] - 1)
        p["allowHero"] = p["heroBudget"] > 0
    p["intensity"] = intensity
    return p


# ─────────────────────────────────────────────────────────────────────────────
# 1. Phrase chunking
# ─────────────────────────────────────────────────────────────────────────────
def chunk_phrases(words: list[CapWord], p: dict) -> list[CaptionUnit]:
    phrases: list[list[CapWord]] = []
    cur: list[CapWord] = []

    for i, w in enumerate(words):
        nx = words[i + 1] if i + 1 < len(words) else None
        cur.append(w)
        end_punct = bool(re.search(r"[.!?]$", w.text))
        soft_punct = bool(re.search(r"[,;:—-]$", w.text))
        gap = (nx.start - w.end) if nx else float("inf")
        pivot = (_lower(nx.text) in BREAK_BEFORE) if nx else False
        dur = w.end - cur[0].start
        at_min = len(cur) >= p["minWords"]

        boundary = False
        if end_punct:
            boundary = True
        elif at_min and (soft_punct or gap >= p["pauseThreshold"] or pivot):
            boundary = True
        elif len(cur) >= p["maxWords"] or dur >= p["maxDur"]:
            boundary = True

        if boundary:
            phrases.append(cur)
            cur = []
    if cur:
        phrases.append(cur)

    return [CaptionUnit(words=ws, start=ws[0].start, end=ws[-1].end) for ws in phrases]


# ─────────────────────────────────────────────────────────────────────────────
# 2. Hero classification
# ─────────────────────────────────────────────────────────────────────────────
def classify_heroes(unit: CaptionUnit, highlight: set[str], p: dict) -> CaptionUnit:
    ws = unit.words
    for i, w in enumerate(ws):
        t = _lower(w.text)
        tier = 3
        if w.emph or t in highlight:
            tier = 2
        pair = (t + " " + _lower(ws[i + 1].text)) if i + 1 < len(ws) else ""
        num_unit = _is_numeric(w.text) and i + 1 < len(ws) and _lower(ws[i + 1].text) in TIME_UNITS
        if t in ABSOLUTES or pair in ABSOLUTE_PAIRS or num_unit or (_is_all_caps(w.text) and len(t) > 2):
            tier = 1
        w.tier = tier
    return unit


# ─────────────────────────────────────────────────────────────────────────────
# 3. Mode selection
# ─────────────────────────────────────────────────────────────────────────────
def choose_mode(unit: CaptionUnit, p: dict, rng: random.Random) -> str:
    ws = unit.words
    tier1 = [w for w in ws if w.tier == 1]
    n = len(ws)

    if p["allowHero"] and tier1 and (n <= 3 or len(tier1) >= 2):
        return "hero"

    w = dict(p["modeBias"])
    if n >= 5:
        w["stacked"] = w.get("stacked", 0) + 2
        w["isolated"] = 0
        w["hero"] = 0
    if n <= 2:
        w["isolated"] = w.get("isolated", 0) + 2
        w["stacked"] = 0
    if tier1:
        w["impact"] = w.get("impact", 0) + 1

    entries = [(k, v) for k, v in w.items() if v > 0]
    total = sum(v for _, v in entries)
    if not total:
        return "standard"
    r = rng.random() * total
    for k, v in entries:
        r -= v
        if r <= 0:
            return k
    return "standard"


# ─────────────────────────────────────────────────────────────────────────────
# Line layout
# ─────────────────────────────────────────────────────────────────────────────
def layout_lines(unit: CaptionUnit, mode: str) -> list[list[int]]:
    idx = list(range(len(unit.words)))
    if mode == "hero":
        hi, best = 0, 4
        for i, w in enumerate(unit.words):
            if w.tier < best:
                best, hi = w.tier, i
        return [[hi]]
    if mode == "isolated":
        return [idx]
    if mode == "stacked" and len(idx) >= 4:
        mid = (len(idx) + 1) // 2
        return [idx[:mid], idx[mid:]]
    return [idx]


# ─────────────────────────────────────────────────────────────────────────────
# 4. Schedule on-screen windows (timing psychology)
# ─────────────────────────────────────────────────────────────────────────────
def schedule(units: list[CaptionUnit], p: dict) -> list[CaptionUnit]:
    for i, u in enumerate(units):
        nxt = units[i + 1] if i + 1 < len(units) else None
        u.start = max(0.0, u.words[0].start - p["leadIn"])
        spoken_end = u.words[-1].end

        hold = p["linger"]
        if u.mode == "hero":
            hold = max(p["linger"], 0.7)
        elif u.mode == "isolated":
            hold = max(p["linger"], 0.4)
        elif u.mode == "impact":
            hold = max(p["linger"], 0.3)

        raw_end = spoken_end + hold
        if nxt:
            gap = nxt.words[0].start - spoken_end
            if gap >= p["pauseVisible"]:
                raw_end = min(raw_end, spoken_end + min(hold, gap * 0.5))
            raw_end = min(raw_end, nxt.start - 0.02)
        u.end = max(raw_end, spoken_end + 0.05)
        u.hold = hold
    return units


# ─────────────────────────────────────────────────────────────────────────────
# Top level
# ─────────────────────────────────────────────────────────────────────────────
def _words_from_transcript_words(raw: list[dict]) -> list[CapWord]:
    out = []
    for w in raw:
        txt = (w.get("text") or w.get("word") or "").strip()
        if not txt:
            continue
        out.append(CapWord(text=txt, start=float(w["start"]), end=float(w["end"])))
    return out


def _mark_emphasis(words: list[CapWord], highlight: set[str]) -> None:
    """Flag words whose cleaned form is in the beat's highlight/emphasis set."""
    for w in words:
        if _lower(w.text) in highlight:
            w.emph = True


def direct_beat(beat: dict, words: list[CapWord], seed: int = 0) -> list[CaptionUnit]:
    """Produce choreographed caption units for one beat's word span."""
    p = profile_for(beat)

    highlight: set[str] = set()
    for h in (beat.get("highlight_words") or []):
        highlight.add(_lower(h))
    for m in re.findall(r"\*([^*]+)\*", beat.get("text") or ""):
        for x in m.split():
            highlight.add(_lower(x))

    _mark_emphasis(words, highlight)

    units = chunk_phrases(words, p)
    rng = random.Random(seed + 1)
    hero_used = 0
    for u in units:
        classify_heroes(u, highlight, p)
        mode = choose_mode(u, p, rng)
        if mode == "hero":
            if hero_used >= p["heroBudget"]:
                mode = "impact"
            else:
                hero_used += 1
        u.mode = mode
        u.lines = layout_lines(u, mode)
        u.profile = p
        u.beat_index = beat.get("beat_index", 0)

    schedule(units, p)
    return units


def direct_transcript(transcript: dict, script: dict | None, seed: int = 7) -> list[CaptionUnit]:
    """
    Whole-video entry point. Aligns transcript words to script beats by sequential
    text matching so each phrase inherits its beat's emotion/energy/pace/highlights,
    then directs each beat's span. Falls back to a single neutral beat if no script.
    """
    all_words: list[CapWord] = []
    for seg in transcript.get("segments", []):
        ws = seg.get("words") or [{"text": seg["text"], "start": seg["start"], "end": seg["end"]}]
        all_words.extend(_words_from_transcript_words(ws))

    if not all_words:
        return []

    beats = (script or {}).get("beats") or []
    if not beats:
        neutral = {"emotion": "serious", "energy": "mid", "pace": "mid", "intensity": 0.6, "beat_index": 0}
        return direct_beat(neutral, all_words, seed)

    # Sequential alignment: walk word stream, advance to next beat when this
    # beat's spoken-word budget is consumed. Robust to small ASR differences
    # because it matches by COUNT of cleaned words per beat, in order.
    units: list[CaptionUnit] = []
    wi = 0
    for bi, beat in enumerate(beats):
        beat = dict(beat)
        beat.setdefault("beat_index", bi)
        beat_text = re.sub(r"\*", "", beat.get("text", ""))
        n_expected = max(1, len(_clean_tokens(beat_text)))
        span = all_words[wi: wi + n_expected]
        # extend the span to the next sentence end if we cut mid-sentence
        nxt = wi + n_expected
        while nxt < len(all_words) and not re.search(r"[.!?]$", all_words[nxt - 1].text) \
                and (nxt - (wi + n_expected)) < 4:
            span.append(all_words[nxt])
            nxt += 1
        if not span:
            continue
        units.extend(direct_beat(beat, span, seed + bi))
        wi = nxt
        if wi >= len(all_words):
            break

    # any trailing words (ASR over-run) → neutral tail
    if wi < len(all_words):
        tail = {"emotion": "serious", "energy": "mid", "pace": "mid", "intensity": 0.6,
                "beat_index": len(beats)}
        units.extend(direct_beat(tail, all_words[wi:], seed + 99))

    return units


def _clean_tokens(text: str) -> list[str]:
    return [t for t in re.split(r"\s+", text) if _strip(t)]

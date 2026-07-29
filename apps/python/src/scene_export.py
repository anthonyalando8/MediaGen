"""
scene_export.py  —  Build ONE self-contained scene.json for the editor.

Replaces the render+assemble tail of the pipeline (visuals.render_slides →
capture.js Playwright → assemble ffmpeg). Instead of rasterising frames, it
emits the full editor scene contract the editor's `scene-import.ts` compiles
into an editable project.

Reuses the existing, proven pieces:
  • visuals._build_beat_contracts  — the cinematic per-beat contracts
    (hud/keyword/body/layout/camera/emphasis defaults). UNCHANGED.
  • captions.timeline.attach_to_contracts — merges beat-relative word_times +
    emphasis onto each contract. UNCHANGED.
  • visuals._style_to_theme / _THEME_PALETTES — theme → palette hex. UNCHANGED.

Adds the two things capture.js/assemble used to own, now baked into scene.json:
  • VISUALS: resolve a stock image per beat (media_resolve, moved out of
    capture.js) and embed it as a `data:` URL asset → beat.visual.
  • AUDIO: embed each Kokoro beat WAV as a `data:` URL asset → beat.audio,
    one voiceover track per beat at the beat's start (word_times are already
    beat-relative, so no VO offset math).

Output: <run_dir>/scene.json  — open it in the editor via File ▸ Import Scene…
(or load the saved .seabytes it becomes). No frames, no ffmpeg.
"""

from __future__ import annotations
import base64
import hashlib
import json
import pathlib
import re

from visuals import _build_beat_contracts, _style_to_theme, _THEME_PALETTES
from captions.timeline import attach_to_contracts
from media_resolve import resolve_visual, download_as_data_url, download_video_as_data_url
from formats import VisualProfile, MediaPlan
from audio_mix import compute_ducking_envelope


def _wav_data_url(path: pathlib.Path) -> str:
    b64 = base64.b64encode(pathlib.Path(path).read_bytes()).decode("ascii")
    return f"data:audio/wav;base64,{b64}"


# ── Background music (flat volume — see docs/architecture/
# phase5-6-longform-ingest-audio.md's "Background music" section for what
# this is and isn't) ─────────────────────────────────────────────────────
_BGM_EXTS = (".mp3", ".wav", ".m4a", ".ogg", ".flac")
_BGM_MIME = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac"}


def _select_bgm(bgm_dir: pathlib.Path, mood: str) -> pathlib.Path | None:
    """
    Picks one file from `bgm_dir` for this script's music, or None if the
    directory doesn't exist / is empty — background music is entirely
    opt-in by dropping files in, never a hard requirement (a script
    generated before any BGM files exist behaves exactly as it always has).

    Selection: an exact `<mood>.<ext>` match (case-insensitive) for the
    script's `global.music_mood` first (see assets/bgm/README.md for the
    mood vocabulary every format actually generates); falling back to a
    file literally named `default.<ext>`; falling back to the first file
    alphabetically — so dropping in even ONE file already gets background
    music working, no mood-matching required.
    """
    if not bgm_dir.is_dir():
        return None
    files = sorted(p for p in bgm_dir.iterdir() if p.is_file() and p.suffix.lower() in _BGM_EXTS)
    if not files:
        return None

    mood_norm = (mood or "").strip().lower()
    if mood_norm:
        for p in files:
            if p.stem.lower() == mood_norm:
                return p
    for p in files:
        if p.stem.lower() == "default":
            return p
    return files[0]


def _bgm_data_url(path: pathlib.Path) -> str:
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    mime = _BGM_MIME.get(path.suffix.lower(), "audio/mpeg")
    return f"data:{mime};base64,{b64}"


def _composition_size(cfg: dict, orientation: str) -> tuple[int, int]:
    """
    The scene's actual canvas width/height — derived from config.yaml's
    `video.width`/`video.height` (treated as the PORTRAIT baseline; that's
    what they've always meant — 1080x1920) and the format's
    `media.orientation`. Fixes a real gap: orientation used to only steer
    which stock photos got REQUESTED (media_resolve.py), never the actual
    composition size, so a landscape-media format still rendered into a
    portrait canvas. Portrait (the default; every format that doesn't set
    `media.orientation`) is byte-for-byte unchanged — this only branches for
    "landscape" (swap) and "square" (shorter side, both dimensions).
    """
    w, h = cfg["video"]["width"], cfg["video"]["height"]
    if orientation == "landscape":
        return h, w
    if orientation == "square":
        side = min(w, h)
        return side, side
    return w, h


# ── scene/3.0 shim: express legacy contracts as layers[] ─────────────────────
# See docs/scene-3.0-schema.md. Today every beat is the "text_over_dimmed"
# archetype (llm.py defaults it), so this function is the ONLY archetype
# handler that exists so far — it turns the flat contract fields this file
# already emits into the layers[] shape a future renderer/composer will read.
#
# Purely additive: `scene-import.ts` does not read `layers` yet (unrecognized
# beat keys are already ignored there today), so adding this cannot change a
# single pixel of current output — it only rides new, currently-inert JSON
# into scene.json ahead of the editor/composer work that will consume it.
_REVEAL_BY_PACE = {"slow": "fade", "mid": "slide", "fast": "mask", "explosive": "typewriter"}


def _synthesize_text_over_dimmed_layers(contract: dict) -> list[dict]:
    duration_ms = contract.get("duration_ms") or 5000
    layers: list[dict] = [{
        "role": "background",
        "source": {"query": contract.get("visual_query", "")},
        "fit": "cover",
        "animation": {"camera": contract.get("camera", "")},
        "in": 0, "out": None,
    }]

    body = (contract.get("body") or "").strip()
    if not body:
        return layers

    words = contract.get("word_times") or []
    text_in = int(round((words[0]["start_s"] if words else 0.0) * 1000))
    text_out_raw = words[-1]["end_s"] * 1000 if words else duration_ms
    text_out = min(duration_ms, int(round(text_out_raw)) + 250)  # brief hold after the last word

    # Scrim spans only the window text is actually on screen — the "dim
    # panel disappears once the words are read" composition a flat
    # background/dim field can't express on its own.
    intensity = contract.get("intensity")
    intensity = intensity if isinstance(intensity, (int, float)) else 0.5
    layers.append({
        "role": "scrim", "shape": "rect", "opacity": round(0.3 + 0.25 * intensity, 2),
        "in": text_in, "out": text_out,
    })
    layers.append({
        "role": "text", "text": body,
        "reveal": _REVEAL_BY_PACE.get(contract.get("pace", ""), "slide"),
        "in": text_in, "out": text_out,
    })
    return layers


# Below this, a single held shot is fine. At/above it, a lone video clip is
# increasingly likely to be shorter than the beat's narration — most stock
# clips run well under this — so the visual freezes on its last frame while
# audio keeps playing (see _sequential_cut_windows). Splitting into several
# shorter cuts instead sidesteps that almost entirely, since each cut only
# needs to cover a fraction of the beat.
_SEQUENTIAL_CUT_THRESHOLD_MS = 6000


def _sequential_cut_windows(duration_ms: int) -> list[tuple[int, int]]:
    """3-5 disjoint (start, end) ms windows spanning `duration_ms` — the
    "quick cuts instead of one held shot" windowing math, shared by
    broll_montage and any other archetype that opts into it above the
    freeze-risk threshold. Scale cut count to beat length — a short beat
    shouldn't get 5 cuts of a few hundred ms each; a long one shouldn't
    hold a single cut too long."""
    n_cuts = 3 if duration_ms < 3500 else (4 if duration_ms < 5000 else 5)
    slice_ms = duration_ms // n_cuts
    windows: list[tuple[int, int]] = []
    for i in range(n_cuts):
        start = i * slice_ms
        end = duration_ms if i == n_cuts - 1 else (i + 1) * slice_ms
        windows.append((start, end))
    return windows


def _synthesize_bare_visual_layers(contract: dict) -> list[dict]:
    """Visuals-only — no HUD, no keyword, no body. "Sequences where only
    visuals tell the story" (design doc). The beat's `body`/`keyword` (still
    present for text_over_dimmed's sake, and for narration continuity) are
    deliberately never read here.

    A single full-bleed source normally — but past
    _SEQUENTIAL_CUT_THRESHOLD_MS that's also when a lone clip is most likely
    to run out before the narration does, so long beats get several
    sequential cuts (same query, deduped to distinct assets) instead of one
    shot held past its own length."""
    q = contract.get("visual_query") or contract.get("keyword", "")
    duration_ms = contract.get("duration_ms") or 5000
    if duration_ms >= _SEQUENTIAL_CUT_THRESHOLD_MS:
        return [
            {"role": "background", "source": {"query": q}, "fit": "cover", "in": start, "out": end}
            for start, end in _sequential_cut_windows(duration_ms)
        ]
    return [{
        "role": "background", "source": {"query": q}, "fit": "cover",
        "animation": {"camera": contract.get("camera", "")},
        "in": 0, "out": None,
    }]


# Above this word count a "quote card" statement no longer reads as a
# punchy centered quote — it's a paragraph, and the centered box the editor
# fits it into (capped at body scale, MAX_BLOCK_H of the frame height) can't
# hold it without shrinking well past comfortable reading size. See
# scene-import-text-fit-doc.md §6.2.
_QUOTE_CARD_WORD_BUDGET = 18


def _synthesize_quote_card_layers(contract: dict) -> list[dict]:
    """Typographic, minimal/no imagery — a generated background (no stock
    photo lookup: an empty `source` tells the resolution loop below to skip
    it), centered statement text held for the whole beat.

    Past `_QUOTE_CARD_WORD_BUDGET` words, the centered treatment is the wrong
    fit no matter how the editor shrinks it, so this defers to
    `_synthesize_text_over_dimmed_layers` instead — the same word-synced
    bottom-band body that already carries calm_narrative's long lines (shrink
    + coverage guard, scene-import.ts §4.3/§4.4). The contract already has
    everything that path needs (`visual_query`, `word_times`, `pace`,
    `intensity`) regardless of archetype, so no extra data is required."""
    body = (contract.get("body") or contract.get("keyword") or "").strip()
    if len(body.split()) > _QUOTE_CARD_WORD_BUDGET:
        return _synthesize_text_over_dimmed_layers(contract)

    duration_ms = contract.get("duration_ms") or 5000
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if body:
        layers.append({"role": "text", "text": body, "reveal": "fade", "in": 0, "out": duration_ms})
    return layers


def _synthesize_split_screen_layers(contract: dict, orientation: str = "portrait") -> list[dict]:
    """Two visual sources side-by-side (landscape/square targets) or stacked
    (portrait — the dominant case, where a left/right split would be too
    narrow per panel to read). Deliberately reuses the SAME query for both
    slots: the per-scene `used_visuals` exclude set in build_scene()'s
    resolution loop guarantees the second resolve lands a DIFFERENT
    candidate, so the two panels are related but visually distinct without
    needing a second query field on the beat."""
    q = contract.get("visual_query") or contract.get("keyword", "")
    slot_a, slot_b = ("left", "right") if orientation == "landscape" else ("top", "bottom")
    return [
        {"role": "background", "slot": slot_a, "source": {"query": q}, "fit": "cover", "in": 0, "out": None},
        {"role": "foreground", "slot": slot_b, "source": {"query": q}, "fit": "cover", "in": 0, "out": None},
    ]


def _synthesize_comparison_layers(contract: dict, orientation: str = "portrait") -> list[dict]:
    """Same two-panel resolution as split_screen, PLUS a thin accent divider
    rendered exactly at the split boundary — the visual language that reads
    as "these two things are being weighed against each other" rather than
    just "two clips, stacked." The beat data has no before/after LABELS to
    put on each panel (the script doesn't produce that), so the divider is
    what carries the "comparison" intent instead of text the LLM can't
    reliably supply yet."""
    layers = _synthesize_split_screen_layers(contract, orientation)
    layers.append({"role": "shape", "shape": "divider", "in": 0, "out": None})
    return layers


def _synthesize_pip_layers(contract: dict) -> list[dict]:
    """Full-bleed background + a small inset (picture-in-picture) foreground
    in the bottom-right corner. Same same-query-different-asset dedup trick
    as split_screen — the two panels are related but never identical."""
    q = contract.get("visual_query") or contract.get("keyword", "")
    return [
        {"role": "background", "source": {"query": q}, "fit": "cover",
         "animation": {"camera": contract.get("camera", "")}, "in": 0, "out": None},
        {"role": "foreground", "slot": "pip", "source": {"query": q}, "fit": "cover", "in": 0, "out": None},
    ]


def _synthesize_full_bleed_video_layers(contract: dict) -> list[dict]:
    """Like bare_visual (no text), but the source is FLAGGED to force a real
    video clip rather than letting the format's media.mode/pace heuristic
    decide — "full-screen video with no text at all" (design doc) is a
    deliberate choice, not an accident of a fast-paced beat. The resolution
    loop in build_scene() reads `source.kind == "video"` as a per-layer mode
    override; if no video candidate clears the bar, resolve_visual's
    existing image fallback still leaves the beat with SOME visual.

    Since this archetype is video-only by definition, it's the archetype
    MOST exposed to the freeze-on-a-short-clip problem — same
    _SEQUENTIAL_CUT_THRESHOLD_MS split as bare_visual, every cut keeping the
    `kind: "video"` flag."""
    q = contract.get("visual_query") or contract.get("keyword", "")
    duration_ms = contract.get("duration_ms") or 5000
    if duration_ms >= _SEQUENTIAL_CUT_THRESHOLD_MS:
        return [
            {"role": "background", "source": {"query": q, "kind": "video"}, "fit": "cover", "in": start, "out": end}
            for start, end in _sequential_cut_windows(duration_ms)
        ]
    return [{
        "role": "background", "source": {"query": q, "kind": "video"}, "fit": "cover",
        "animation": {"camera": contract.get("camera", "")}, "in": 0, "out": None,
    }]


def _synthesize_title_card_layers(contract: dict) -> list[dict]:
    """A section opener: a resolved (dimmed) photo behind BIG centered title
    text — the beat's `keyword`, not the full spoken `body` (a title card
    names the section, it doesn't caption the narration). Distinct from
    quote_card (typographic, no photo) and text_over_dimmed (body text,
    left-aligned, word-synced)."""
    duration_ms = contract.get("duration_ms") or 5000
    q = contract.get("visual_query") or contract.get("keyword", "")
    title = (contract.get("keyword") or contract.get("body") or "").strip()
    layers: list[dict] = [
        {"role": "background", "source": {"query": q}, "fit": "cover",
         "animation": {"camera": contract.get("camera", "")}, "in": 0, "out": None},
        {"role": "scrim", "shape": "rect", "opacity": 0.5, "in": 0, "out": None},
    ]
    if title:
        layers.append({"role": "text", "text": title, "reveal": "fade", "size": "hero",
                        "in": 0, "out": duration_ms})
    return layers


# Headline/subtext anchor_y pairs a poster beat can land on — five real
# print-ad compositions, not one fixed layout repeated on every poster in
# every video.
_POSTER_LAYOUT_VARIANTS = [
    (0.38, 0.62),  # centered block
    (0.24, 0.46),  # top-stacked — photo shows through the lower two-thirds
    (0.56, 0.78),  # bottom-stacked — photo dominates the top
    (0.46, 0.58),  # tight-center — headline and subtext close together
    (0.16, 0.30),  # upper-heavy — text near the very top, photo owns the rest
]


def _synthesize_poster_card_layers(contract: dict) -> list[dict]:
    """A static "print-ad" panel — product/brand photo behind a bold
    headline (`keyword`) and a supporting line (`body`), held with no
    per-word sync (unlike text_over_dimmed). Pairs naturally with a beat's
    `silent` field (tts.py) for an ad's paused-narration product-reveal
    moment, but doesn't require it — the archetype itself is just
    title_card's photo+scrim plus a second text layer, same
    background/scrim/multi-text-layer primitives stat_callout already
    uses. No new renderer work.

    Three things vary per beat instead of being fixed, so consecutive
    posters (and posters across different generations) don't all look
    identical: scrim strength tracks `intensity` (same formula as
    text_over_dimmed, so a punchier beat gets a stronger dim, not a flat
    0.55 always); the reveal reuses `_REVEAL_BY_PACE` (the same pace→reveal
    mapping text_over_dimmed already uses, so a slow reveal beat FADES in
    and an explosive one TYPEWRITERs, instead of every poster fading the
    same way); the headline/subtext vertical layout is picked
    deterministically from `_POSTER_LAYOUT_VARIANTS` via a hash of the
    beat's own text (same beat regenerates the same layout; different
    beats/videos land on different ones).

    The variant's two `anchor_y` values are STARTING centers only, not a
    reserved, collision-free pair: scene-import.ts renders poster_card's two
    text layers as a measured stack (headline first, at `anchor_y`; subtext
    positioned from the headline's actual rendered bottom + a gap, then the
    pair clamped into the safe area), so a headline that wraps to 2 lines
    can't run into the subtext even though both anchors were authored
    assuming single-line text."""
    duration_ms = contract.get("duration_ms") or 3000
    q = contract.get("visual_query") or contract.get("keyword", "")
    headline = (contract.get("keyword") or "").strip()
    subtext = (contract.get("body") or "").strip()

    intensity = contract.get("intensity")
    intensity = intensity if isinstance(intensity, (int, float)) else 0.5
    scrim_opacity = round(0.4 + 0.3 * intensity, 2)
    reveal = _REVEAL_BY_PACE.get(contract.get("pace", ""), "fade")
    variant = _POSTER_LAYOUT_VARIANTS[
        int(hashlib.md5((headline + subtext).encode("utf-8")).hexdigest(), 16) % len(_POSTER_LAYOUT_VARIANTS)
    ]
    headline_y, subtext_y = variant

    layers: list[dict] = [
        {"role": "background", "source": {"query": q}, "fit": "cover", "in": 0, "out": None},
        {"role": "scrim", "shape": "rect", "opacity": scrim_opacity, "in": 0, "out": None},
    ]
    if headline:
        layers.append({"role": "text", "text": headline, "reveal": reveal, "size": "hero",
                        "anchor_y": headline_y, "in": 0, "out": duration_ms})
    if subtext:
        layers.append({"role": "text", "text": subtext, "reveal": reveal, "size": "normal",
                        "anchor_y": subtext_y, "in": 0, "out": duration_ms})
    return layers


def _synthesize_stat_callout_layers(contract: dict) -> list[dict]:
    """Big number/phrase + a smaller supporting label — reuses `keyword` as
    the hero stat (formats already write short, number-led keywords, e.g.
    listicle's "#1 SKIP THIS") and `body` as the caption underneath, so it
    needs no new number-parsing the LLM doesn't reliably support. Generated
    background (no photo) keeps focus on the figure, same as quote_card."""
    duration_ms = contract.get("duration_ms") or 5000
    hero = (contract.get("keyword") or "").strip()
    label = (contract.get("body") or "").strip()
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if hero:
        layers.append({"role": "text", "text": hero, "reveal": "fade", "size": "hero",
                        "anchor_y": 0.42, "in": 0, "out": duration_ms})
    if label:
        layers.append({"role": "text", "text": label, "reveal": "fade", "size": "normal",
                        "anchor_y": 0.62, "in": 0, "out": duration_ms})
    return layers


def _synthesize_broll_montage_layers(contract: dict) -> list[dict]:
    """3-5 quick cuts of related-but-distinct footage under ONE narration
    line — sequential, not simultaneous. Needs zero new renderer work:
    buildBeatGroupFromLayers already time-gates each layer independently by
    its own `in`/`out` (that's what makes split_screen/pip's SIMULTANEOUS
    layers work); giving several background-role layers DISJOINT windows
    instead of an identical full-beat window produces sequential cuts
    through the exact same mechanism. All cuts share one query — the
    existing per-scene/per-beat `used_visuals` dedup (already shared across
    every layer) guarantees each cut lands a different clip/photo."""
    duration_ms = contract.get("duration_ms") or 5000
    q = contract.get("visual_query") or contract.get("keyword", "")
    return [
        {"role": "background", "source": {"query": q}, "fit": "cover", "in": start, "out": end}
        for start, end in _sequential_cut_windows(duration_ms)
    ]


# Above this word count, a kinetic line reads as a full sentence, not a
# punchy one-or-two-word slam — the "hero" size hint should follow that
# distinction rather than being applied unconditionally to whatever `body`
# happens to be. See scene-import-text-fit-doc.md §6.1.
_KINETIC_HERO_WORD_BUDGET = 6


def _synthesize_kinetic_type_layers(contract: dict) -> list[dict]:
    """Animated typography, no imagery — the beat's spoken `body` (not just
    `keyword`; kinetic type carries the actual line, not a section label)
    rendered with a punchier per-LINE staggered pop-in (`reveal: "kinetic"`
    — scene-import.ts's kineticTextNodes) instead of quote_card's single
    calm fade. Generated background, same as quote_card/stat_callout.

    `size` is "hero" only for a short punch line (<= `_KINETIC_HERO_WORD_BUDGET`
    words); a longer line — the common case, since this carries the full
    spoken `body` — hints "normal" instead. (scene-import.ts's kinetic
    reveal currently starts every line at a fixed "heroSub" px size
    regardless of this hint, so today this doesn't change a rendered pixel —
    it keeps the hint honest for that code and any future consumer that
    does key weight/tracking off it.)"""
    duration_ms = contract.get("duration_ms") or 5000
    text = (contract.get("body") or contract.get("keyword") or "").strip()
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if text:
        size = "hero" if len(text.split()) <= _KINETIC_HERO_WORD_BUDGET else "normal"
        layers.append({"role": "text", "text": text, "reveal": "kinetic", "size": size,
                        "in": 0, "out": duration_ms})
    return layers


def _synthesize_lower_third_layers(contract: dict) -> list[dict]:
    """Full-bleed photo/video with a broadcast-style lower-third text band —
    left-aligned, backed by a semi-transparent bar confined to that band
    (not a full-frame scrim), positioned near the bottom rather than
    centered. Uses `keyword` (a short label, like a chyron name/title) over
    `body` when both exist, since a lower third is a caption ON the visual,
    not the visual's whole narration."""
    q = contract.get("visual_query") or contract.get("keyword", "")
    label = (contract.get("keyword") or contract.get("body") or "").strip()
    layers: list[dict] = [{
        "role": "background", "source": {"query": q}, "fit": "cover",
        "animation": {"camera": contract.get("camera", "")}, "in": 0, "out": None,
    }]
    if label:
        layers.append({"role": "lower_third", "text": label, "in": 0, "out": None})
    return layers


# ── P3: structured-text representations (definition / list / dialogue) ────────
# Each emits a generated background + ONE `role: "text"` layer carrying the
# structured fields the editor's new representations read (`term` / `items` /
# speaker-tagged items). They are NOT in llm.py's _ARCHETYPE_TYPE_AFFINITY, so
# the deterministic composer never auto-assigns them — they fire only when a
# format opts in or an upstream composer sets beat["archetype"]. Inert by
# default: no current output changes, exactly like every archetype before it
# opted in. The editor routes the text layer to definition-card / numbered-list
# / chat-bubbles via `text_intent` (see text_intent.py).

def _derive_list_items(body: str) -> list[dict]:
    """Best-effort split of a body line into list items: explicit separators
    (newlines, bullets, numbered prefixes, semicolons) first, else the whole
    body as one item. A real `items` array emitted by the LLM upstream should
    supersede this heuristic."""
    text = (body or "").strip()
    if not text:
        return []
    parts = re.split(r"\s*(?:\n|•|·|;|\s\d+[\.\)]\s)\s*", text)
    parts = [p.strip(" -–—•·").strip() for p in parts if p and p.strip(" -–—•·").strip()]
    return [{"text": p} for p in parts] if len(parts) >= 2 else [{"text": text}]


def _derive_dialogue(body: str) -> list[dict]:
    """Best-effort parse of \"Speaker: line\" turns from a body; falls back to a
    single un-attributed turn. Supersede with a real `items` array upstream."""
    text = (body or "").strip()
    if not text:
        return []
    turns: list[dict] = []
    for raw in re.split(r"\n+", text):
        line = raw.strip()
        if not line:
            continue
        m = re.match(r"^([A-Za-z][\w .'-]{0,24}):\s*(.+)$", line)
        turns.append({"speaker": m.group(1).strip(), "text": m.group(2).strip()} if m else {"speaker": "", "text": line})
    return turns or [{"speaker": "", "text": text}]


_STAT_LABEL_RE = re.compile(
    r"^((?:[\d][\w.,%+\-–]*)(?:\s+(?:years?|yrs?|percent|%|million|billion|thousand|times))?)\b", re.IGNORECASE,
)


def _short_stat_label(clause: str) -> str:
    """A short figure to lead a stat-band column with: the clause's leading
    number/quantity phrase ("5-7 year" -> "5-7 year") when there is one,
    else its first couple words. Deliberately never the whole clause — the
    editor's `stat-band` representation renders this at a large fixed-ish
    size next to the full clause as a caption underneath, so a long
    fallback here would duplicate the caption as a second, oversized copy
    of itself."""
    clause = clause.strip()
    m = _STAT_LABEL_RE.match(clause)
    if m:
        return m.group(1)
    words = clause.split()
    return " ".join(words[:2]) if words else clause


def _derive_stat_items(keyword: str, body: str) -> list[dict]:
    """Best-effort 2-4 {label, text} stat entries: the beat's own `keyword`
    (short, number-led — formats already write these, e.g. listicle's "#1
    SKIP THIS") as the first figure's label, `body` clauses (split on
    sentence boundaries) filling the rest — each given a short derived
    label so every column gets a genuine figure, not a duplicated caption.
    A real `items[]` from an upstream LLM/composer always supersedes this."""
    keyword = (keyword or "").strip()
    body = (body or "").strip()
    clauses = [c.strip() for c in re.split(r"(?<=[.!?])\s+|\n+", body) if c.strip()]
    items: list[dict] = []
    if keyword:
        items.append({"label": keyword, "text": clauses[0] if clauses else body})
        clauses = clauses[1:]
    items.extend({"label": _short_stat_label(c), "text": c} for c in clauses[:3])
    return items[:4]


def _derive_anaphora_items(body: str) -> list[dict]:
    """Best-effort 2-4 short parallel lines: split `body` on sentence
    boundaries, keep clauses of <= 6 words (anaphora reads as a punchy
    rhythm, not full sentences). Falls back to the whole body as one line
    when the split doesn't yield at least 2 short clauses."""
    text = (body or "").strip()
    if not text:
        return []
    clauses = [c.strip(" .") for c in re.split(r"(?<=[.!?])\s+", text) if c.strip()]
    short = [c for c in clauses if c and len(c.split()) <= 6]
    if len(short) >= 2:
        return [{"text": c} for c in short[:4]]
    return [{"text": text}]


def _derive_case_items(keyword: str, body: str) -> list[dict]:
    """Best-effort 1-2 {label, text} case entries: the beat's `keyword` as
    the first case's label, `body` as its headline; a second sentence (if
    the body splits into two) becomes a second case."""
    keyword = (keyword or "").strip()
    body = (body or "").strip()
    clauses = [c.strip() for c in re.split(r"(?<=[.!?])\s+", body) if c.strip()]
    items: list[dict] = []
    if clauses:
        items.append({"label": keyword, "text": clauses[0]})
        if len(clauses) > 1:
            items.append({"text": clauses[1]})
    elif keyword:
        items.append({"text": keyword})
    return items[:2]


def _derive_meta_items(body: str) -> list[dict]:
    """Best-effort metadata chips: split `body` on the separators a
    fact-style line already uses (· | ; ,). Weakest of these heuristics —
    real structured metadata (dates, locations) should come from an
    upstream source, not be guessed out of narration prose; see llm.py's
    comment on why `meta_facts` stays opt-in rather than composer-assigned."""
    text = (body or "").strip()
    if not text:
        return []
    parts = [p.strip(" -–—") for p in re.split(r"\s*(?:·|\||;|,)\s*", text) if p.strip()]
    return [{"text": p} for p in parts[:4]] if len(parts) >= 2 else [{"text": text}]


def _synthesize_stat_band_layers(contract: dict) -> list[dict]:
    """Multi-figure stat row — generated background + a text layer whose
    `items` drive the editor's `stat-band` representation. Prefers a real
    `items[]` on the beat; otherwise derives 2-4 figures from keyword+body."""
    duration_ms = contract.get("duration_ms") or 5000
    items = contract.get("items") or _derive_stat_items(contract.get("keyword"), contract.get("body"))
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if items:
        layers.append({"role": "text", "text": contract.get("body") or contract.get("keyword", ""),
                        "items": items, "reveal": "fade", "in": 0, "out": duration_ms})
    return layers


def _synthesize_anaphora_stack_layers(contract: dict) -> list[dict]:
    """Short repeated-phrase stack — generated background + a text layer
    whose `items` drive the editor's `anaphora-stack` representation."""
    duration_ms = contract.get("duration_ms") or 5000
    items = contract.get("items") or _derive_anaphora_items(contract.get("body"))
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if items:
        layers.append({"role": "text", "text": contract.get("body", ""), "items": items,
                        "reveal": "kinetic", "in": 0, "out": duration_ms})
    return layers


def _synthesize_case_study_layers(contract: dict) -> list[dict]:
    """Numbered case(s) — a resolved photo behind a text layer whose `items`
    drive the editor's `index-entry` representation."""
    duration_ms = contract.get("duration_ms") or 5000
    q = contract.get("visual_query") or contract.get("keyword", "")
    items = contract.get("items") or _derive_case_items(contract.get("keyword"), contract.get("body"))
    layers: list[dict] = [
        {"role": "background", "source": {"query": q}, "fit": "cover",
         "animation": {"camera": contract.get("camera", "")}, "in": 0, "out": None},
        {"role": "scrim", "shape": "rect", "opacity": 0.45, "in": 0, "out": None},
    ]
    if items:
        layers.append({"role": "text", "text": contract.get("body", ""), "items": items,
                        "reveal": "fade", "in": 0, "out": duration_ms})
    return layers


def _synthesize_meta_facts_layers(contract: dict) -> list[dict]:
    """Metadata chip row — generated background + a text layer whose `items`
    drive the editor's `meta-chips` representation. Opt-in only (see
    llm.py's `_ARCHETYPE_TYPE_AFFINITY` — never auto-assigned by the
    composer), since guessing metadata out of narration prose is the
    weakest of these heuristics."""
    duration_ms = contract.get("duration_ms") or 5000
    items = contract.get("items") or _derive_meta_items(contract.get("body"))
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if items:
        layers.append({"role": "text", "text": contract.get("body", ""), "items": items,
                        "reveal": "fade", "in": 0, "out": duration_ms})
    return layers


def _derive_accent_span(keyword: str) -> str | None:
    """Deterministic accent-tint pick for `accent-headline`: the trailing
    1-2 words of a multi-word keyword (mirrors the "...Quantum Age"
    reference — the emphasis phrase tends to be the noun the headline lands
    on). None for a short keyword, where tinting part of it would read as
    arbitrary rather than meaningful."""
    words = (keyword or "").strip().split()
    if len(words) < 3:
        return None
    return " ".join(words[-2:])


def _assign_accent_span(contracts: list[dict]) -> None:
    """In place: fill `accent_span` on `title_card` beats that don't already
    carry one (an upstream value always wins). Scoped to title_card only —
    accent-headline's primary case — so this doesn't tint a word on every
    beat's keyword indiscriminately."""
    for c in contracts:
        if c.get("archetype") == "title_card" and not c.get("accent_span"):
            span = _derive_accent_span(c.get("keyword"))
            if span:
                c["accent_span"] = span


def _synthesize_definition_layers(contract: dict) -> list[dict]:
    """Definition card — generated background + a text layer carrying the
    headword (`term`, from `keyword`) and its gloss (`body`). Editor renders it
    via the `definition-card` representation."""
    duration_ms = contract.get("duration_ms") or 5000
    term = (contract.get("keyword") or "").strip()
    gloss = (contract.get("body") or "").strip()
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if term or gloss:
        layers.append({"role": "text", "text": gloss or term, "term": term,
                        "reveal": "fade", "in": 0, "out": duration_ms})
    return layers


def _synthesize_list_layers(contract: dict) -> list[dict]:
    """Numbered/bullet list — generated background + a text layer whose `items`
    drive the `numbered-list` representation."""
    duration_ms = contract.get("duration_ms") or 5000
    body = (contract.get("body") or "").strip()
    items = contract.get("items") or _derive_list_items(body)
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if items:
        layers.append({"role": "text", "text": body or items[0]["text"], "items": items,
                        "reveal": "slide", "in": 0, "out": duration_ms})
    return layers


def _synthesize_dialogue_layers(contract: dict) -> list[dict]:
    """Chat/dialogue — generated background + a text layer whose speaker-tagged
    `items` drive the `chat-bubbles` representation."""
    duration_ms = contract.get("duration_ms") or 5000
    body = (contract.get("body") or "").strip()
    items = contract.get("items") or _derive_dialogue(body)
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if items:
        layers.append({"role": "text", "text": body, "items": items,
                        "reveal": "slide", "in": 0, "out": duration_ms})
    return layers


_ARCHETYPE_SYNTHESIZERS = {
    "text_over_dimmed": lambda c, orientation: _synthesize_text_over_dimmed_layers(c),
    "bare_visual": lambda c, orientation: _synthesize_bare_visual_layers(c),
    "quote_card": lambda c, orientation: _synthesize_quote_card_layers(c),
    "split_screen": _synthesize_split_screen_layers,
    "comparison": _synthesize_comparison_layers,
    "pip": lambda c, orientation: _synthesize_pip_layers(c),
    "full_bleed_video": lambda c, orientation: _synthesize_full_bleed_video_layers(c),
    "title_card": lambda c, orientation: _synthesize_title_card_layers(c),
    "poster_card": lambda c, orientation: _synthesize_poster_card_layers(c),
    "stat_callout": lambda c, orientation: _synthesize_stat_callout_layers(c),
    "broll_montage": lambda c, orientation: _synthesize_broll_montage_layers(c),
    "kinetic_type": lambda c, orientation: _synthesize_kinetic_type_layers(c),
    "lower_third": lambda c, orientation: _synthesize_lower_third_layers(c),
    # ── P3 structured-text archetypes (opt-in; see block above) ──────────
    "definition_card": lambda c, orientation: _synthesize_definition_layers(c),
    "list_card": lambda c, orientation: _synthesize_list_layers(c),
    "dialogue_card": lambda c, orientation: _synthesize_dialogue_layers(c),
    # ── P4 structured-text archetypes (read off a real reference) ────────
    # stat_band/case_study are in llm.py's _ARCHETYPE_TYPE_AFFINITY (the
    # composer can auto-assign them); anaphora_stack/meta_facts are opt-in
    # only, same as the P3 trio above — see llm.py for why.
    "stat_band": lambda c, orientation: _synthesize_stat_band_layers(c),
    "anaphora_stack": lambda c, orientation: _synthesize_anaphora_stack_layers(c),
    "case_study": lambda c, orientation: _synthesize_case_study_layers(c),
    "meta_facts": lambda c, orientation: _synthesize_meta_facts_layers(c),
}


def _synthesize_layers(contracts: list[dict], orientation: str = "portrait") -> None:
    """In place: fill `layers[]` for every beat that doesn't already carry
    one, dispatched on `archetype`. All 13 registry archetypes have a
    synthesizer now — this fallback (leave `layers` unset; scene-import.ts
    and the visual-resolution loop below both fall back to the pre-layers
    flat-field path) only matters for a future 14th archetype added here
    without a matching entry in `_ARCHETYPE_SYNTHESIZERS` yet."""
    for c in contracts:
        if "layers" in c:
            continue
        fn = _ARCHETYPE_SYNTHESIZERS.get(c.get("archetype", "text_over_dimmed"))
        if fn:
            c["layers"] = fn(c, orientation)


def build_scene(
    script: dict,
    out_dir: pathlib.Path,
    cfg: dict,
    beat_durations_ms: list[int],
    beat_wavs: list[pathlib.Path],
    timeline: dict | None = None,
    resolve_visuals: bool = True,
    progress=None,
    visual_profile: VisualProfile | None = None,   # genre's say over the cinematic defaults (formats.VisualProfile)
    media_plan: MediaPlan | None = None,           # genre's say over media mode/mood (formats.MediaPlan)
    product_image_data_url: str | None = None,     # optional user-supplied product photo (see below)
) -> pathlib.Path:
    """
    Assemble scene.json (v2) and write it to out_dir. Returns the path.

    beat_durations_ms — per-beat audio durations in ms (from TTS), 1:1 w/ beats.
    beat_wavs         — the Kokoro beat_i.wav paths, 1:1 w/ beats.
    timeline          — the timeline dict (build_timeline) for word_times.
    resolve_visuals   — set False to skip stock lookups (faster; text-only scene).
    product_image_data_url — an already-encoded `data:image/...;base64,...` string
        from the caller (the editor reads the file with FileReader.readAsDataURL,
        so no mime-sniffing/re-encoding is needed server-side — it's embedded
        as-is). When set, every `poster_card` beat's background uses THIS real
        photo instead of a stock search — those are the beats that are
        actually "the product" (reveal/CTA), so a real photo matters most
        there; every other beat keeps using stock search unchanged. None
        (the default) reproduces today's all-stock-search behavior exactly.
    """
    visual_profile = visual_profile or VisualProfile()
    media_plan = media_plan or MediaPlan()
    style        = script.get("style", "contrarian")
    global_theme = (script.get("global", {}) or {}).get("theme", "")
    computed_theme = _style_to_theme(global_theme or style)
    theme        = visual_profile.theme if visual_profile.theme in _THEME_PALETTES else computed_theme
    pal          = _THEME_PALETTES.get(theme, _THEME_PALETTES["tech_blue"])
    cam_style    = (script.get("global", {}) or {}).get("camera_style", "")

    contracts = _build_beat_contracts(
        script["beats"], beat_durations_ms, style=style, camera_style=cam_style,
        profile=visual_profile,
    )
    if timeline:
        attach_to_contracts(contracts, timeline)
    _synthesize_layers(contracts, orientation=media_plan.orientation)
    _assign_accent_span(contracts)

    assets: list[dict] = []

    # ── Product photo (optional) — embedded once, reused by every
    # poster_card beat's background instead of a stock search. See
    # build_scene's docstring for why it's scoped to poster_card only.
    product_asset_id: str | None = None
    if product_image_data_url:
        product_asset_id = "product_photo"
        assets.append({"id": product_asset_id, "kind": "image", "url": product_image_data_url})

    # ── Audio: one embedded VO asset + track per beat ────────────────────────
    for i, wav in enumerate(beat_wavs):
        if i >= len(contracts):
            break
        aid = f"vo_{i}"
        assets.append({"id": aid, "kind": "audio", "url": _wav_data_url(wav)})
        contracts[i]["audio"] = {"asset_id": aid}

    # ── Visuals: resolve + embed a stock image/video per beat (v2 shape) ─────
    if resolve_visuals:
        media = media_plan
        # Shared across every beat in this scene — each resolve excludes
        # every asset already used by an earlier beat, so two beats never end
        # up with the same photo/clip even when their visual_query overlaps.
        # Also shared WITHIN a beat (split_screen's two layers), so its two
        # panels are guaranteed distinct even when they share a query.
        used_visuals: set[str] = set()

        def _resolve_and_download(query: str, pace: str, mode_override: str | None = None, min_duration_ms: int | None = None):
            """One resolve, with the oversized-video-clip → image fallback.
            Returns (result, data) or None. Mutates `used_visuals`.
            `mode_override` — a layer can demand "video" specifically
            (full_bleed_video) regardless of the format's own media.mode.
            `min_duration_ms` — the ms window this visual needs to cover
            (a layer's own cut length, or the whole beat when unsplit);
            biases video candidate selection toward clips that don't run out
            before it (see media_resolve.py's resolve_visual doc)."""
            result = resolve_visual(
                query, mood=media.mood, mode=mode_override or media.mode,
                allow_illustration=media.allow_illustration, pace=pace,
                orientation=media.orientation, exclude=used_visuals,
                min_duration_ms=min_duration_ms,
            )
            if not result:
                return None
            is_video = result["kind"] == "video"
            data = download_video_as_data_url(result["url"]) if is_video else download_as_data_url(result["url"])
            if not data and is_video:
                result = resolve_visual(query, mood=media.mood, mode="image",
                                         allow_illustration=media.allow_illustration,
                                         orientation=media.orientation, exclude=used_visuals)
                if not result:
                    return None
                data = download_as_data_url(result["url"])
            if not data:
                return None
            used_visuals.add(result["url"])
            if result.get("id"):
                used_visuals.add(result["id"])
            return result, data

        for i, c in enumerate(contracts):
            if progress:
                progress(i, len(contracts), f"visuals {i + 1}/{len(contracts)}")

            layers = c.get("layers")
            if not layers:
                # No layers[] at all (an archetype with no synthesizer) —
                # fall back to the beat's own visual_query exactly like every
                # beat behaved before layers[] existed.
                q = (c.get("visual_query") or "").strip()
                if not q:
                    continue
                resolved = _resolve_and_download(q, c.get("pace", ""), min_duration_ms=c.get("duration_ms"))
                if not resolved:
                    continue
                result, data = resolved
                is_video = result["kind"] == "video"
                iid = f"{'vid' if is_video else 'img'}_{i}"
                # NOTE: deliberately NOT copying data["width"]/["height"] onto
                # the asset here. imageBox() (packages/nodekinds/src/image.ts)
                # contain-fits the sprite to KNOWN asset dims before applying
                # `fit`, which makes "cover" letterbox instead of truly
                # filling the frame whenever the source photo's aspect isn't
                # an exact match — see mediaNode's own doc comment in
                # scene-import.ts ("dimensions intentionally omitted upstream
                # ... fills the frame, letterbox-free"). Full-bleed
                # background/foreground visuals always want cover-to-frame,
                # never contain-to-native-aspect, so omitting dims here is
                # what makes that comment's promise actually true.
                asset = {"id": iid, "kind": result["kind"], "url": data["url"]}
                if is_video and result.get("duration_ms"):
                    asset["duration_ms"] = result["duration_ms"]
                assets.append(asset)
                c["visual"] = {
                    "asset_id": iid, "kind": result["kind"], "role": "background",
                    "fit": "cover", "opacity": 0.9,
                    "relevance": result.get("relevance", 0.0), "query": result.get("query", q),
                    "alternatives": [], "_source_url": result["url"],
                }
                continue

            # layers[] present (every archetype with a synthesizer) — resolve
            # each layer that asks for a stock source (role background/
            # foreground with a non-empty source.query; quote_card's
            # generated background has none and is skipped here).
            visual_layer_idx = 0
            for layer in layers:
                if layer.get("role") not in ("background", "foreground"):
                    continue
                q = ((layer.get("source") or {}).get("query") or "").strip()
                if not q:
                    continue

                if product_asset_id and c.get("archetype") == "poster_card" and layer.get("role") == "background":
                    # Real product photo instead of a stock search — same
                    # asset reused by every poster_card beat (reveal + CTA).
                    layer["asset_id"] = product_asset_id
                    layer["kind"] = "image"
                    if "visual" not in c:
                        c["visual"] = {
                            "asset_id": product_asset_id, "kind": "image", "role": layer.get("role", "background"),
                            "fit": layer.get("fit", "cover"), "opacity": 0.9,
                            "relevance": 1.0, "query": q, "alternatives": [], "_source_url": None,
                        }
                    visual_layer_idx += 1
                    continue

                mode_override = "video" if (layer.get("source") or {}).get("kind") == "video" else None
                layer_out = layer.get("out")
                layer_in = layer.get("in") or 0
                layer_window_ms = (layer_out - layer_in) if isinstance(layer_out, (int, float)) else c.get("duration_ms")
                resolved = _resolve_and_download(q, c.get("pace", ""), mode_override, min_duration_ms=layer_window_ms)
                if not resolved:
                    continue
                result, data = resolved
                is_video = result["kind"] == "video"
                # First visual layer keeps the legacy img_{i}/vid_{i} id (so
                # /api/scene/reroll's stable-id convention is untouched);
                # extra layers (split_screen's 2nd panel) get a suffix.
                iid = (f"{'vid' if is_video else 'img'}_{i}" if visual_layer_idx == 0
                       else f"{'vid' if is_video else 'img'}_{i}_{visual_layer_idx}")
                visual_layer_idx += 1
                # Same reasoning as the fallback branch above: omit width/
                # height so imageBox() treats this as full-frame-or-boxed
                # (per `slot`) rather than contain-fitting to native aspect,
                # which would defeat `fit: "cover"` for any layer whose photo
                # doesn't exactly match its target box's aspect.
                asset = {"id": iid, "kind": result["kind"], "url": data["url"]}
                if is_video and result.get("duration_ms"):
                    asset["duration_ms"] = result["duration_ms"]
                assets.append(asset)
                layer["asset_id"] = iid
                layer["kind"] = result["kind"]
                layer["_source_url"] = result["url"]
                if "visual" not in c:
                    # Back-compat mirror: whichever visual layer resolves
                    # FIRST is also exposed as the legacy single `c.visual`
                    # field, so any consumer that only knows about scene/2.0
                    # (today: everything except the new archetypes) still
                    # sees a visual on beats where that's the whole story.
                    c["visual"] = {
                        "asset_id": iid, "kind": result["kind"], "role": layer.get("role", "background"),
                        "fit": layer.get("fit", "cover"), "opacity": 0.9,
                        "relevance": result.get("relevance", 0.0), "query": result.get("query", q),
                        "alternatives": [], "_source_url": result["url"],
                    }

    # Music-ducking envelope (phase 6b — see audio_mix.py's module docstring
    # for exactly what this is and isn't wired up to yet). Computed whenever
    # word_times exist (i.e. `timeline` was provided); additive scene.json
    # field, nothing reads it yet.
    music_automation = None
    if timeline:
        music_automation = compute_ducking_envelope(
            beat_durations_ms, [c.get("word_times", []) for c in contracts],
        )

    # Background music — entirely opt-in (see assets/bgm/README.md): no-ops
    # to today's exact behavior (no bgm asset, no bgm track) whenever the
    # directory is missing/empty, which it is until someone drops files in.
    bgm_entry = None
    bgm_dir = pathlib.Path(cfg.get("paths", {}).get("bgm", "assets/bgm"))
    bgm_path = _select_bgm(bgm_dir, (script.get("global", {}) or {}).get("music_mood", ""))
    if bgm_path:
        assets.append({"id": "bgm", "kind": "audio", "url": _bgm_data_url(bgm_path)})
        bgm_entry = {"asset_id": "bgm", "volume": cfg.get("video", {}).get("bgm_volume", 0.1)}

    comp_w, comp_h = _composition_size(cfg, media_plan.orientation)
    scene = {
        "video_id": out_dir.name,
        "schema":   "scene/2.0",
        "theme":    theme,
        "layout":   contracts[0]["layout"] if contracts else "left",
        "fps":      cfg["video"]["fps"],
        "width":    comp_w,
        "height":   comp_h,
        "palette": {
            "accent": pal["accent"], "spike": pal["spike"],
            "bg": pal["bg"], "fg": pal["fg"],
        },
        "brand":  cfg["brand"]["name"],
        "assets": assets,
        "beats":  contracts,
    }
    if music_automation is not None:
        scene["music_automation"] = music_automation
    if bgm_entry is not None:
        scene["bgm"] = bgm_entry

    scene_path = pathlib.Path(out_dir) / "scene.json"
    scene_path.write_text(json.dumps(scene, indent=2, ensure_ascii=False), encoding="utf-8")

    n_img = sum(1 for a in assets if a["kind"] == "image")
    n_aud = sum(1 for a in assets if a["kind"] == "audio")
    bgm_note = f", bgm={bgm_path.name}" if bgm_path else ""
    print(f"[scene] ✓ scene.json — {len(contracts)} beats, {n_img} images, {n_aud} audio clips embedded{bgm_note}")
    return scene_path

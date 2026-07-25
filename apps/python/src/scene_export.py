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
import json
import pathlib

from visuals import _build_beat_contracts, _style_to_theme, _THEME_PALETTES
from captions.timeline import attach_to_contracts
from media_resolve import resolve_visual, download_as_data_url, download_video_as_data_url
from formats import VisualProfile, MediaPlan
from audio_mix import compute_ducking_envelope


def _wav_data_url(path: pathlib.Path) -> str:
    b64 = base64.b64encode(pathlib.Path(path).read_bytes()).decode("ascii")
    return f"data:audio/wav;base64,{b64}"


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


def _synthesize_bare_visual_layers(contract: dict) -> list[dict]:
    """Visuals-only — no HUD, no keyword, no body. "Sequences where only
    visuals tell the story" (design doc). A single full-bleed source; the
    beat's `body`/`keyword` (still present for text_over_dimmed's sake, and
    for narration continuity) are deliberately never read here."""
    q = contract.get("visual_query") or contract.get("keyword", "")
    return [{
        "role": "background", "source": {"query": q}, "fit": "cover",
        "animation": {"camera": contract.get("camera", "")},
        "in": 0, "out": None,
    }]


def _synthesize_quote_card_layers(contract: dict) -> list[dict]:
    """Typographic, minimal/no imagery — a generated background (no stock
    photo lookup: an empty `source` tells the resolution loop below to skip
    it), centered statement text held for the whole beat."""
    duration_ms = contract.get("duration_ms") or 5000
    body = (contract.get("body") or contract.get("keyword") or "").strip()
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
    existing image fallback still leaves the beat with SOME visual."""
    q = contract.get("visual_query") or contract.get("keyword", "")
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
    # Scale cut count to beat length — a short beat shouldn't get 5 cuts of
    # a few hundred ms each; a long one shouldn't hold a single cut too long.
    n_cuts = 3 if duration_ms < 3500 else (4 if duration_ms < 5000 else 5)
    slice_ms = duration_ms // n_cuts
    layers: list[dict] = []
    for i in range(n_cuts):
        start = i * slice_ms
        end = duration_ms if i == n_cuts - 1 else (i + 1) * slice_ms
        layers.append({"role": "background", "source": {"query": q}, "fit": "cover", "in": start, "out": end})
    return layers


def _synthesize_kinetic_type_layers(contract: dict) -> list[dict]:
    """Animated typography, no imagery — the beat's spoken `body` (not just
    `keyword`; kinetic type carries the actual line, not a section label)
    rendered with a punchier per-LINE staggered pop-in (`reveal: "kinetic"`
    — scene-import.ts's kineticTextNodes) instead of quote_card's single
    calm fade. Generated background, same as quote_card/stat_callout."""
    duration_ms = contract.get("duration_ms") or 5000
    text = (contract.get("body") or contract.get("keyword") or "").strip()
    layers: list[dict] = [{"role": "background", "source": {}, "in": 0, "out": None}]
    if text:
        layers.append({"role": "text", "text": text, "reveal": "kinetic", "size": "hero",
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


_ARCHETYPE_SYNTHESIZERS = {
    "text_over_dimmed": lambda c, orientation: _synthesize_text_over_dimmed_layers(c),
    "bare_visual": lambda c, orientation: _synthesize_bare_visual_layers(c),
    "quote_card": lambda c, orientation: _synthesize_quote_card_layers(c),
    "split_screen": _synthesize_split_screen_layers,
    "comparison": _synthesize_comparison_layers,
    "pip": lambda c, orientation: _synthesize_pip_layers(c),
    "full_bleed_video": lambda c, orientation: _synthesize_full_bleed_video_layers(c),
    "title_card": lambda c, orientation: _synthesize_title_card_layers(c),
    "stat_callout": lambda c, orientation: _synthesize_stat_callout_layers(c),
    "broll_montage": lambda c, orientation: _synthesize_broll_montage_layers(c),
    "kinetic_type": lambda c, orientation: _synthesize_kinetic_type_layers(c),
    "lower_third": lambda c, orientation: _synthesize_lower_third_layers(c),
}


def _synthesize_layers(contracts: list[dict], orientation: str = "portrait") -> None:
    """In place: fill `layers[]` for every beat that doesn't already carry
    one, dispatched on `archetype`. All 12 registry archetypes have a
    synthesizer now — this fallback (leave `layers` unset; scene-import.ts
    and the visual-resolution loop below both fall back to the pre-layers
    flat-field path) only matters for a future 13th archetype added here
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
) -> pathlib.Path:
    """
    Assemble scene.json (v2) and write it to out_dir. Returns the path.

    beat_durations_ms — per-beat audio durations in ms (from TTS), 1:1 w/ beats.
    beat_wavs         — the Kokoro beat_i.wav paths, 1:1 w/ beats.
    timeline          — the timeline dict (build_timeline) for word_times.
    resolve_visuals   — set False to skip stock lookups (faster; text-only scene).
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

    assets: list[dict] = []

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

        def _resolve_and_download(query: str, pace: str, mode_override: str | None = None):
            """One resolve, with the oversized-video-clip → image fallback.
            Returns (result, data) or None. Mutates `used_visuals`.
            `mode_override` — a layer can demand "video" specifically
            (full_bleed_video) regardless of the format's own media.mode."""
            result = resolve_visual(
                query, mood=media.mood, mode=mode_override or media.mode,
                allow_illustration=media.allow_illustration, pace=pace,
                orientation=media.orientation, exclude=used_visuals,
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
                resolved = _resolve_and_download(q, c.get("pace", ""))
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
                mode_override = "video" if (layer.get("source") or {}).get("kind") == "video" else None
                resolved = _resolve_and_download(q, c.get("pace", ""), mode_override)
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

    scene_path = pathlib.Path(out_dir) / "scene.json"
    scene_path.write_text(json.dumps(scene, indent=2, ensure_ascii=False), encoding="utf-8")

    n_img = sum(1 for a in assets if a["kind"] == "image")
    n_aud = sum(1 for a in assets if a["kind"] == "audio")
    print(f"[scene] ✓ scene.json — {len(contracts)} beats, {n_img} images, {n_aud} VO clips embedded")
    return scene_path

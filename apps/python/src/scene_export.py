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
from media_resolve import resolve_image, download_as_data_url


def _wav_data_url(path: pathlib.Path) -> str:
    b64 = base64.b64encode(pathlib.Path(path).read_bytes()).decode("ascii")
    return f"data:audio/wav;base64,{b64}"


def build_scene(
    script: dict,
    out_dir: pathlib.Path,
    cfg: dict,
    beat_durations_ms: list[int],
    beat_wavs: list[pathlib.Path],
    timeline: dict | None = None,
    resolve_visuals: bool = True,
) -> pathlib.Path:
    """
    Assemble scene.json (v2) and write it to out_dir. Returns the path.

    beat_durations_ms — per-beat audio durations in ms (from TTS), 1:1 w/ beats.
    beat_wavs         — the Kokoro beat_i.wav paths, 1:1 w/ beats.
    timeline          — the timeline dict (build_timeline) for word_times.
    resolve_visuals   — set False to skip stock lookups (faster; text-only scene).
    """
    style        = script.get("style", "contrarian")
    global_theme = (script.get("global", {}) or {}).get("theme", "")
    theme        = _style_to_theme(global_theme or style)
    pal          = _THEME_PALETTES.get(theme, _THEME_PALETTES["tech_blue"])
    cam_style    = (script.get("global", {}) or {}).get("camera_style", "")

    contracts = _build_beat_contracts(
        script["beats"], beat_durations_ms, style=style, camera_style=cam_style,
    )
    if timeline:
        attach_to_contracts(contracts, timeline)

    assets: list[dict] = []

    # ── Audio: one embedded VO asset + track per beat ────────────────────────
    for i, wav in enumerate(beat_wavs):
        if i >= len(contracts):
            break
        aid = f"vo_{i}"
        assets.append({"id": aid, "kind": "audio", "url": _wav_data_url(wav)})
        contracts[i]["audio"] = {"asset_id": aid}

    # ── Visuals: resolve + embed a stock image per beat ──────────────────────
    if resolve_visuals:
        for i, c in enumerate(contracts):
            q = (c.get("visual_query") or "").strip()
            if not q:
                continue
            url = resolve_image(q)
            if not url:
                continue
            data = download_as_data_url(url)
            if not data:
                continue
            iid = f"img_{i}"
            asset = {"id": iid, "kind": "image", "url": data["url"]}
            if data.get("width") and data.get("height"):
                asset["width"], asset["height"] = data["width"], data["height"]
            assets.append(asset)
            c["visual"] = {"asset_id": iid, "fit": "cover", "opacity": 0.9}

    scene = {
        "video_id": out_dir.name,
        "schema":   "scene/2.0",
        "theme":    theme,
        "layout":   contracts[0]["layout"] if contracts else "left",
        "fps":      cfg["video"]["fps"],
        "width":    cfg["video"]["width"],
        "height":   cfg["video"]["height"],
        "palette": {
            "accent": pal["accent"], "spike": pal["spike"],
            "bg": pal["bg"], "fg": pal["fg"],
        },
        "brand":  cfg["brand"]["name"],
        "assets": assets,
        "beats":  contracts,
    }

    scene_path = pathlib.Path(out_dir) / "scene.json"
    scene_path.write_text(json.dumps(scene, indent=2, ensure_ascii=False), encoding="utf-8")

    n_img = sum(1 for a in assets if a["kind"] == "image")
    n_aud = sum(1 for a in assets if a["kind"] == "audio")
    print(f"[scene] ✓ scene.json — {len(contracts)} beats, {n_img} images, {n_aud} VO clips embedded")
    return scene_path

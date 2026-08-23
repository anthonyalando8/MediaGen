"""
server.py  —  FastAPI wrapper around the scene pipeline.

Exposes the script→tts→captions→timeline→scene.json pipeline as an HTTP job
API the editor calls to "Generate AI Scene", then auto-imports the result.

WHY A JOB API (not one blocking request)
-----------------------------------------
Generation is slow and staged (Ollama script → Kokoro voice → whisper
transcript → timeline → stock-image fetch+embed). A single synchronous request
would hang for tens of seconds with no feedback and die on any proxy timeout.
So generation runs on a background worker and the editor polls for progress,
exactly like the export window's live progress.

ENDPOINTS
---------
  GET  /api/scene/formats       → [{id, label, description, default_resolve_visuals, profile_summary}]
  POST /api/scene/generate      {topic, format?, resolve_visuals?, media_mode?, voice_id?}  → {job_id}
  GET  /api/scene/status/{id}   → {state, step, total_steps, label, pct, error}
  GET  /api/scene/result/{id}   → the scene.json object (self-contained)
  POST /api/scene/reroll        {job_id, beat_index, mode?}  → {beat_index, visual, asset}
  GET  /api/voice/list          → [{id, label, accent, gender}]  (English voices)
  POST /api/voice/preview       {voice_id}  → {url}  (short sample, data: URL)
  GET  /api/health              → {ok, model_warm}

`format` selects a recipe (prompt + validation profile) under prompts/formats/.
It defaults to the original TikTok format, so existing callers are unaffected.

The scene is self-contained (voiceover + images embedded as data: URLs), so the
editor needs nothing but the returned JSON — it compiles + loads it directly.

RUN
---
  cd apps/python
  pip install fastapi "uvicorn[standard]"
  uvicorn server:app --port 8000 --reload
  # (run from apps/python so config.yaml at the project root resolves; the
  #  Kokoro/whisper model files must be reachable as the CLI expects.)

Single background worker ON PURPOSE: the models (Kokoro, whisper) are heavy and
not safe to run concurrently on one machine. Requests queue.
"""

from __future__ import annotations
import sys
import pathlib
import threading
import uuid
import logging
import traceback
import dataclasses
import base64
from concurrent.futures import ThreadPoolExecutor

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Make src/ importable (same layout main.py uses).
sys.path.insert(0, str(pathlib.Path(__file__).parent / "src"))

from llm import generate_script
from formats import load_format, list_formats, DEFAULT_FORMAT, MediaPlan
import ingest
from tts import synthesize, beat_durations, synthesize_preview, ENGLISH_VOICES, _ENGLISH_VOICE_IDS
from captions.captions import generate_captions
from captions.timeline import build_timeline, write_timeline
from scene_export import build_scene
from media_resolve import resolve_visual, download_as_data_url, download_video_as_data_url
from utils import make_run_dir
import json


# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
def _load_cfg() -> dict:
    p = pathlib.Path("config.yaml")
    if not p.exists():
        raise FileNotFoundError(
            "config.yaml not found — start uvicorn from apps/python (project root)."
        )
    return yaml.safe_load(p.read_text(encoding="utf-8"))


CFG = _load_cfg()
_PROMPTS_ROOT = CFG["paths"]["prompts"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
LOG = logging.getLogger("scene")


# ─────────────────────────────────────────────────────────────────────────────
# Job registry (in-memory)
# ─────────────────────────────────────────────────────────────────────────────
# Fine for a single-process dev/local server. For multi-worker deployment swap
# this for Redis/DB — but the model constraint means one worker anyway.
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_EXECUTOR = ThreadPoolExecutor(max_workers=1)

# Bound the registry so finished jobs (each holding a multi-MB scene payload)
# don't leak memory. When over capacity, evict the oldest non-running jobs.
_MAX_JOBS = 40
import time as _time

_STEPS = [
    "Writing script",
    "Synthesising voice",
    "Transcribing audio",
    "Building timeline",
    "Fetching visuals + scene",
]
_TOTAL = len(_STEPS)


def _set(job_id: str, **fields) -> None:
    with _JOBS_LOCK:
        job = _JOBS.setdefault(job_id, {})
        job.update(fields)


def _evict_if_needed() -> None:
    """Drop oldest finished (done/error) jobs once over capacity. Caller holds no lock."""
    with _JOBS_LOCK:
        if len(_JOBS) <= _MAX_JOBS:
            return
        finished = sorted(
            (jid for jid, j in _JOBS.items() if j.get("state") in ("done", "error")),
            key=lambda jid: _JOBS[jid].get("created", 0.0),
        )
        for jid in finished[: len(_JOBS) - _MAX_JOBS]:
            _JOBS.pop(jid, None)


def _mark_step(job_id: str, step: int) -> None:
    """step is 1-based; pct spans 0..95 across steps (100 only when done)."""
    pct = int(round((step - 1) / _TOTAL * 95))
    _set(job_id, state="running", step=step, total_steps=_TOTAL,
         label=_STEPS[step - 1], pct=pct, detail="", step_started=_time.time())
    LOG.info("job %s · step %d/%d · %s", job_id[:8], step, _TOTAL, _STEPS[step - 1])


def _sub(job_id: str, step: int, frac: float, detail: str) -> None:
    """Fractional progress WITHIN a step (0..1) + a human detail string, so the
    long loops (per-beat voice, per-visual fetch) advance the bar in real time
    instead of jumping at step boundaries."""
    frac = max(0.0, min(1.0, frac))
    pct = int(round(((step - 1) + frac) / _TOTAL * 95))
    _set(job_id, pct=pct, detail=detail)


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline worker
# ─────────────────────────────────────────────────────────────────────────────
def _apply_media_request_overrides(media: MediaPlan, media_mode: str | None, orientation: str | None) -> MediaPlan:
    """Explicit request overrides win over the format's own media.mode/
    orientation — allow_illustration/mood stay whatever the genre set (mood
    gets its own, later, script-driven override — see
    _apply_script_mood_override). Pure function: no request/job-state
    dependency, directly unit-testable."""
    overrides: dict = {}
    if media_mode:
        overrides["mode"] = media_mode
    if orientation:
        overrides["orientation"] = orientation
    return dataclasses.replace(media, **overrides) if overrides else media


def _apply_script_mood_override(media: MediaPlan, script: dict) -> MediaPlan:
    """The script's OWN music_mood (LLM-picked per-topic, already proven to
    judge tone well — e.g. correctly picking a calm register for a wellness
    product) drives the visual mood search terms too, instead of the
    format's one static mood list applying to every generation regardless
    of register. Falls back to the format's own mood list (i.e. a no-op)
    when the script doesn't set one."""
    music_mood = ((script.get("global", {}) or {}).get("music_mood") or "").strip()
    return dataclasses.replace(media, mood=[music_mood]) if music_mood else media


def _run_pipeline(job_id: str, topic: str, format_id: str, resolve_visuals: bool, media_mode: str | None = None,
                   voice_id: str | None = None, orientation: str | None = None,
                   product_image_data_url: str | None = None) -> None:
    started = _time.time()
    LOG.info("job %s · START topic=%r format=%s resolve_visuals=%s media_mode=%s voice_id=%s orientation=%s product_photo=%s",
             job_id[:8], topic, format_id, resolve_visuals, media_mode, voice_id, orientation, bool(product_image_data_url))
    try:
        run_id, run_dir = make_run_dir(CFG["paths"]["workspace"])
        _set(job_id, run_id=run_id, run_dir=str(run_dir))

        # 1. Script — load the selected format recipe (prompt + validation profile)
        _mark_step(job_id, 1)
        fmt = load_format(_PROMPTS_ROOT, format_id)
        media_plan = _apply_media_request_overrides(fmt.media, media_mode, orientation)
        script = generate_script(
            topic, fmt, CFG["llm"]["model"],
            progress=lambda frac, detail: _sub(job_id, 1, frac, detail),
        )
        media_plan = _apply_script_mood_override(media_plan, script)
        (run_dir / "script.json").write_text(
            json.dumps(script, indent=2, ensure_ascii=False), encoding="utf-8")

        # 2. Voice
        _mark_step(job_id, 2)
        voice_path, beat_wavs = synthesize(
            script, run_dir,
            voice=CFG["tts"]["voice"], speed=CFG["tts"]["speed"],
            sample_rate=CFG["tts"]["sample_rate"],
            progress=lambda i, n: _sub(job_id, 2, (i + 1) / n, f"voice {i + 1}/{n}"),
            voice_profile=fmt.voice,
            voice_override=voice_id,
        )
        durations = beat_durations(beat_wavs)

        # 3. Transcript
        _mark_step(job_id, 3)
        generate_captions(voice_path, run_dir, CFG, script=script)

        # 4. Timeline
        _mark_step(job_id, 4)
        transcript = json.loads((run_dir / "transcript.json").read_text(encoding="utf-8"))
        timeline = build_timeline(
            transcript, script, durations, CFG,
            seed=CFG.get("subs", {}).get("seed", 7),
        )
        write_timeline(timeline, run_dir)

        # 5. Scene (fetch + embed visuals, embed voiceover)
        _mark_step(job_id, 5)
        durations_ms = [int(d * 1000) for d in durations]
        scene_path = build_scene(
            script, run_dir, CFG,
            beat_durations_ms=durations_ms, beat_wavs=beat_wavs,
            timeline=timeline, resolve_visuals=resolve_visuals,
            progress=lambda i, n, d: _sub(job_id, 5, (i + 1) / n, d),
            visual_profile=fmt.visuals,
            media_plan=media_plan,
            product_image_data_url=product_image_data_url,
        )
        scene = json.loads(pathlib.Path(scene_path).read_text(encoding="utf-8"))

        elapsed = round(_time.time() - started, 1)
        _set(job_id, state="done", step=_TOTAL, total_steps=_TOTAL,
             label="Ready", pct=100, scene=scene,
             title=script.get("title", topic), format=format_id, elapsed_s=elapsed,
             # For /api/scene/reroll: the effective media plan (mood/
             # allow_illustration) and a per-beat "already shown" set so a
             # reroll doesn't just hand back the same top candidate.
             media_plan={"mood": media_plan.mood, "allow_illustration": media_plan.allow_illustration,
                         "mode": media_plan.mode, "orientation": media_plan.orientation},
             reroll_seen={})
        LOG.info("job %s · DONE in %ss (%d beats)", job_id[:8], elapsed, len(scene.get("beats", [])))
    except Exception as e:
        LOG.error("job %s · FAILED after %ss: %s", job_id[:8], round(_time.time() - started, 1), e)
        traceback.print_exc()
        _set(job_id, state="error", error=f"{type(e).__name__}: {e}", pct=0)


# ─────────────────────────────────────────────────────────────────────────────
# API
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="MediaGen scene API")

_MODELS_WARM = False


@app.on_event("startup")
def _warm_models() -> None:
    """Load the heavy models once at boot so the first job isn't cold. If this
    fails (missing model files), jobs still work — they load lazily on first use."""
    global _MODELS_WARM
    try:
        from tts import get_kokoro
        from captions.captions import load_whisper
        print("[server] Warming models…")
        if (CFG.get("tts", {}).get("provider") or "kokoro").strip().lower() == "kokoro":
            get_kokoro()
        load_whisper(CFG["subs"]["whisper_model"])
        _MODELS_WARM = True
        print("[server] Models warm.")
    except Exception as e:
        print(f"[server] Model warm failed (will load lazily per job): {e}")

# The editor runs on a different origin (Vite dev server). Lock this down to
# your real editor origin(s) in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    # Either `topic` (a short phrase — today's behavior, unchanged) OR one of
    # the `source_*` fields (existing content to turn into a script — see
    # ingest.py) must be set. When a source is given, it takes priority: the
    # extracted brief becomes the effective topic passed to generate_script,
    # so no prompt.txt needs to change to support ingest.
    topic: str = ""
    # Article/blog/markdown/plain-text/user-written-script content, already
    # decoded to text by the caller. `source_kind` picks the normalizer
    # (see ingest.py's _NORMALIZERS): "markdown" | "plain_text" | "script".
    source_text: str | None = None
    source_kind: str = "plain_text"
    # A PDF, base64-encoded by the caller (binary can't ride in JSON text).
    # Extracted server-side via ingest.extract_pdf_text, then normalized the
    # same way as source_text/"plain_text".
    source_pdf_base64: str | None = None
    # Which format recipe to use (folder name under prompts/formats/). Defaults
    # to the original TikTok format so existing callers keep working unchanged.
    # Omit (leave unset) when ingesting a source and you want the ingest
    # step's own length-based suggestion (see ingest._suggest_format) instead.
    format: str | None = None
    resolve_visuals: bool = True
    # Optional editor override for the format's own media.mode (image/video/
    # hybrid/auto) — the picker's manual media-mode control. None (the
    # default) leaves the format's own choice untouched.
    media_mode: str | None = None
    # Explicit per-generation voice pick from the editor's voice picker
    # (must be one of tts.ENGLISH_VOICES). None (the default/"Automatic")
    # leaves today's genre/LLM-driven voice selection untouched.
    voice_id: str | None = None
    # Explicit editor override for the format's own media.orientation
    # (portrait/landscape/square) — same "None leaves the format's own
    # choice untouched" convention as media_mode above.
    orientation: str | None = None
    # An already-encoded `data:image/...;base64,...` string (the editor
    # reads the file with FileReader.readAsDataURL client-side, so no
    # mime-sniffing needed here) for a real product photo. None (the
    # default) leaves every visual on stock search, unchanged.
    product_image_data_url: str | None = None


class RerollRequest(BaseModel):
    job_id: str
    beat_index: int
    # Explicit kind override ("image"/"video") for the "→ Video"/"→ Image"
    # quick-convert actions — omitted means "reroll within the same mode
    # the beat already resolved with".
    mode: str | None = None


class VoicePreviewRequest(BaseModel):
    voice_id: str


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "models_warm": _MODELS_WARM}


@app.get("/api/scene/formats")
def formats() -> list[dict]:
    """List the available video formats for the editor's picker."""
    return list_formats(_PROMPTS_ROOT)


def _ingest_source(req: "GenerateRequest") -> ingest.SourceBrief | None:
    """Normalize whichever `source_*` field the request set, or None if it
    set none (the plain-`topic` path — unchanged). Raises HTTPException on
    bad/empty/unparseable source input so the caller gets a clear 400
    instead of a pipeline failure three steps later."""
    if req.source_pdf_base64:
        try:
            raw_bytes = base64.b64decode(req.source_pdf_base64)
            text = ingest.extract_pdf_text(raw_bytes)
        except RuntimeError as e:   # pypdf not installed
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")
        try:
            return ingest.normalize_source(text, kind="plain_text")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    if req.source_text and req.source_text.strip():
        try:
            return ingest.normalize_source(req.source_text, kind=req.source_kind)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    return None


@app.post("/api/scene/generate")
def generate(req: GenerateRequest) -> dict:
    brief = _ingest_source(req)

    if brief:
        # An ingested source is more specific than a bare topic phrase —
        # its brief_text (title/key points/quotes/stats) becomes the
        # effective topic. req.topic, if also set, is ignored: mixing "here's
        # an article" with an unrelated topic phrase would just confuse the
        # prompt, not steer it.
        topic = brief.brief_text
    else:
        topic = (req.topic or "").strip()
        if not topic:
            raise HTTPException(status_code=400, detail="topic is required (or provide source_text / source_pdf_base64)")

    format_id = (req.format or (brief.suggested_format if brief else None) or DEFAULT_FORMAT).strip() or DEFAULT_FORMAT
    # Fail fast with a clear error if the format doesn't exist, rather than
    # surfacing it mid-job three steps later.
    try:
        load_format(_PROMPTS_ROOT, format_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if req.voice_id and req.voice_id not in _ENGLISH_VOICE_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown voice_id '{req.voice_id}'")

    job_id = uuid.uuid4().hex
    _set(job_id, state="queued", step=0, total_steps=_TOTAL, label="Queued", pct=0,
         format=format_id, created=_time.time())
    _evict_if_needed()
    _EXECUTOR.submit(_run_pipeline, job_id, topic, format_id, req.resolve_visuals, req.media_mode, req.voice_id,
                      req.orientation, req.product_image_data_url)
    return {"job_id": job_id}


@app.get("/api/voice/list")
def voice_list() -> list[dict]:
    """List the English voices available for the editor's voice picker (preview + manual override)."""
    return ENGLISH_VOICES


@app.post("/api/voice/preview")
def voice_preview(req: VoicePreviewRequest) -> dict:
    """Synthesise a short sample of one voice — sub-second on the already-warm model, no job queue needed."""
    if req.voice_id not in _ENGLISH_VOICE_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown voice_id '{req.voice_id}'")
    wav_bytes = synthesize_preview(req.voice_id)
    b64 = base64.b64encode(wav_bytes).decode("ascii")
    return {"url": f"data:audio/wav;base64,{b64}"}


# Internal-only job fields never sent to the client — the raw scene (separate
# fetch), and reroll bookkeeping (media_plan is plain dicts, reroll_seen holds
# `set`s, neither of which the client needs nor FastAPI's default encoder
# can serialize).
_INTERNAL_JOB_FIELDS = {"scene", "media_plan", "reroll_seen"}


@app.get("/api/scene/status/{job_id}")
def status(job_id: str) -> dict:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="unknown job")
        return {k: v for k, v in job.items() if k not in _INTERNAL_JOB_FIELDS}


@app.get("/api/scene/result/{job_id}")
def result(job_id: str) -> dict:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="unknown job")
        if job.get("state") != "done":
            raise HTTPException(status_code=409, detail=f"job not ready ({job.get('state')})")
        return job["scene"]


@app.post("/api/scene/reroll")
def reroll(req: RerollRequest) -> dict:
    """
    Re-resolve one beat's visual — the editor's ↺ Reroll / → Video / → Image
    actions in the asset-review step. Re-uses the beat's existing asset id
    (swapping the vid_/img_ prefix if the kind changes) so repeated rerolls
    don't grow scene.json's assets[] unboundedly, and excludes every URL
    already shown for this beat so a reroll can't just hand back the same
    candidate.
    """
    with _JOBS_LOCK:
        job = _JOBS.get(req.job_id)
        if not job:
            raise HTTPException(status_code=404, detail="unknown job")
        if job.get("state") != "done":
            raise HTTPException(status_code=409, detail=f"job not ready ({job.get('state')})")
        beats = job["scene"].get("beats", [])
        if not (0 <= req.beat_index < len(beats)):
            raise HTTPException(status_code=400, detail=f"beat_index out of range (0..{len(beats) - 1})")
        beat = beats[req.beat_index]
        query = (beat.get("visual_query") or "").strip()
        if not query:
            raise HTTPException(status_code=400, detail="this beat has no visual_query to resolve against")
        pace = beat.get("pace", "")
        media_plan = job["media_plan"]
        mode = req.mode or media_plan["mode"]
        seen = job.setdefault("reroll_seen", {}).setdefault(req.beat_index, set())
        current_url = (beat.get("visual") or {}).get("_source_url")
        if current_url:
            seen.add(current_url)
        exclude = set(seen)  # snapshot — network calls below happen outside the lock

    # Network resolve/download — deliberately outside _JOBS_LOCK (can take
    # several seconds; every other status/result poll would otherwise stall).
    found = resolve_visual(
        query, mood=media_plan["mood"], mode=mode,
        allow_illustration=media_plan["allow_illustration"], pace=pace, exclude=exclude,
        orientation=media_plan.get("orientation", "portrait"),
    )
    if not found:
        raise HTTPException(status_code=404, detail="no alternative visual found for this beat")
    is_video = found["kind"] == "video"
    data = download_video_as_data_url(found["url"]) if is_video else download_as_data_url(found["url"])
    if not data and is_video:
        # Oversized/failed clip — same fallback scene_export.py uses.
        found = resolve_visual(query, mood=media_plan["mood"], mode="image",
                                allow_illustration=media_plan["allow_illustration"], exclude=exclude,
                                orientation=media_plan.get("orientation", "portrait"))
        if not found:
            raise HTTPException(status_code=404, detail="no alternative visual found for this beat")
        is_video = False
        data = download_as_data_url(found["url"])
    if not data:
        raise HTTPException(status_code=502, detail="could not download the resolved visual")

    new_iid = f"{'vid' if is_video else 'img'}_{req.beat_index}"
    # width/height deliberately omitted — see scene_export.py's matching note.
    # Setting them makes imageBox() contain-fit to native aspect, which
    # defeats fit:"cover"'s full-bleed crop whenever the photo's aspect
    # isn't an exact match for the frame.
    new_asset = {"id": new_iid, "kind": found["kind"], "url": data["url"]}
    if is_video and found.get("duration_ms"):
        new_asset["duration_ms"] = found["duration_ms"]
    new_visual = {
        "asset_id": new_iid, "kind": found["kind"], "role": "background",
        "fit": "cover", "opacity": 0.9,
        "relevance": found.get("relevance", 0.0), "query": found.get("query", query),
        "alternatives": [], "_source_url": found["url"],
    }

    with _JOBS_LOCK:
        job = _JOBS.get(req.job_id)
        if not job:  # evicted while we were resolving — nothing left to update
            raise HTTPException(status_code=404, detail="job no longer available")
        old_iid = ((job["scene"]["beats"][req.beat_index].get("visual") or {}).get("asset_id"))
        job["scene"]["assets"] = [a for a in job["scene"]["assets"] if a["id"] not in (old_iid, new_iid)]
        job["scene"]["assets"].append(new_asset)
        job["scene"]["beats"][req.beat_index]["visual"] = new_visual
        job.setdefault("reroll_seen", {}).setdefault(req.beat_index, set()).add(found["url"])

    return {
        "beat_index": req.beat_index,
        "visual": {k: v for k, v in new_visual.items() if k != "_source_url"},
        "asset": new_asset,
    }

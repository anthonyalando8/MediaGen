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
  POST /api/scene/generate      {topic, resolve_visuals?}  → {job_id}
  GET  /api/scene/status/{id}   → {state, step, total_steps, label, pct, error}
  GET  /api/scene/result/{id}   → the scene.json object (self-contained)
  GET  /api/health              → {ok, model_warm}

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
import traceback
from concurrent.futures import ThreadPoolExecutor

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Make src/ importable (same layout main.py uses).
sys.path.insert(0, str(pathlib.Path(__file__).parent / "src"))

from llm import generate_script
from tts import synthesize, beat_durations
from captions.captions import generate_captions
from captions.timeline import build_timeline, write_timeline
from scene_export import build_scene
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


# ─────────────────────────────────────────────────────────────────────────────
# Job registry (in-memory)
# ─────────────────────────────────────────────────────────────────────────────
# Fine for a single-process dev/local server. For multi-worker deployment swap
# this for Redis/DB — but the model constraint means one worker anyway.
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_EXECUTOR = ThreadPoolExecutor(max_workers=1)

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


def _mark_step(job_id: str, step: int) -> None:
    """step is 1-based; pct spans 0..95 across steps (100 only when done)."""
    pct = int(round((step - 1) / _TOTAL * 95))
    _set(job_id, state="running", step=step, total_steps=_TOTAL,
         label=_STEPS[step - 1], pct=pct)


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline worker
# ─────────────────────────────────────────────────────────────────────────────
def _run_pipeline(job_id: str, topic: str, resolve_visuals: bool) -> None:
    try:
        run_id, run_dir = make_run_dir(CFG["paths"]["workspace"])
        _set(job_id, run_id=run_id, run_dir=str(run_dir))

        # 1. Script
        _mark_step(job_id, 1)
        prompt_path = pathlib.Path(CFG["paths"]["prompts"]) / "script.txt"
        script = generate_script(topic, prompt_path, CFG["llm"]["model"])
        (run_dir / "script.json").write_text(
            json.dumps(script, indent=2, ensure_ascii=False), encoding="utf-8")

        # 2. Voice
        _mark_step(job_id, 2)
        voice_path, beat_wavs = synthesize(
            script, run_dir,
            voice=CFG["tts"]["voice"], speed=CFG["tts"]["speed"],
            sample_rate=CFG["tts"]["sample_rate"],
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
        )
        scene = json.loads(pathlib.Path(scene_path).read_text(encoding="utf-8"))

        _set(job_id, state="done", step=_TOTAL, total_steps=_TOTAL,
             label="Ready", pct=100, scene=scene,
             title=script.get("title", topic))
    except Exception as e:
        traceback.print_exc()
        _set(job_id, state="error", error=f"{type(e).__name__}: {e}", pct=0)


# ─────────────────────────────────────────────────────────────────────────────
# API
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="MediaGen scene API")

# The editor runs on a different origin (Vite dev server). Lock this down to
# your real editor origin(s) in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    topic: str
    resolve_visuals: bool = True


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/scene/generate")
def generate(req: GenerateRequest) -> dict:
    topic = (req.topic or "").strip()
    if not topic:
        raise HTTPException(status_code=400, detail="topic is required")
    job_id = uuid.uuid4().hex
    _set(job_id, state="queued", step=0, total_steps=_TOTAL, label="Queued", pct=0)
    _EXECUTOR.submit(_run_pipeline, job_id, topic, req.resolve_visuals)
    return {"job_id": job_id}


@app.get("/api/scene/status/{job_id}")
def status(job_id: str) -> dict:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="unknown job")
        # Status excludes the (large) scene payload — that's a separate fetch.
        return {k: v for k, v in job.items() if k != "scene"}


@app.get("/api/scene/result/{job_id}")
def result(job_id: str) -> dict:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="unknown job")
        if job.get("state") != "done":
            raise HTTPException(status_code=409, detail=f"job not ready ({job.get('state')})")
        return job["scene"]

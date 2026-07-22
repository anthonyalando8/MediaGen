"""
main.py  —  MediaGen scene pipeline (editor edition)

Produces ONE editable scene.json per topic for the SeaBytes editor. The old
render tail (Playwright slides → character → FFmpeg assembly) is gone — the
editor renders, previews, and exports the video now.

Pipeline:  script → voice (Kokoro) → captions/transcript → timeline
           → scene.json  (visuals + voiceover embedded)

Usage (from project root — MediaGen/):

  # single topic (default format: shortform_tiktok)
  python src/main.py "why linux beats windows for developers"

  # pick a different video format (folder under prompts/formats/)
  python src/main.py "5 habits ruining your focus" --format listicle
  python src/main.py "the quiet cost of always being busy" --format calm_narrative

  # pick a random topic from a subject file
  python src/main.py --source tech --random --format listicle

  # process every topic in a subject file  (--limit N caps it)
  python src/main.py --source tech --batch --limit 10 --format shortform_tiktok

  # rebuild from an existing workspace (creates a NEW run, never overwrites)
  python src/main.py --rebuild 015
  python src/main.py --rebuild 015 --from tts        # redo voice → … → scene
  python src/main.py --rebuild 015 --from captions   # reuse voice; redo rest
  python src/main.py --rebuild 015 --from scene      # reuse voice+captions; rebuild scene.json only

  Subject files live in:  data/topics/<subject>.txt   (one topic per line)
  Formats live in:        prompts/formats/<format>/   (prompt.txt + format.yaml)
"""

import sys
import pathlib
import json
import re
import shutil
import time
import yaml

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from llm      import generate_script
from formats  import load_format, list_formats, DEFAULT_FORMAT
from tts      import synthesize, beat_durations
from captions.captions import generate_captions
from captions.timeline import build_timeline, write_timeline
from scene_export import build_scene
from utils    import make_run_dir, load_topics, random_topic


# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

def _load_cfg() -> dict:
    p = pathlib.Path("config.yaml")
    if not p.exists():
        raise FileNotFoundError(
            "config.yaml not found — run from the project root (MediaGen/)"
        )
    return yaml.safe_load(p.read_text(encoding="utf-8"))


# ─────────────────────────────────────────────────────────────────────────────
# Source resolver
# ─────────────────────────────────────────────────────────────────────────────

def resolve_source(cfg: dict, source: str) -> pathlib.Path:
    """Resolve a subject name to its topic file path (data/topics/<source>.txt)."""
    sources_dir = pathlib.Path(cfg["paths"]["sources_dir"])
    subject_path = sources_dir / f"{source}.txt"

    if not subject_path.exists():
        available = sorted(p.stem for p in sources_dir.glob("*.txt")) if sources_dir.exists() else []
        hint = f"Available subjects: {available}" if available else f"No subject files found in {sources_dir}/"
        raise FileNotFoundError(f"Subject file not found: {subject_path}\n{hint}")

    return subject_path


# ─────────────────────────────────────────────────────────────────────────────
# Workspace prefix resolver
# ─────────────────────────────────────────────────────────────────────────────

_RUN_DIR_PAT = re.compile(r'^(\d+)_[0-9a-f]{8}$')


def _find_workspace(prefix: str, workspace_root: pathlib.Path) -> pathlib.Path:
    """Find the run directory matching a numeric prefix (e.g. "015" → 015_xxxxxxxx)."""
    prefix = prefix.lstrip("0") or "0"
    prefix_int = int(prefix)

    matches = [
        d for d in workspace_root.iterdir()
        if d.is_dir() and _RUN_DIR_PAT.match(d.name)
        and int(d.name.split("_")[0]) == prefix_int
    ]

    if not matches:
        raise FileNotFoundError(
            f"No workspace with prefix '{prefix}' found in {workspace_root}.\n"
            f"Available: {[d.name for d in sorted(workspace_root.iterdir()) if _RUN_DIR_PAT.match(d.name)][-10:]}"
        )
    if len(matches) > 1:
        raise RuntimeError(f"Multiple workspaces match prefix '{prefix}': {[d.name for d in matches]}")
    return matches[0]


# ─────────────────────────────────────────────────────────────────────────────
# Rebuild step constants
# ─────────────────────────────────────────────────────────────────────────────

# --from argument → first step that must re-run (2=tts, 3=captions, 4=scene)
_FROM_STEP = {
    "tts":      2,
    "captions": 3,
    "scene":    4,
}

# Files copied from the source workspace per --from step.
_COPY_FOR_STEP = {
    2: [],                                                      # redo everything
    3: ["voice.wav", "beat_*.wav"],                             # captions: copy audio
    4: ["voice.wav", "beat_*.wav", "transcript.json", "timeline.json"],  # scene: copy audio + captions/timeline
}


# ─────────────────────────────────────────────────────────────────────────────
# Rebuild (creates a new workspace)
# ─────────────────────────────────────────────────────────────────────────────

def rebuild(prefix: str, from_step: int, cfg: dict) -> dict:
    """
    Read script.json from the workspace matching *prefix*, create a NEW run,
    copy the reusable files, then run from *from_step* onward. The source
    workspace is never modified.

    Rebuild never re-runs step 1 (script generation), so no format is needed —
    the existing script.json already encodes whatever format produced it.
    """
    t0 = time.time()
    workspace_root = pathlib.Path(cfg["paths"]["workspace"])

    src_dir = _find_workspace(prefix, workspace_root)
    script_path = src_dir / "script.json"
    if not script_path.exists():
        raise FileNotFoundError(f"script.json not found in {src_dir}")

    script = json.loads(script_path.read_text(encoding="utf-8"))
    topic  = script.get("title", f"rebuild of {src_dir.name}")

    run_id, run_dir = make_run_dir(workspace_root)
    step_name = {2: "tts", 3: "captions", 4: "scene"}.get(from_step, "tts")
    _banner(
        f"REBUILD  {src_dir.name}  →  {run_dir.name}",
        f"Topic:   {topic}",
        f"From:    step {from_step} ({step_name})",
    )

    shutil.copy2(str(script_path), str(run_dir / "script.json"))
    print(f"[rebuild] Copied script.json from {src_dir.name}")

    copied = []
    for pattern in _COPY_FOR_STEP.get(from_step, []):
        for src_file in sorted(src_dir.glob(pattern)):
            shutil.copy2(str(src_file), str(run_dir / src_file.name))
            copied.append(src_file.name)
    if copied:
        print(f"[rebuild] Copied from source: {', '.join(copied)}")

    voice_path = run_dir / "voice.wav"

    # ── Step 2: TTS ───────────────────────────────────────────────────────
    if from_step <= 2:
        _step(2, "Voice synthesis")
        voice_path, beat_wavs, durations = _run_tts(script, cfg, run_dir)
    else:
        _skip(2, "Voice synthesis", voice_path.name)
        beat_wavs = sorted(run_dir.glob("beat_*.wav"))
        durations = _load_durations(beat_wavs, script)

    # ── Step 3: Captions (writes transcript.json — the timeline's input) ──
    if from_step <= 3:
        _step(3, "Captions / transcript")
        generate_captions(voice_path, run_dir, cfg, script=script)
    else:
        _skip(3, "Captions / transcript", "transcript.json")

    # ── Step 4: Timeline (word-sync spine) ────────────────────────────────
    _step(4, "Timeline  (word-sync spine)")
    transcript = json.loads((run_dir / "transcript.json").read_text(encoding="utf-8"))
    timeline = build_timeline(
        transcript, script, durations, cfg,
        seed=cfg.get("subs", {}).get("seed", 7),
    )
    write_timeline(timeline, run_dir)

    # ── Step 5: Scene export ──────────────────────────────────────────────
    scene_path = _run_scene(script, cfg, run_dir, durations, beat_wavs, timeline)

    return _finish(scene_path, run_dir, topic, run_id, t0, rebuilt_from=src_dir.name)


def _load_durations(beat_wavs: list[pathlib.Path], script: dict) -> list[float]:
    """Load beat durations from existing WAVs, validating count against script."""
    import soundfile as sf
    n_beats = len(script["beats"])
    if len(beat_wavs) != n_beats:
        raise RuntimeError(
            f"[rebuild] {len(beat_wavs)} beat WAVs found but script has {n_beats} beats.\n"
            f"Run without --from (or with --from tts) to regenerate audio."
        )
    durations = [sf.info(str(p)).duration for p in beat_wavs]
    print(f"[rebuild] Beat durations: {[f'{d:.1f}s' for d in durations]}")
    return durations


# ─────────────────────────────────────────────────────────────────────────────
# Single run
# ─────────────────────────────────────────────────────────────────────────────

def run_one(topic: str, cfg: dict, format_id: str = DEFAULT_FORMAT) -> dict:
    """Run the full pipeline for a single topic + format. Returns a small result dict."""
    t0 = time.time()

    run_id, run_dir = make_run_dir(cfg["paths"]["workspace"])
    _banner(f"Topic:  {topic}", f"Format: {format_id}", f"Run:    {run_id}", f"Dir:    {run_dir}")

    # ── 1. Script ─────────────────────────────────────────────────────────
    _step(1, f"Script generation  (format: {format_id})")
    fmt = load_format(cfg["paths"]["prompts"], format_id)
    script = generate_script(topic, fmt, cfg["llm"]["model"])
    (run_dir / "script.json").write_text(
        json.dumps(script, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    _print_script(script)

    # ── 2. Voice (Kokoro) ─────────────────────────────────────────────────
    _step(2, "Voice synthesis  (Kokoro, voice_style-aware)")
    voice_path, beat_wavs, durations = _run_tts(script, cfg, run_dir, fmt)

    # ── 3. Captions / transcript (word-level timestamps) ──────────────────
    _step(3, "Captions / transcript  (whisper word timing)")
    generate_captions(voice_path, run_dir, cfg, script=script)

    # ── 4. Timeline spine (beat-relative word_times) ──────────────────────
    _step(4, "Timeline  (word-sync spine)")
    transcript = json.loads((run_dir / "transcript.json").read_text(encoding="utf-8"))
    timeline = build_timeline(
        transcript, script, durations, cfg,
        seed=cfg.get("subs", {}).get("seed", 7),
    )
    write_timeline(timeline, run_dir)

    # ── 5. Scene export (editor scene.json) ───────────────────────────────
    scene_path = _run_scene(script, cfg, run_dir, durations, beat_wavs, timeline, fmt)

    return _finish(scene_path, run_dir, topic, run_id, t0, format_id=format_id)


# ─────────────────────────────────────────────────────────────────────────────
# Shared step helpers
# ─────────────────────────────────────────────────────────────────────────────

def _run_tts(
    script: dict, cfg: dict, run_dir: pathlib.Path, fmt=None
) -> tuple[pathlib.Path, list[pathlib.Path], list[float]]:
    voice_path, beat_wavs = synthesize(
        script, run_dir,
        voice=cfg["tts"]["voice"],
        speed=cfg["tts"]["speed"],
        sample_rate=cfg["tts"]["sample_rate"],
        voice_profile=fmt.voice if fmt else None,
    )
    n_beats = len(script["beats"])
    if len(beat_wavs) != n_beats:
        raise RuntimeError(f"[main] TTS returned {len(beat_wavs)} WAV files for {n_beats} beats.")
    durations = beat_durations(beat_wavs)
    print(f"         Beat durations: {[f'{d:.1f}s' for d in durations]}")
    return voice_path, beat_wavs, durations


def _run_scene(
    script: dict, cfg: dict, run_dir: pathlib.Path,
    durations: list[float], beat_wavs: list[pathlib.Path], timeline: dict, fmt=None,
) -> pathlib.Path:
    _step(5, "Scene export  (editor scene.json)")
    durations_ms = [int(d * 1000) for d in durations]
    return build_scene(
        script, run_dir, cfg,
        beat_durations_ms=durations_ms,
        beat_wavs=beat_wavs,
        timeline=timeline,
        visual_profile=fmt.visuals if fmt else None,
    )


def _finish(
    scene_path: pathlib.Path, run_dir: pathlib.Path,
    topic: str, run_id: str, t0: float,
    rebuilt_from: str | None = None, format_id: str | None = None,
) -> dict:
    elapsed = time.time() - t0
    _banner(
        f"✓  Done in {elapsed:.0f}s",
        f"   Scene → {scene_path}",
        "   Open in the editor:  File ▸ Import Scene…",
    )
    result = {"ok": True, "topic": topic, "run_id": run_id,
              "elapsed_s": round(elapsed, 1), "scene": str(scene_path)}
    if format_id:
        result["format"] = format_id
    if rebuilt_from:
        result["rebuilt_from"] = rebuilt_from
    (run_dir / "report.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Batch mode
# ─────────────────────────────────────────────────────────────────────────────

def run_batch(cfg: dict, source: str, limit: int | None = None,
              format_id: str = DEFAULT_FORMAT) -> None:
    subject_path = resolve_source(cfg, source)
    topics = load_topics(subject_path)

    if not topics:
        print(f"[main] No topics found in {subject_path}")
        return

    if limit is not None:
        if limit < 1:
            print(f"[main] --limit must be a positive integer, got {limit}")
            return
        topics = topics[:limit]

    total      = len(topics)
    limit_note = f" (limit {limit})" if limit is not None else ""
    print(f"[main] Batch mode — {total} topics from '{source}'{limit_note}, format '{format_id}'")

    for i, topic in enumerate(topics, 1):
        print(f"\n[main] ── Topic {i}/{total} ──────────────────────")
        try:
            run_one(topic, cfg, format_id)
        except Exception as e:
            print(f"[main] ✗ Failed for '{topic}': {e}", file=sys.stderr)


# ─────────────────────────────────────────────────────────────────────────────
# Print helpers
# ─────────────────────────────────────────────────────────────────────────────

def _banner(*lines: str) -> None:
    bar = "═" * 58
    print(f"\n╔{bar}╗")
    for line in lines:
        if line:
            print(f"║  {line:<54}  ║")
    print(f"╚{bar}╝\n")


def _step(n: int, label: str) -> None:
    print(f"\n── Step {n}: {label} {'─' * max(0, 48 - len(label))}")


def _skip(n: int, label: str, detail: str = "") -> None:
    suffix = f"  ({detail})" if detail else ""
    print(f"\n── Step {n}: {label} {'─' * max(0, 48 - len(label))}")
    print(f"   ↷  SKIPPED — reusing from source{suffix}")


def _print_script(script: dict) -> None:
    print(f"  Title:    {script['title']}")
    thumb = script.get('thumbnail', '')
    if thumb: print(f"  Thumb:    {thumb}")
    style = script.get('style', '')
    if style: print(f"  Style:    {style}")
    g = script.get('global', {}) or {}
    if g:
        print(f"  Globals:  theme={g.get('theme','')}  music={g.get('music_mood','')}  "
              f"voice={g.get('voice_style','')}  cam={g.get('camera_style','')}")
    for i, b in enumerate(script["beats"]):
        btype  = b.get("type", "beat").upper()
        energy = b.get("energy", "")
        tag    = f" [{energy}]" if energy else ""
        print(f"  {i+1}. {btype}{tag}: [{b['keyword']}]  {b['text'][:72]}…")


# ─────────────────────────────────────────────────────────────────────────────
# CLI argument parsing
# ─────────────────────────────────────────────────────────────────────────────

def _extract_opt(args: list[str], name: str) -> tuple[str | None, str | None]:
    """Pull `--name VALUE` out of args. Returns (value, error_msg)."""
    if name not in args:
        return None, None
    idx = args.index(name)
    if idx + 1 >= len(args):
        return None, f"{name} requires a value"
    return args[idx + 1], None


def _parse_args(args: list[str]) -> dict:
    if not args:
        return {"mode": "help"}

    # --format applies to every generating mode (direct/random/batch), not rebuild.
    fmt_val, fmt_err = _extract_opt(args, "--format")
    if fmt_err:
        return {"mode": "error", "msg": f"{fmt_err} (e.g. --format listicle)"}
    format_id = fmt_val or DEFAULT_FORMAT

    if not args[0].startswith("--"):
        # Strip the --format pair from the topic words if present.
        topic_words = [a for a in args]
        if fmt_val:
            i = topic_words.index("--format")
            del topic_words[i:i + 2]
        return {"mode": "direct", "topic": " ".join(topic_words), "format": format_id}

    if args[0] == "--rebuild":
        if len(args) < 2:
            return {"mode": "error", "msg": "Usage: main.py --rebuild <prefix> [--from tts|captions|scene]"}
        parsed = {"mode": "rebuild", "prefix": args[1], "from_step": 2}
        if "--from" in args:
            idx = args.index("--from")
            if idx + 1 >= len(args):
                return {"mode": "error", "msg": "--from requires: tts | captions | scene"}
            step_name = args[idx + 1].lower()
            if step_name not in _FROM_STEP:
                return {"mode": "error", "msg": f"Unknown step '{step_name}'. Valid: tts, captions, scene"}
            parsed["from_step"] = _FROM_STEP[step_name]
        return parsed

    source = None
    if "--source" in args:
        idx = args.index("--source")
        if idx + 1 >= len(args):
            return {"mode": "error", "msg": "--source requires a subject name (e.g. --source tech)"}
        source = args[idx + 1]

    is_random = "--random" in args
    is_batch  = "--batch"  in args
    if is_random and is_batch:
        return {"mode": "error", "msg": "--random and --batch are mutually exclusive"}

    limit = None
    if "--limit" in args:
        idx = args.index("--limit")
        if idx + 1 >= len(args):
            return {"mode": "error", "msg": "--limit requires an integer (e.g. --limit 10)"}
        try:
            limit = int(args[idx + 1])
        except ValueError:
            return {"mode": "error", "msg": f"--limit must be an integer, got '{args[idx + 1]}'"}

    if is_random:
        if limit is not None:
            return {"mode": "error", "msg": "--limit has no effect with --random. Use --batch instead."}
        if not source:
            return {"mode": "error", "msg": "--random requires --source <subject>"}
        return {"mode": "random", "source": source, "format": format_id}

    if is_batch:
        if not source:
            return {"mode": "error", "msg": "--batch requires --source <subject>"}
        return {"mode": "batch", "source": source, "limit": limit, "format": format_id}

    return {"mode": "error", "msg": f"Unrecognised arguments: {' '.join(args)}\nRun without arguments to see usage."}


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cfg    = _load_cfg()
    parsed = _parse_args(sys.argv[1:])
    mode   = parsed["mode"]

    if mode == "help":
        print(__doc__)
        print("Available formats:")
        for m in list_formats(cfg["paths"]["prompts"]):
            print(f"  • {m['id']:<18} {m['description']}")
        sys.exit(0)

    elif mode == "error":
        print(f"[main] Error: {parsed['msg']}", file=sys.stderr)
        sys.exit(1)

    elif mode == "direct":
        run_one(parsed["topic"], cfg, parsed["format"])

    elif mode == "random":
        subject_path = resolve_source(cfg, parsed["source"])
        topic = random_topic(subject_path)
        if not topic:
            print(f"[main] No topics in {subject_path}", file=sys.stderr)
            sys.exit(1)
        run_one(topic, cfg, parsed["format"])

    elif mode == "batch":
        run_batch(cfg, source=parsed["source"], limit=parsed["limit"], format_id=parsed["format"])

    elif mode == "rebuild":
        rebuild(parsed["prefix"], parsed["from_step"], cfg)

"""
main.py  —  TikTok AI Video Pipeline

Usage (from project root — MediaGen/):

  # single topic (direct mode — always explicit, never uses dataset logic)
  python src/main.py "why linux beats windows for developers"

  # pick a random topic from a subject file
  python src/main.py --source tech --random
  python src/main.py --source finance --random

  # process every topic in a subject file
  python src/main.py --source tech --batch

  # process only the first N topics in a subject file
  python src/main.py --source tech --batch --limit 10

  # rebuild from an existing workspace (creates a NEW run, never overwrites)
  python src/main.py --rebuild 015

  # rebuild but skip to a specific step (reuses audio/captions from source)
  python src/main.py --rebuild 015 --from tts
  python src/main.py --rebuild 015 --from captions
  python src/main.py --rebuild 015 --from slides
  python src/main.py --rebuild 015 --from assembly

  Rebuild step reference:
    (default)  re-runs everything: tts → captions → slides → assembly
    tts        redo tts → captions → slides → assembly
    captions   copy voice; redo captions → slides → assembly
    slides     copy voice + captions; redo slides → assembly
    assembly   copy voice + captions + frames; redo assembly only

  The source workspace is never modified. The rebuild always creates a
  fresh numbered run (e.g. 015 → 016_xxxxxxxx) so you can compare outputs.

  Subject files live in:
    data/topics/<subject>.txt   (one topic per line)
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
from tts      import synthesize, beat_durations
from captions.captions import generate_captions
from visuals    import render_slides
from assemble   import assemble
from character  import render_character
from utils    import (
    make_run_dir, qa_check, extract_thumbnail,
    save_report, load_topics, random_topic,
)
from captions.timeline import build_timeline, write_timeline


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
    """
    Resolve a subject name to its topic file path.

    Given source="tech", returns Path("data/topics/tech.txt").
    Raises FileNotFoundError (with available subjects listed) if missing.
    """
    sources_dir = pathlib.Path(cfg["paths"]["sources_dir"])
    subject_path = sources_dir / f"{source}.txt"

    if not subject_path.exists():
        available = sorted(
            p.stem for p in sources_dir.glob("*.txt")
        ) if sources_dir.exists() else []
        hint = f"Available subjects: {available}" if available else \
               f"No subject files found in {sources_dir}/"
        raise FileNotFoundError(
            f"Subject file not found: {subject_path}\n{hint}"
        )

    return subject_path


# ─────────────────────────────────────────────────────────────────────────────
# Workspace prefix resolver
# ─────────────────────────────────────────────────────────────────────────────

_RUN_DIR_PAT = re.compile(r'^(\d+)_[0-9a-f]{8}$')


def _find_workspace(prefix: str, workspace_root: pathlib.Path) -> pathlib.Path:
    """
    Find the run directory matching a numeric prefix.

    Given prefix "015", searches workspace_root for any directory whose
    name starts with "015_". The prefix must be unique — raises if zero
    or more than one match is found.
    """
    prefix = prefix.lstrip("0") or "0"   # normalise "015" → "15" for int compare
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
        names = [d.name for d in matches]
        raise RuntimeError(
            f"Multiple workspaces match prefix '{prefix}': {names}\n"
            f"This shouldn't happen — check your workspace directory."
        )
    return matches[0]


# ─────────────────────────────────────────────────────────────────────────────
# Step constants
# ─────────────────────────────────────────────────────────────────────────────

# Maps --from argument → first step that must re-run (2=tts … 5=assembly)
_FROM_STEP = {
    "tts":      2,
    "captions": 3,
    "slides":   4,
    "assembly": 5,
}

# Files copied from source workspace per --from step
# Key = first step to re-run. Value = list of glob patterns to copy.
_COPY_FOR_STEP = {
    2: [],                                                    # redo everything — copy nothing
    3: ["voice.wav", "beat_*.wav"],                          # captions: copy audio
    4: ["voice.wav", "beat_*.wav", "captions.ass",
        "transcript.json"],                                   # slides: copy audio + captions
    5: ["voice.wav", "beat_*.wav", "captions.ass",
        "transcript.json","timeline.json", "scene.json"],    # assembly: copy audio + captions
                                                              # frames are handled separately below
}


# ─────────────────────────────────────────────────────────────────────────────
# Rebuild (creates a new workspace)
# ─────────────────────────────────────────────────────────────────────────────

def rebuild(prefix: str, from_step: int, cfg: dict) -> dict:
    """
    Read script.json from workspace matching *prefix*, create a NEW run
    directory, copy the necessary files from the source, then run the
    pipeline from *from_step* onward.

    The source workspace is never modified.
    """
    t0 = time.time()
    workspace_root = pathlib.Path(cfg["paths"]["workspace"])

    # ── Find source workspace ─────────────────────────────────────────────
    src_dir = _find_workspace(prefix, workspace_root)
    script_path = src_dir / "script.json"
    if not script_path.exists():
        raise FileNotFoundError(f"script.json not found in {src_dir}")

    script = json.loads(script_path.read_text(encoding="utf-8"))
    topic  = script.get("title", f"rebuild of {src_dir.name}")

    # ── Create new workspace ──────────────────────────────────────────────
    run_id, run_dir = make_run_dir(workspace_root)

    step_name = {2: "tts", 3: "captions", 4: "slides", 5: "assembly"}.get(from_step, "tts")
    _banner(
        f"REBUILD  {src_dir.name}  →  {run_dir.name}",
        f"Topic:   {topic}",
        f"From:    step {from_step} ({step_name})",
    )

    # ── Copy script.json into new workspace ───────────────────────────────
    shutil.copy2(str(script_path), str(run_dir / "script.json"))
    print(f"[rebuild] Copied script.json from {src_dir.name}")

    # ── Copy reused files from source ─────────────────────────────────────
    patterns = _COPY_FOR_STEP.get(from_step, [])
    copied = []
    for pattern in patterns:
        for src_file in sorted(src_dir.glob(pattern)):
            dst_file = run_dir / src_file.name
            shutil.copy2(str(src_file), str(dst_file))
            copied.append(src_file.name)
    if copied:
        print(f"[rebuild] Copied from source: {', '.join(copied)}")

    # ── Copy frames directory for assembly-only rebuild ───────────────────
    if from_step == 5:
        src_frames = src_dir / "frames"
        if src_frames.exists():
            dst_frames = run_dir / "frames"
            shutil.copytree(str(src_frames), str(dst_frames))
            frame_count = sum(1 for _ in dst_frames.rglob("frame_*.png"))
            print(f"[rebuild] Copied frames/ ({frame_count} PNGs)")
        else:
            print(f"[rebuild] ⚠  No frames/ in source — will re-render slides")
            from_step = 4  # fall back to slides step

    # ── Resolve existing outputs for skipped steps ────────────────────────
    voice_path = run_dir / "voice.wav"
    ass_path   = run_dir / "captions.ass"
    frames_dir = run_dir / "frames"

    # ── Step 2: TTS ───────────────────────────────────────────────────────
    if from_step <= 2:
        _step(2, "Voice synthesis")
        voice_path, beat_wavs, durations = _run_tts(script, cfg, run_dir)
    else:
        _skip(2, "Voice synthesis", voice_path.name)
        beat_wavs = sorted(run_dir.glob("beat_*.wav"))
        durations = _load_durations(beat_wavs, script, run_dir)

    # ── Step 3: Captions ─────────────────────────────────────────────────
    if from_step <= 3:
        _step(3, "Captions")
        ass_path = generate_captions(voice_path, run_dir, cfg, script=script)
    else:
        _skip(3, "Captions", ass_path.name)

    # ── Step 3.5: Timeline  (only needed when slides will re-render) ──────
    timeline = None
    if from_step <= 4:
        _step(4, "Timeline  (word-sync spine)")
        transcript = json.loads((run_dir / "transcript.json").read_text(encoding="utf-8"))
        timeline = build_timeline(
            transcript, script, durations, cfg,
            seed=cfg.get("subs", {}).get("seed", 7),
        )
        write_timeline(timeline, run_dir)

    # ── Step 4: Slides ────────────────────────────────────────────────────
    if from_step <= 4:
        _step(4, "Slide rendering")
        durations_ms = [int(d * 1000) for d in durations]
        slide_paths, frames_dir = render_slides(
            script, run_dir, cfg, beat_durations_ms=durations_ms, timeline=timeline,
        )
    else:
        beat_dirs = sorted(frames_dir.glob("beat_*"))
        slide_paths = [str(d) for d in beat_dirs if d.is_dir()]
        _skip(4, "Slide rendering", f"{len(slide_paths)} beat dirs")

    # ── Step 4.5: Character frames ────────────────────────────────────────
    char_frames_dir = None
    if cfg.get("character", {}).get("enabled", False):
        if from_step <= 4:
            _step(5, "Character rendering  (Mixamo/Three.js)")
            durations_ms = [int(d * 1000) for d in durations]
            char_frames_dir = render_character(
                run_dir, cfg, beat_durations_ms=durations_ms
            )
        else:
            # Assembly-only rebuild — reuse existing char_frames if present
            existing = run_dir / "char_frames"
            if existing.exists() and list(existing.glob("frame_*.png")):
                char_frames_dir = existing
                _skip(5, "Character rendering", f"{len(list(existing.glob('frame_*.png')))} frames")
            else:
                _step(5, "Character rendering  (Mixamo/Three.js)")
                durations_ms = [int(d * 1000) for d in durations]
                char_frames_dir = render_character(
                    run_dir, cfg, beat_durations_ms=durations_ms
                )

    # ── Step 5: Assembly ─────────────────────────────────────────────────
    _step(6, "Assembly")
    final_path = assemble(
        slide_paths, durations,
        voice_path, ass_path,
        run_dir, cfg,
        script=script,
        char_frames_dir=char_frames_dir,
    )

    # ── Cleanup + QA ─────────────────────────────────────────────────────
    report = _cleanup_and_qa(frames_dir, final_path, cfg, run_dir, topic, run_id, t0)
    report["rebuilt_from"] = src_dir.name
    save_report(report, run_dir)
    return report


def _load_durations(
    beat_wavs: list[pathlib.Path],
    script:    dict,
    run_dir:   pathlib.Path,
) -> list[float]:
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

def run_one(topic: str, cfg: dict) -> dict:
    """Run the full pipeline for a single topic. Returns the QA report dict."""
    t0 = time.time()

    run_id, run_dir = make_run_dir(cfg["paths"]["workspace"])
    _banner(f"Topic: {topic}", f"Run:   {run_id}", f"Dir:   {run_dir}")

    # ── 1. Script ─────────────────────────────────────────────────────────
    _step(1, "Script generation")
    prompt_path = pathlib.Path(cfg["paths"]["prompts"]) / "script.txt"
    script = generate_script(topic, prompt_path, cfg["llm"]["model"])
    (run_dir / "script.json").write_text(
        json.dumps(script, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    _print_script(script)

    # ── 2. Voice ──────────────────────────────────────────────────────────
    _step(2, "Voice synthesis  (Kokoro, voice_style-aware)")
    voice_path, beat_wavs, durations = _run_tts(script, cfg, run_dir)

    # ── 3. Captions ───────────────────────────────────────────────────────
    _step(3, "Word-level captions  (auto-style by script)")
    ass_path = generate_captions(voice_path, run_dir, cfg, script=script)

    # ── 3.5 Timeline spine  (shared timing truth) ─────────────────────────
    _step(4, "Timeline  (word-sync spine)")
    transcript = json.loads((run_dir / "transcript.json").read_text(encoding="utf-8"))
    timeline = build_timeline(
        transcript, script, durations, cfg,
        seed=cfg.get("subs", {}).get("seed", 7),
    )
    write_timeline(timeline, run_dir)

    # ── 4. Slides ─────────────────────────────────────────────────────────
    _step(5, "Slide rendering  (HTML/Playwright + depth planes)")
    durations_ms = [int(d * 1000) for d in durations]
    slide_paths, frames_dir = render_slides(
        script, run_dir, cfg, beat_durations_ms=durations_ms, timeline=timeline,
    )

    # ── 4.5 Character frames ──────────────────────────────────────────────
    char_frames_dir = None
    if cfg.get("character", {}).get("enabled", False):
        _step(6, "Character rendering  (Mixamo/Three.js)")
        char_frames_dir = render_character(
            run_dir, cfg, beat_durations_ms=durations_ms
        )

    # ── 5. Assembly ───────────────────────────────────────────────────────
    _step(7, "Assembly  (FFmpeg, mood-aware BGM)")
    final_path = assemble(
        slide_paths, durations,
        voice_path, ass_path,
        run_dir, cfg,
        script=script,
        char_frames_dir=char_frames_dir,
    )

    # ── 6–7. Cleanup + QA ─────────────────────────────────────────────────
    return _cleanup_and_qa(frames_dir, final_path, cfg, run_dir, topic, run_id, t0)


# ─────────────────────────────────────────────────────────────────────────────
# Shared step helpers
# ─────────────────────────────────────────────────────────────────────────────

def _run_tts(
    script: dict, cfg: dict, run_dir: pathlib.Path
) -> tuple[pathlib.Path, list[pathlib.Path], list[float]]:
    voice_path, beat_wavs = synthesize(
        script, run_dir,
        voice=cfg["tts"]["voice"],
        speed=cfg["tts"]["speed"],
        sample_rate=cfg["tts"]["sample_rate"],
    )
    n_beats = len(script["beats"])
    if len(beat_wavs) != n_beats:
        raise RuntimeError(
            f"[main] TTS returned {len(beat_wavs)} WAV files for {n_beats} beats."
        )
    durations = beat_durations(beat_wavs)
    print(f"         Beat durations: {[f'{d:.1f}s' for d in durations]}")
    return voice_path, beat_wavs, durations


def _cleanup_and_qa(
    frames_dir: pathlib.Path,
    final_path: pathlib.Path,
    cfg:        dict,
    run_dir:    pathlib.Path,
    topic:      str,
    run_id:     str,
    t0:         float,
) -> dict:
    if cfg.get("cleanup_frames", True) and frames_dir and frames_dir.exists():
        shutil.rmtree(frames_dir)
        print(f"[main] Frames deleted → {frames_dir.name}/ removed")
    elif frames_dir and frames_dir.exists():
        frame_count = sum(1 for _ in frames_dir.rglob("*.png"))
        print(f"[main] Frames kept → {frame_count} PNGs in {frames_dir}")

    _step(8, "QA check")
    report = qa_check(final_path, cfg)
    thumb  = extract_thumbnail(final_path, run_dir)

    report.update({
        "topic":     topic,
        "run_id":    run_id,
        "elapsed_s": round(time.time() - t0, 1),
        "video":     str(final_path),
        "thumbnail": str(thumb),
    })
    save_report(report, run_dir)

    elapsed = time.time() - t0
    _banner(
        f"✓  Done in {elapsed:.0f}s",
        f"   Video     → {final_path}",
        f"   Thumbnail → {thumb}",
        "" if report["ok"] else f"   ⚠  QA warnings — see {run_dir / 'report.json'}",
    )
    return report


# ─────────────────────────────────────────────────────────────────────────────
# Batch mode
# ─────────────────────────────────────────────────────────────────────────────

def run_batch(cfg: dict, source: str, limit: int | None = None) -> None:
    """
    Run the pipeline for topics from a subject file.

    Args:
        cfg:    Loaded config dict.
        source: Subject name (e.g. "tech") — resolved to data/topics/tech.txt.
        limit:  Max number of topics to process. None = process all.
    """
    subject_path = resolve_source(cfg, source)
    topics = load_topics(subject_path)

    if not topics:
        print(f"[main] No topics found in {subject_path}")
        return

    # Apply limit — slicing beyond list length is safe in Python
    if limit is not None:
        if limit < 1:
            print(f"[main] --limit must be a positive integer, got {limit}")
            return
        topics = topics[:limit]

    total        = len(topics)
    source_total = len(load_topics(subject_path))
    limit_note   = f" (limit {limit} of {source_total})" if limit is not None else ""
    print(f"[main] Batch mode — {total} topics from '{source}'{limit_note}")

    for i, topic in enumerate(topics, 1):
        print(f"\n[main] ── Topic {i}/{total} ──────────────────────")
        try:
            run_one(topic, cfg)
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

def _parse_args(args: list[str]) -> dict:
    """
    Parse CLI arguments into a structured dict.

    Rules:
      - First arg not starting with "--" → direct topic mode
      - Otherwise parse flags: --source, --random, --batch, --limit, --rebuild, --from
    """
    if not args:
        return {"mode": "help"}

    # Direct topic mode: first arg is a plain string (not a flag)
    if not args[0].startswith("--"):
        return {"mode": "direct", "topic": " ".join(args)}

    # --rebuild
    if args[0] == "--rebuild":
        if len(args) < 2:
            return {"mode": "error", "msg": "Usage: main.py --rebuild <prefix> [--from tts|captions|slides|assembly]"}
        parsed = {"mode": "rebuild", "prefix": args[1], "from_step": 2}

        if "--from" in args:
            idx = args.index("--from")
            if idx + 1 >= len(args):
                return {"mode": "error", "msg": "--from requires: tts | captions | slides | assembly"}
            step_name = args[idx + 1].lower()
            if step_name not in _FROM_STEP:
                return {"mode": "error", "msg": f"Unknown step '{step_name}'. Valid: tts, captions, slides, assembly"}
            parsed["from_step"] = _FROM_STEP[step_name]

        return parsed

    # --source-based modes
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

    # --limit
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
            return {"mode": "error", "msg": "--limit has no effect with --random (selects exactly one topic). Remove --limit or use --batch instead."}
        if not source:
            return {"mode": "error", "msg": "--random requires --source <subject>"}
        return {"mode": "random", "source": source}

    if is_batch:
        if not source:
            return {"mode": "error", "msg": "--batch requires --source <subject>"}
        return {"mode": "batch", "source": source, "limit": limit}

    return {"mode": "error", "msg": f"Unrecognised arguments: {' '.join(args)}\nRun without arguments to see usage."}


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cfg    = _load_cfg()
    args   = sys.argv[1:]
    parsed = _parse_args(args)
    mode   = parsed["mode"]

    if mode == "help":
        print(__doc__)
        sys.exit(0)

    elif mode == "error":
        print(f"[main] Error: {parsed['msg']}", file=sys.stderr)
        sys.exit(1)

    elif mode == "direct":
        run_one(parsed["topic"], cfg)

    elif mode == "random":
        subject_path = resolve_source(cfg, parsed["source"])
        topic = random_topic(subject_path)
        if not topic:
            print(f"[main] No topics in {subject_path}", file=sys.stderr)
            sys.exit(1)
        run_one(topic, cfg)

    elif mode == "batch":
        run_batch(cfg, source=parsed["source"], limit=parsed["limit"])

    elif mode == "rebuild":
        rebuild(parsed["prefix"], parsed["from_step"], cfg)
"""
main.py  —  TikTok AI Video Pipeline

Usage (from project root — MediaGen/):

  # single topic
  python src/main.py "why linux beats windows for developers"

  # pick a random topic from data/topics.txt
  python src/main.py --random

  # process every topic in data/topics.txt
  python src/main.py --batch
"""

import sys
import pathlib
import json
import time
import yaml

# allow imports from src/ regardless of working directory
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from llm      import generate_script
from tts      import synthesize, beat_durations
from captions import generate_captions
from visuals  import render_slides
from assemble import assemble
from utils    import (
    make_run_dir, qa_check, extract_thumbnail,
    save_report, load_topics, random_topic,
)


# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

def _load_cfg() -> dict:
    p = pathlib.Path("config.yaml")
    if not p.exists():
        raise FileNotFoundError(
            "config.yaml not found — make sure you are running from the project root (MediaGen/)"
        )
    return yaml.safe_load(p.read_text(encoding="utf-8"))


# ─────────────────────────────────────────────────────────────────────────────
# Single run
# ─────────────────────────────────────────────────────────────────────────────

def run_one(topic: str, cfg: dict) -> dict:
    """
    Run the full pipeline for a single topic.
    Returns the QA report dict.
    """
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
    _step(2, "Voice synthesis  (Kokoro)")
    voice_path, beat_wavs = synthesize(
        script, run_dir,
        voice=cfg["tts"]["voice"],
        speed=cfg["tts"]["speed"],
        sample_rate=cfg["tts"]["sample_rate"],
    )
    durations = beat_durations(beat_wavs)
    print(f"         Beat durations: {[f'{d:.1f}s' for d in durations]}")

    # ── 3. Captions ───────────────────────────────────────────────────────
    _step(3, "Word-level captions  (whisper-timestamped → ASS)")
    ass_path = generate_captions(voice_path, run_dir, cfg)

    # ── 4. Slides ─────────────────────────────────────────────────────────
    _step(4, "Slide rendering  (Pillow)")
    # Pass beat durations in ms so the HTML renderer captures the correct
    # number of frames per beat — video duration matches narration exactly.
    durations_ms = [int(d * 1000) for d in durations]
    slide_paths = render_slides(script, run_dir, cfg, beat_durations_ms=durations_ms)

    # ── 5. Assembly ───────────────────────────────────────────────────────
    _step(5, "Assembly  (FFmpeg)")
    final_path = assemble(
        slide_paths, durations,
        voice_path, ass_path,
        run_dir, cfg,
    )

    # ── 6. QA + thumbnail ─────────────────────────────────────────────────
    _step(6, "QA check")
    report = qa_check(final_path, cfg)
    thumb  = extract_thumbnail(final_path, run_dir)

    # enrich report
    report.update({
        "topic":      topic,
        "run_id":     run_id,
        "elapsed_s":  round(time.time() - t0, 1),
        "video":      str(final_path),
        "thumbnail":  str(thumb),
        "script":     script,
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

def run_batch(cfg: dict) -> None:
    topics_path = pathlib.Path(cfg["paths"]["topics"])
    topics = load_topics(topics_path)
    if not topics:
        print(f"[main] No topics found in {topics_path}")
        return
    print(f"[main] Batch mode — {len(topics)} topics")
    for i, topic in enumerate(topics, 1):
        print(f"\n[main] ── Topic {i}/{len(topics)} ──────────────────────")
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
    print(f"\n── Step {n}/6: {label} {'─' * max(0, 44 - len(label))}")


def _print_script(script: dict) -> None:
    print(f"  Title:    {script['title']}")
    thumb = script.get('thumbnail', '')
    if thumb: print(f"  Thumb:    {thumb}")
    style = script.get('style', '')
    if style: print(f"  Style:    {style}")
    for i, b in enumerate(script["beats"]):
        btype  = b.get("type", "beat").upper()
        energy = b.get("energy", "")
        tag    = f" [{energy}]" if energy else ""
        print(f"  {i+1}. {btype}{tag}: [{b['keyword']}]  {b['text'][:72]}…")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cfg = _load_cfg()

    args = sys.argv[1:]

    if not args:
        print(__doc__)
        sys.exit(0)

    if args[0] == "--batch":
        run_batch(cfg)

    elif args[0] == "--random":
        topic = random_topic(pathlib.Path(cfg["paths"]["topics"]))
        if not topic:
            print("[main] No topics in data/topics.txt")
            sys.exit(1)
        run_one(topic, cfg)

    else:
        topic = " ".join(args)
        run_one(topic, cfg)
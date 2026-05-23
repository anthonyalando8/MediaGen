"""
utils.py  —  QA, thumbnail extraction, topic file reader, workspace helpers.
"""

import pathlib
import re
import subprocess
import json
import random
import uuid


# ─────────────────────────────────────────────────────────────────────────────
# Workspace
# ─────────────────────────────────────────────────────────────────────────────

# Pattern that matches run dirs created by make_run_dir: "001_a3f2b1c4"
_RUN_DIR_PAT = re.compile(r'^(\d+)_[0-9a-f]{8}$')


def make_run_dir(workspace: str) -> tuple[str, pathlib.Path]:
    """
    Create a new sequenced run directory. Returns (run_id, path).

    Format: ``NNN_xxxxxxxx``  e.g. ``003_a3f2b1c4``

    NNN  — zero-padded 3-digit sequence number, one higher than the
           largest existing run dir in the workspace.  Starts at 001
           for a fresh workspace.  Non-run dirs (backups, notes, etc.)
           are ignored by the pattern match so they never affect the count.

    xxxxxxxx — 8-char hex UUID suffix for uniqueness (safe against the
               rare case where two processes start simultaneously and
               land on the same sequence number).

    Examples in a workspace that already has 001..005:
        make_run_dir(ws) → "006_9bbcee5e"   ← easy to spot as latest
        make_run_dir(ws) → "007_4f8d795e"
    """
    ws = pathlib.Path(workspace)
    ws.mkdir(parents=True, exist_ok=True)

    # Find the highest sequence number already present
    highest = 0
    for d in ws.iterdir():
        if d.is_dir():
            m = _RUN_DIR_PAT.match(d.name)
            if m:
                highest = max(highest, int(m.group(1)))

    seq     = highest + 1
    run_id  = f"{seq:03d}_{uuid.uuid4().hex[:8]}"
    run_dir = ws / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"[utils] Run dir → {run_dir}")
    return run_id, run_dir


# ─────────────────────────────────────────────────────────────────────────────
# Topic file
# ─────────────────────────────────────────────────────────────────────────────

def load_topics(path: pathlib.Path) -> list[str]:
    """Read topics.txt — one topic per non-blank line, skip # comments."""
    if not path.exists():
        print(f"[utils] topics file not found: {path.resolve()}")
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    topics = [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]
    print(f"[utils] Loaded {len(topics)} topics from {path.resolve()}")
    return topics


def random_topic(topics_path: pathlib.Path) -> str | None:
    topics = load_topics(topics_path)
    if not topics:
        print(f"[utils] No topics found in {topics_path}")
        return None
    topic = random.choice(topics)
    print(f"[utils] Random pick ({len(topics)} topics available): {topic}")
    return topic


# ─────────────────────────────────────────────────────────────────────────────
# QA gate
# ─────────────────────────────────────────────────────────────────────────────

def qa_check(video_path: pathlib.Path, cfg: dict) -> dict:
    """
    Run basic sanity checks on the final video.
    Returns a report dict with an 'ok' boolean.
    """
    report: dict = {
        "path":     str(video_path),
        "ok":       True,
        "warnings": [],
    }

    # ── ffprobe ──────────────────────────────────────────────────────────────
    try:
        probe  = _ffprobe(video_path)
    except Exception as e:
        report["ok"] = False
        report["warnings"].append(f"ffprobe failed: {e}")
        return report

    fmt = probe.get("format", {})
    streams = probe.get("streams", [])

    # duration
    # Target: 35-50s. Under 18s = script was too short (word count gate failed).
    # Over 90s = too long for TikTok hook retention.
    dur = float(fmt.get("duration", 0))
    report["duration_s"] = round(dur, 1)
    if dur < 18:
        _warn(report, f"Video only {dur:.1f}s — script word count was too low")
    elif dur < 30:
        print(f"[qa] ⚠  Short video ({dur:.1f}s) — acceptable if content is punchy")
    elif dur > 90:
        _warn(report, f"Video {dur:.1f}s — may be too long for TikTok hook")

    # resolution
    v_streams = [s for s in streams if s.get("codec_type") == "video"]
    if v_streams:
        vs = v_streams[0]
        ew, eh = cfg["video"]["width"], cfg["video"]["height"]
        aw, ah = vs.get("width", 0), vs.get("height", 0)
        report["resolution"] = f"{aw}x{ah}"
        if aw != ew or ah != eh:
            _warn(report, f"Resolution {aw}x{ah}, expected {ew}x{eh}")
    else:
        _warn(report, "No video stream found")

    # audio
    a_streams = [s for s in streams if s.get("codec_type") == "audio"]
    if not a_streams:
        _warn(report, "No audio stream — video will be silent!")

    # file size
    size_mb = video_path.stat().st_size / 1_048_576
    report["size_mb"] = round(size_mb, 1)
    if size_mb > 100:
        _warn(report, f"File is {size_mb:.1f} MB — may exceed upload limits")

    if report["warnings"]:
        for w in report["warnings"]:
            print(f"[qa]  ⚠  {w}")
    else:
        print(
            f"[qa] ✓ {report['duration_s']}s  "
            f"{report.get('resolution','?')}  "
            f"{report['size_mb']} MB"
        )

    return report


def _warn(report: dict, msg: str) -> None:
    report["warnings"].append(msg)
    report["ok"] = False


def _ffprobe(video_path: pathlib.Path) -> dict:
    out = subprocess.check_output([
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(video_path),
    ], text=True)
    return json.loads(out)


# ─────────────────────────────────────────────────────────────────────────────
# Thumbnail
# ─────────────────────────────────────────────────────────────────────────────

def extract_thumbnail(video_path: pathlib.Path, out_dir: pathlib.Path) -> pathlib.Path:
    """Extract a JPEG thumbnail from t=0.5s."""
    out = out_dir / "thumbnail.jpg"
    subprocess.run([
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-ss", "0.5", "-vframes", "1",
        "-q:v", "2",
        str(out),
    ], capture_output=True, check=True)
    print(f"[utils] ✓ thumbnail → {out.name}")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Report
# ─────────────────────────────────────────────────────────────────────────────

def save_report(report: dict, run_dir: pathlib.Path) -> None:
    path = run_dir / "report.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[utils] Report → {path}")
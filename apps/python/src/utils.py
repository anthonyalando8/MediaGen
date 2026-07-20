"""
utils.py  —  topic file reader + workspace helpers.
"""

import pathlib
import re
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
           largest existing run dir in the workspace. Starts at 001 for a
           fresh workspace. Non-run dirs are ignored by the pattern match.

    xxxxxxxx — 8-char hex UUID suffix for uniqueness (safe against two
               processes starting simultaneously on the same sequence number).
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

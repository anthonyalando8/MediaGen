"""
character.py  --  Mixamo character renderer integration

Calls the Node/Playwright renderer (mixamo/index.js) to produce
a PNG frame sequence of the animated character.

The character frames are stored at:
  <run_dir>/char_frames/frame_0001.png ...

These are later composited over the Playwright background frames
in assemble.py via ffmpeg overlay filter.

Requires:
  cd mixamo && npm install && npx playwright install chromium
"""

import pathlib
import subprocess
import os
import json


def _load_dotenv(env: dict) -> dict:
    dotenv_path = pathlib.Path(__file__).parent.parent / ".env"
    if not dotenv_path.exists():
        return env
    result = dict(env)
    for line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key   = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in result:
            result[key] = value
    return result


def render_character(
    run_dir:           pathlib.Path,
    cfg:               dict,
    beat_durations_ms: list = None,
) -> pathlib.Path:
    """
    Render character animation frames for all beats.

    Reads scene.json from run_dir (already written by render_slides).
    Outputs PNG frames to run_dir/char_frames/.

    Returns: path to char_frames directory.
    """

    # ── Locate files ──────────────────────────────────────────────────────
    project_root = pathlib.Path(__file__).parent.parent.resolve()
    mixamo_dir   = project_root / "mixamo"
    index_js     = mixamo_dir   / "index.js"
    scene_path   = run_dir      / "scene.json"

    if not index_js.exists():
        raise FileNotFoundError(
            f"[character] mixamo/index.js not found at {mixamo_dir}\n"
            f"Run: cd mixamo && npm install && npx playwright install chromium"
        )

    if not scene_path.exists():
        raise FileNotFoundError(
            f"[character] scene.json not found at {scene_path}\n"
            f"render_slides() must run before render_character()"
        )

    # ── Config ────────────────────────────────────────────────────────────
    char_cfg     = cfg.get("character", {})
    video_cfg    = cfg.get("video", {})
    render_cfg   = cfg.get("render", {})

    fps          = video_cfg.get("fps",    30)
    width        = video_cfg.get("width",  1080)
    height       = video_cfg.get("height", 1920)
    concurrency  = render_cfg.get("concurrency", 4)

    char_frames_dir = run_dir / "char_frames"
    char_frames_dir.mkdir(exist_ok=True)

    # ── Build command ─────────────────────────────────────────────────────
    def _abs(p: pathlib.Path) -> str:
        return str(p.resolve()).replace("\\", "/")

    cmd = [
        "node", _abs(index_js),
        "--scene",       _abs(scene_path),
        "--out",         _abs(run_dir),       # char_frames/ created inside run_dir
        "--fps",         str(fps),
        "--width",       str(width),
        "--height",      str(height),
        "--concurrency", str(concurrency),
    ]

    env = _load_dotenv({**os.environ, "PROJECT_ROOT": str(project_root)})

    print(f"[character] Rendering character frames...")
    print(f"[character] Output → {char_frames_dir}")

    result = subprocess.run(
        cmd,
        cwd=str(mixamo_dir),
        env=env,
        capture_output=False,   # stream output directly so progress is visible
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"[character] Mixamo renderer failed (exit {result.returncode})"
        )

    # ── Verify output ─────────────────────────────────────────────────────
    frame_count = len(list(char_frames_dir.glob("frame_*.png")))
    if frame_count == 0:
        raise RuntimeError(
            f"[character] Renderer exited cleanly but no frames found in {char_frames_dir}"
        )

    print(f"[character] Done — {frame_count} character frames")
    return char_frames_dir
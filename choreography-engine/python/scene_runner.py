"""
scene_runner.py
---------------
CLI entry point for the Python render pipeline.

Usage:
    python scene_runner.py scene.json --output ./frames --fps 30 --width 1080

Requirements:
    pip install playwright
    playwright install chromium
    ffmpeg in PATH (for video assembly)
"""

import asyncio
import base64
import json
import sys
import argparse
import time
from pathlib import Path
from chromium_pool import ChromiumPool
from frame_export import FrameExporter


def parse_args():
    parser = argparse.ArgumentParser(description="Choreography Engine — Scene Renderer")
    parser.add_argument("scene",  help="Path to scene JSON file")
    parser.add_argument("--output", "-o", default="./output/frames")
    parser.add_argument("--fps",    type=int, default=30)
    parser.add_argument("--width",  type=int, default=1080)
    parser.add_argument("--runtime-url", default="http://localhost:5173")
    parser.add_argument("--no-ffmpeg", action="store_true")
    parser.add_argument("--workers",   type=int, default=1)
    parser.add_argument("--visible",   action="store_true",
                        help="Show Chromium window (debug mode)")
    return parser.parse_args()


def validate_scene(scene: dict) -> list:
    errors = []
    if "meta" not in scene:
        errors.append("Missing: meta")
    else:
        if "id"       not in scene["meta"]: errors.append("Missing: meta.id")
        if "duration" not in scene["meta"]: errors.append("Missing: meta.duration")
    if "characters" not in scene:
        errors.append("Missing: characters")
    elif len(scene.get("characters", [])) == 0:
        errors.append("characters array is empty")
    return errors


async def render_scene(
    scene_path:   str,
    output_dir:   str,
    fps:          int  = 30,
    width:        int  = 1080,
    runtime_url:  str  = "http://localhost:5173",
    run_ffmpeg:   bool = True,
    workers:      int  = 1,
    headless:     bool = True,
):
    start_time = time.time()

    print(f"\n╔══ Choreography Engine Renderer ══════════════════")
    print(f"║  Scene:   {scene_path}")
    print(f"║  Output:  {output_dir}")
    print(f"║  FPS:     {fps}")
    print(f"║  Width:   {width}px")
    print(f"║  URL:     {runtime_url}/?render=1")
    print(f"╚══════════════════════════════════════════════════\n")

    # ── 1. Load + validate ───────────────────────────────────────
    scene_file = Path(scene_path)
    if not scene_file.exists():
        print(f"[ERROR] Scene file not found: {scene_path}")
        sys.exit(1)

    scene       = json.loads(scene_file.read_text(encoding="utf-8"))
    scene_id    = scene.get("meta", {}).get("id", "unnamed")
    duration    = float(scene.get("meta", {}).get("duration", 10.0))
    frame_count = int(duration * fps)

    print(f"[INFO] Scene: '{scene_id}'  Duration: {duration}s  Frames: {frame_count}")

    errors = validate_scene(scene)
    if errors:
        print("[ERROR] Validation failed:")
        for e in errors: print(f"  ✗ {e}")
        sys.exit(1)
    print("[INFO] Validation ✓")

    # ── 2. Output dir ────────────────────────────────────────────
    frames_dir = Path(output_dir) / scene_id
    frames_dir.mkdir(parents=True, exist_ok=True)
    print(f"[INFO] Frame output: {frames_dir}")

    # ── 3. Launch Chromium ───────────────────────────────────────
    pool     = ChromiumPool(runtime_url=runtime_url, stage_width=width, headless=headless)
    exporter = FrameExporter(frames_dir=frames_dir, fps=fps, frame_count=frame_count)

    print(f"[INFO] Launching Chromium... (headless={headless})")
    await pool.launch(workers=workers)

    try:
        page = await pool.get_page()

        # ── 4. Navigate to render mode ───────────────────────────
        render_url = f"{runtime_url.rstrip('/')}/?render=1"
        print(f"[INFO] Navigating to {render_url} ...")
        await page.goto(render_url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_load_state("networkidle", timeout=20_000)
        await asyncio.sleep(0.8)

        # ── 5. Verify render mode hooks ──────────────────────────
        has_setter = await page.evaluate("typeof window.__setRenderScene__ === 'function'")
        if not has_setter:
            print(f"[ERROR] window.__setRenderScene__ not found!")
            print(f"        Open {render_url} in Chrome and check the console.")
            sys.exit(1)
        print("[INFO] Render mode ✓")

        # ── 6. Inject scene ──────────────────────────────────────
        scene_json_str = json.dumps(scene)
        await page.evaluate(f"""
            window.__RENDER_WIDTH__ = {width};
            window.__RENDER_FPS__   = {fps};
            window.__SCENE_BUILT__  = false;
            window.__setRenderScene__({scene_json_str});
        """)

        # ── 7. Wait for MasterTimeline build ─────────────────────
        print("[INFO] Waiting for scene to build...")
        try:
            await page.wait_for_function(
                "window.__SCENE_BUILT__ === true",
                timeout=20_000, polling=200,
            )
        except Exception:
            err = await page.evaluate("window.__lastError__ ?? 'no error'")
            print(f"[ERROR] Scene never built. JS error: {err}")
            print(f"        Open {render_url} and run window.__setRenderScene__(scene) manually.")
            sys.exit(1)
        print("[INFO] Scene built ✓")

        # ── 8. Freeze GSAP ───────────────────────────────────────
        # Stop the GSAP ticker so Playwright doesn't see pending RAF callbacks.
        # We drive time manually with window.gsap.updateRoot(t) per frame.
        print("[INFO] Freezing GSAP ticker...")
        await page.evaluate("""
            window.gsap.ticker.sleep();
            window.gsap.globalTimeline.pause();
            window.gsap.ticker.lagSmoothing(0);
        """)
        print("[INFO] GSAP frozen ✓")

        # ── 9. Open CDP session ──────────────────────────────────
        # Use Chrome DevTools Protocol directly for frame capture.
        # This bypasses Playwright's screenshot() which waits for "no pending
        # animations" — a condition that never clears with GSAP's will-change
        # transforms on SVG elements.
        print("[INFO] Opening CDP session for direct frame capture...")
        cdp = await page.context.new_cdp_session(page)

        # Stage dimensions — must match ChromiumPool viewport
        stage_h = int(width * (420 / 360))

        # ── 10. Frame capture loop ────────────────────────────────
        print(f"[INFO] Starting frame capture: {frame_count} frames @ {fps}fps")

        captured = 0
        for i in range(frame_count):
            t = i / fps

            # Advance GSAP clock to this exact frame time
            await page.evaluate(f"window.gsap.updateRoot({t})")

            # Force layout flush — ensures CSS transforms are committed
            await page.evaluate("document.documentElement.getBoundingClientRect()")

            # Small sleep — Chromium needs ~1 event loop tick to composite
            await asyncio.sleep(0.02)

            # Capture via CDP — immediate, no animation-wait logic
            result = await cdp.send("Page.captureScreenshot", {
                "format":  "png",
                "clip": {
                    "x":      0,
                    "y":      0,
                    "width":  width,
                    "height": stage_h,
                    "scale":  1,
                },
                "captureBeyondViewport": False,
            })

            # Decode base64 PNG and write to disk
            frame_data = base64.b64decode(result["data"])
            frame_path = frames_dir / f"frame_{i:05d}.png"
            frame_path.write_bytes(frame_data)

            captured += 1

            # Progress log every second of footage
            if i % fps == 0 or i == frame_count - 1:
                elapsed   = time.time() - start_time
                remaining = (elapsed / max(i + 1, 1)) * (frame_count - i - 1)
                pct       = (i / frame_count) * 100
                print(
                    f"[CAPTURE] {i+1:4d}/{frame_count}  "
                    f"{pct:5.1f}%  "
                    f"elapsed: {elapsed:5.1f}s  "
                    f"eta: {remaining:.0f}s"
                )

        print(f"\n[INFO] Captured {captured}/{frame_count} frames ✓")

    finally:
        await pool.shutdown()

    # ── 11. Assemble video ────────────────────────────────────────
    if run_ffmpeg:
        print("\n[INFO] Assembling video with FFmpeg...")
        output_video = Path(output_dir) / f"{scene_id}.mp4"
        exporter.assemble(str(output_video))

    elapsed_total = time.time() - start_time
    print(f"\n[DONE] Render complete in {elapsed_total:.1f}s  "
          f"({frame_count} frames @ {fps}fps = {duration:.1f}s)\n")
    return str(frames_dir)


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(render_scene(
        scene_path  = args.scene,
        output_dir  = args.output,
        fps         = args.fps,
        width       = args.width,
        runtime_url = args.runtime_url,
        run_ffmpeg  = not args.no_ffmpeg,
        workers     = min(args.workers, 4),
        headless    = not args.visible,
    ))
"""
scene_runner.py — Choreography Engine render pipeline
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
    parser.add_argument("scene")
    parser.add_argument("--output", "-o", default="./output/frames")
    parser.add_argument("--fps",    type=int, default=30)
    parser.add_argument("--width",  type=int, default=1080)
    parser.add_argument("--runtime-url", default="http://localhost:5173")
    parser.add_argument("--no-ffmpeg", action="store_true")
    parser.add_argument("--workers",   type=int, default=1)
    parser.add_argument("--visible",   action="store_true")
    return parser.parse_args()


def validate_scene(scene):
    errors = []
    if "meta" not in scene: errors.append("Missing: meta")
    else:
        if "id"       not in scene["meta"]: errors.append("Missing: meta.id")
        if "duration" not in scene["meta"]: errors.append("Missing: meta.duration")
    if not scene.get("characters"): errors.append("Missing or empty: characters")
    return errors


async def render_scene(scene_path, output_dir, fps=30, width=1080,
                       runtime_url="http://localhost:5173",
                       run_ffmpeg=True, workers=1, headless=True):

    start_time = time.time()
    print(f"\n╔══ Choreography Engine Renderer ══════════════════")
    print(f"║  Scene:  {scene_path}")
    print(f"║  FPS:    {fps}   Width: {width}px")
    print(f"║  URL:    {runtime_url}/?render=1")
    print(f"╚══════════════════════════════════════════════════\n")

    # Load scene
    scene_file = Path(scene_path)
    if not scene_file.exists():
        print(f"[ERROR] Not found: {scene_path}"); sys.exit(1)

    scene       = json.loads(scene_file.read_text(encoding="utf-8"))
    scene_id    = scene["meta"].get("id", "unnamed")
    duration    = float(scene["meta"]["duration"])
    frame_count = int(duration * fps)
    print(f"[INFO] '{scene_id}'  {duration}s  {frame_count} frames")

    errors = validate_scene(scene)
    if errors:
        for e in errors: print(f"  ✗ {e}")
        sys.exit(1)

    frames_dir = Path(output_dir) / scene_id
    frames_dir.mkdir(parents=True, exist_ok=True)
    print(f"[INFO] Output: {frames_dir}")

    pool     = ChromiumPool(runtime_url=runtime_url, stage_width=width, headless=headless)
    exporter = FrameExporter(frames_dir=frames_dir, fps=fps, frame_count=frame_count)

    await pool.launch(workers=workers)

    try:
        page = await pool.get_page()
        render_url = f"{runtime_url.rstrip('/')}/?render=1"

        # Navigate
        print(f"[INFO] Loading {render_url}")
        await page.goto(render_url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_load_state("networkidle", timeout=20_000)
        await asyncio.sleep(1.0)

        # Verify render mode
        if not await page.evaluate("typeof window.__setRenderScene__ === 'function'"):
            print(f"[ERROR] Render mode not loaded. Open {render_url} and check console.")
            sys.exit(1)

        # Inject scene
        await page.evaluate(f"""
            window.__RENDER_WIDTH__ = {width};
            window.__SCENE_BUILT__  = false;
            window.__setRenderScene__({json.dumps(scene)});
        """)

        # Wait for build
        print("[INFO] Building scene...")
        try:
            await page.wait_for_function("window.__SCENE_BUILT__ === true",
                                          timeout=20_000, polling=200)
        except Exception:
            err = await page.evaluate("window.__lastError__ ?? 'unknown'")
            print(f"[ERROR] Scene build failed: {err}"); sys.exit(1)
        print("[INFO] Scene built ✓")

        # ── Freeze GSAP ──────────────────────────────────────────
        await page.evaluate("""
            window.gsap.ticker.sleep();
            window.gsap.globalTimeline.pause();
            window.gsap.ticker.lagSmoothing(0);
        """)

        # ── Strip GPU compositor hints ────────────────────────────
        # CSS will-change:transform and transformBox keep compositor layers
        # "pending" permanently. Stripping them before capture means
        # Chromium treats the page as fully composited and screenshots
        # complete instantly. GSAP will re-apply transforms via updateRoot
        # so animation correctness is not affected.
        print("[INFO] Stripping GPU compositor hints...")
        stripped = await page.evaluate("""
            (() => {
                let count = 0;
                document.querySelectorAll('*').forEach(el => {
                    const s = el.style;
                    if (s.willChange)     { s.willChange     = 'auto'; count++; }
                    if (s.transformBox)   { s.transformBox   = '';      count++; }
                });
                return count;
            })()
        """)
        print(f"[INFO] Stripped {stripped} compositor hints ✓")

        # ── Open CDP session for direct frame capture ─────────────
        # CDP Page.captureScreenshot bypasses Playwright's screenshot()
        # which internally waits for animation frames to settle.
        cdp     = await page.context.new_cdp_session(page)
        stage_h = int(width * (420 / 360))

        print(f"[INFO] Capturing {frame_count} frames @ {fps}fps via CDP...")
        captured = 0

        for i in range(frame_count):
            t = i / fps

            # Advance GSAP clock
            await page.evaluate(f"window.gsap.updateRoot({t})")

            # Flush layout
            await page.evaluate("document.documentElement.getBoundingClientRect()")

            # Brief yield — one event loop tick for paint commit
            await asyncio.sleep(0.016)

            # CDP capture — direct from surface, no animation-wait
            result = await cdp.send("Page.captureScreenshot", {
                "format": "png",
                "clip":   {"x": 0, "y": 0, "width": width, "height": stage_h, "scale": 1},
                "captureBeyondViewport": True,   # True avoids compositor sync wait
                "fromSurface": True,             # capture from GPU surface directly
                "optimizeForSpeed": True,        # skip lossless compression during loop
            })

            frame_data = base64.b64decode(result["data"])
            (frames_dir / f"frame_{i:05d}.png").write_bytes(frame_data)
            captured += 1

            if i % fps == 0 or i == frame_count - 1:
                elapsed   = time.time() - start_time
                remaining = (elapsed / max(i+1,1)) * (frame_count - i - 1)
                print(f"[CAPTURE] {i+1:4d}/{frame_count}  "
                      f"{(i/frame_count)*100:5.1f}%  "
                      f"elapsed:{elapsed:5.1f}s  eta:{remaining:.0f}s")

        print(f"\n[INFO] Captured {captured}/{frame_count} frames ✓")

    finally:
        await pool.shutdown()

    if run_ffmpeg:
        print("\n[INFO] Assembling video...")
        exporter.assemble(str(Path(output_dir) / f"{scene_id}.mp4"))

    elapsed = time.time() - start_time
    print(f"\n[DONE] {elapsed:.1f}s total  ({duration:.1f}s @ {fps}fps)\n")


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
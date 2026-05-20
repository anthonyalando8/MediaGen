"""
scene_runner.py — Choreography Engine render pipeline

Uses JavaScript canvas serialisation for frame capture.
No Chromium screenshot APIs — they all block on SVG compositor layers.
"""
import asyncio
import base64
import json
import sys
import argparse
import time
from pathlib import Path
from chromium_pool import ChromiumPool
from frame_export   import FrameExporter


def parse_args():
    p = argparse.ArgumentParser(description="Choreography Engine — Renderer")
    p.add_argument("scene")
    p.add_argument("--output", "-o", default="./output/frames")
    p.add_argument("--fps",    type=int, default=30)
    p.add_argument("--width",  type=int, default=1080)
    p.add_argument("--runtime-url", default="http://localhost:5173")
    p.add_argument("--no-ffmpeg",   action="store_true")
    p.add_argument("--workers",     type=int, default=1)
    p.add_argument("--visible",     action="store_true", help="Show browser window")
    return p.parse_args()


async def render_scene(scene_path, output_dir, fps=30, width=1080,
                       runtime_url="http://localhost:5173",
                       run_ffmpeg=True, workers=1, headless=True):

    t0 = time.time()
    print(f"\n╔══ Choreography Engine Renderer")
    print(f"║  {scene_path}  ·  {fps}fps  ·  {width}px")
    print(f"║  {runtime_url}/?render=1")
    print(f"╚═══════════════════════════════\n")

    # Load + validate
    sf = Path(scene_path)
    if not sf.exists():
        print(f"[ERROR] Not found: {scene_path}"); sys.exit(1)
    scene      = json.loads(sf.read_text(encoding="utf-8"))
    scene_id   = scene["meta"].get("id", "unnamed")
    duration   = float(scene["meta"]["duration"])
    n_frames   = int(duration * fps)
    print(f"[INFO] '{scene_id}'  {duration}s  →  {n_frames} frames")

    out_dir = Path(output_dir) / scene_id
    out_dir.mkdir(parents=True, exist_ok=True)

    pool     = ChromiumPool(runtime_url=runtime_url, stage_width=width, headless=headless)
    exporter = FrameExporter(frames_dir=out_dir, fps=fps, frame_count=n_frames)
    await pool.launch(workers=workers)

    try:
        page       = await pool.get_page()
        render_url = f"{runtime_url.rstrip('/')}/?render=1"

        # ── Navigate ─────────────────────────────────────────────
        print(f"[INFO] Loading {render_url} ...")
        await page.goto(render_url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_load_state("networkidle", timeout=20_000)
        await asyncio.sleep(1.2)   # let React mount + useEffect run

        # ── Verify hooks ──────────────────────────────────────────
        ok = await page.evaluate(
            "typeof window.__setRenderScene__ === 'function' "
            "&& typeof window.__captureFrame__ === 'function'"
        )
        if not ok:
            print(f"[ERROR] Window hooks not found. Open {render_url} and check console.")
            sys.exit(1)
        print("[INFO] Window hooks ✓")

        # ── Inject scene ──────────────────────────────────────────
        await page.evaluate(f"""
            window.__RENDER_WIDTH__ = {width};
            window.__SCENE_BUILT__  = false;
            window.__setRenderScene__({json.dumps(scene)});
        """)

        # ── Wait for MasterTimeline ───────────────────────────────
        print("[INFO] Building scene...")
        try:
            await page.wait_for_function(
                "window.__SCENE_BUILT__ === true",
                timeout=20_000, polling=200
            )
        except Exception:
            err = await page.evaluate("window.__lastError__ ?? 'unknown error'")
            print(f"[ERROR] Scene build failed: {err}"); sys.exit(1)
        print("[INFO] Scene built ✓")

        # ── Freeze GSAP ───────────────────────────────────────────
        # Pause the ticker so no background animations keep running.
        # We advance time manually with gsap.updateRoot(t).
        await page.evaluate("""
            window.gsap.ticker.sleep();
            window.gsap.globalTimeline.pause();
            window.gsap.ticker.lagSmoothing(0);
        """)
        print("[INFO] GSAP frozen ✓")

        # ── Verify __captureFrame__ works on frame 0 ──────────────
        print("[INFO] Testing canvas capture...")
        await page.evaluate("window.gsap.updateRoot(0)")
        await asyncio.sleep(0.1)
        test = await page.evaluate("window.__captureFrame__()")
        if not test or len(test) < 100:
            print("[ERROR] __captureFrame__() returned empty data.")
            print("        Check browser console at /?render=1")
            sys.exit(1)
        print(f"[INFO] Canvas capture ✓  (frame 0: {len(test)} chars base64)")

        # Write frame 0 (already captured in test)
        (out_dir / "frame_00000.png").write_bytes(base64.b64decode(test))

        # ── Frame capture loop ────────────────────────────────────
        print(f"[INFO] Capturing {n_frames} frames @ {fps}fps ...")
        captured = 1   # frame 0 already done

        for i in range(1, n_frames):
            t = i / fps

            # Advance GSAP clock to this frame time
            await page.evaluate(f"window.gsap.updateRoot({t})")

            # One microtask tick — lets SVG transforms flush to DOM
            await asyncio.sleep(0)

            # Capture via canvas serialisation (no screenshot API)
            b64 = await page.evaluate("window.__captureFrame__()")

            (out_dir / f"frame_{i:05d}.png").write_bytes(base64.b64decode(b64))
            captured += 1

            if i % fps == 0 or i == n_frames - 1:
                elapsed   = time.time() - t0
                remaining = (elapsed / max(i+1, 1)) * (n_frames - i - 1)
                print(f"[CAPTURE] {i+1:4d}/{n_frames}  "
                      f"{(i/n_frames)*100:5.1f}%  "
                      f"elapsed:{elapsed:5.1f}s  eta:{remaining:.0f}s")

        print(f"\n[INFO] Captured {captured}/{n_frames} frames ✓")

    finally:
        await pool.shutdown()

    # ── Assemble ──────────────────────────────────────────────────
    if run_ffmpeg:
        print("\n[INFO] Assembling with FFmpeg...")
        exporter.assemble(str(Path(output_dir) / f"{scene_id}.mp4"))

    print(f"\n[DONE] {time.time()-t0:.1f}s  ({duration:.1f}s video @ {fps}fps)\n")


if __name__ == "__main__":
    a = parse_args()
    asyncio.run(render_scene(
        scene_path  = a.scene,
        output_dir  = a.output,
        fps         = a.fps,
        width       = a.width,
        runtime_url = a.runtime_url,
        run_ffmpeg  = not a.no_ffmpeg,
        workers     = min(a.workers, 4),
        headless    = not a.visible,
    ))
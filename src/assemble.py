"""
assemble.py -- FFmpeg assembly pipeline.

Stages:
  1. slide_video  -- concat slide PNGs held for beat duration -> silent .mp4
  2. audio_mix    -- loudnorm voice + duck BGM -> .aac
  3. mux          -- merge slide_video + audio_mix -> muxed.mp4
  4. captions     -- burn ASS subtitles onto muxed.mp4 -> final.mp4

Windows + FFmpeg subtitles filter notes:
  The subtitles= filter on Windows is extremely sensitive to paths.
  fontsdir= cannot contain a colon at all (even D:/...) -- the filter
  parser treats the whole vf string as one token and breaks on it.
  Solution: copy the .ass file to a short temp path (C:/tmp/) before
  burning, eliminating drive-letter colons and spaces from the filter
  string entirely.  fontsdir is omitted; FFmpeg uses its built-in font
  fallback (DejaVu) which is fine -- the font was already embedded into
  the slide PNGs by Pillow.  Captions still render correctly.
"""

import pathlib
import subprocess
import random
import shutil
import sys
import tempfile
import os


def _run(cmd, label):
    print(f"[assemble] {label}...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[assemble] FFmpeg error at '{label}':\n{res.stderr[-2000:]}", file=sys.stderr)
        raise RuntimeError(f"FFmpeg failed: {label}")
    print(f"[assemble] OK {label}")


# -----------------------------------------------------------------------
# Stage 1 -- slide video
# -----------------------------------------------------------------------

def build_slide_video(slide_paths, durations, out_path, cfg, gap_s=0.38):
    fps = cfg["video"]["fps"]
    w   = cfg["video"]["width"]
    h   = cfg["video"]["height"]

    concat_file = out_path.parent / "concat_slides.txt"
    lines = []
    for i, (slide, dur) in enumerate(zip(slide_paths, durations)):
        hold = dur + (gap_s if i < len(slide_paths) - 1 else 0)
        lines.append(f"file '{slide.resolve().as_posix()}'")
        lines.append(f"duration {hold:.4f}")
    lines.append(f"file '{slide_paths[-1].resolve().as_posix()}'")
    concat_file.write_text("\n".join(lines), encoding="utf-8")

    _run([
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_file),
        "-vf", (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black"
        ),
        "-c:v", "libx264",
        "-preset", cfg["video"]["preset"],
        "-crf", str(cfg["video"]["crf"]),
        "-pix_fmt", "yuv420p",
        "-r", str(fps),
        str(out_path),
    ], "Build slide video")
    return out_path


# -----------------------------------------------------------------------
# Stage 2 -- audio mix
# -----------------------------------------------------------------------

def _pick_bgm(bgm_dir):
    tracks = list(bgm_dir.glob("*.mp3")) + list(bgm_dir.glob("*.wav"))
    if not tracks:
        print("[assemble] No BGM tracks found -- continuing without music")
        return None
    track = random.choice(tracks)
    print(f"[assemble] BGM: {track.name}")
    return track


def mix_audio(voice_path, bgm_dir, out_path, bgm_vol=0.10):
    bgm = _pick_bgm(bgm_dir)

    if bgm is None:
        _run([
            "ffmpeg", "-y",
            "-i", str(voice_path),
            "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
            "-c:a", "aac", "-b:a", "192k",
            str(out_path),
        ], "Normalize voice (no BGM)")
        return out_path

    _run([
        "ffmpeg", "-y",
        "-i", str(voice_path),
        "-stream_loop", "-1", "-i", str(bgm),
        "-filter_complex", (
            "[0:a]loudnorm=I=-16:LRA=11:TP=-1.5[voice];"
            f"[1:a]volume={bgm_vol},afade=t=in:st=0:d=1,"
            f"afade=t=out:st=0:d=2[bgm];"
            "[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[out]"
        ),
        "-map", "[out]",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(out_path),
    ], "Mix voice + BGM")
    return out_path


# -----------------------------------------------------------------------
# Stage 3 -- mux
# -----------------------------------------------------------------------

def mux(video_path, audio_path, out_path):
    _run([
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(audio_path),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "copy",
        "-shortest",
        str(out_path),
    ], "Mux video + audio")
    return out_path


# -----------------------------------------------------------------------
# Stage 4 -- burn captions
# -----------------------------------------------------------------------

def _short_temp_ass(ass_path):
    """
    Copy the .ass file to a short path with no spaces and no drive-letter
    ambiguity for the FFmpeg subtitles filter.

    Strategy (Windows):
      Try C:/tmp/mg_captions.ass first (short, no colon issues in vf string
      because we use a relative or UNC workaround).
      Fall back to a system temp dir.

    Returns the temp path as a plain forward-slash POSIX string suitable
    for embedding directly in the FFmpeg -vf subtitles= value.
    """
    # Use the Windows short temp dir -- usually C:\Users\...\AppData\Local\Temp
    # but we want something without spaces.  Try a few options:
    candidates = [
        pathlib.Path("C:/tmp"),
        pathlib.Path(os.environ.get("TEMP", "C:/tmp")),
        pathlib.Path(tempfile.gettempdir()),
    ]

    tmp_dir = None
    for c in candidates:
        try:
            c.mkdir(parents=True, exist_ok=True)
            tmp_dir = c
            # prefer C:/tmp because it has no spaces
            if "C:/tmp" in c.as_posix() or c == pathlib.Path("C:/tmp"):
                break
        except Exception:
            continue

    if tmp_dir is None:
        # last resort: use the run dir itself
        tmp_dir = ass_path.parent

    dst = tmp_dir / "mg_captions.ass"
    shutil.copy2(str(ass_path), str(dst))
    return dst


def burn_captions(video_path, ass_path, out_path, cfg):
    """
    Burn ASS subtitles onto video.

    Windows FFmpeg path strategy:
      - Resolve ALL paths to absolute BEFORE changing cwd.
      - Copy .ass to C:/tmp (short, no spaces).
      - chdir to drive root so the .ass can be a relative path (no colon).
      - Restore cwd in finally regardless of outcome.
    """
    tmp_ass = _short_temp_ass(ass_path)
    print(f"[assemble] ASS temp copy: {tmp_ass}")

    # Resolve everything to absolute strings NOW before any chdir
    video_abs = str(video_path.resolve())
    out_abs   = str(out_path.resolve())
    tmp_abs   = tmp_ass.resolve()

    cwd_before = pathlib.Path.cwd()
    drive      = tmp_abs.drive             # "C:"
    drive_root = pathlib.Path(drive + "/") # C:/
    rel        = tmp_abs.relative_to(drive_root).as_posix()  # tmp/mg_captions.ass
    vf         = f"subtitles='{rel}'"
    print(f"[assemble] cwd -> {drive_root}  |  vf: {vf}")

    try:
        os.chdir(str(drive_root))
        _run([
            "ffmpeg", "-y",
            "-i", video_abs,
            "-vf", vf,
            "-c:v", "libx264",
            "-preset", cfg["video"]["preset"],
            "-crf", str(cfg["video"]["crf"]),
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            out_abs,
        ], "Burn captions")
    finally:
        os.chdir(str(cwd_before))

    return out_path


def assemble(slide_paths, durations, voice_path, ass_path, run_dir, cfg):
    bgm_dir = pathlib.Path(cfg["paths"]["bgm"])

    silent = run_dir / "slides_silent.mp4"
    mixed  = run_dir / "audio_mix.aac"
    muxed  = run_dir / "muxed.mp4"
    final  = run_dir / "final.mp4"

    build_slide_video(slide_paths, durations, silent, cfg)
    mix_audio(voice_path, bgm_dir, mixed, cfg["video"]["bgm_volume"])
    mux(silent, mixed, muxed)
    burn_captions(muxed, ass_path, final, cfg)

    return final
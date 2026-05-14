"""
assemble.py -- FFmpeg assembly pipeline.

Supports two input modes, auto-detected:

  Pillow mode   slide_paths = [slide_0.png, slide_1.png, ...]
                Each PNG held for beat duration via concat demuxer.

  HTML mode     slide_paths = [beat_0/, beat_1/, ...]  (frame directories)
                Each directory contains frame_00000.png ... frame_NNNNN.png
                captured by Playwright. Assembled via image2 demuxer.

Stages (both modes share stages 2-4):
  1a. (Pillow) build_slide_video         -- PNG stills -> silent .mp4
  1b. (HTML)   build_slide_video_from_frames -- frame dirs -> silent .mp4
  2.  mix_audio                          -- loudnorm voice + duck BGM -> .aac
  3.  mux                                -- video + audio -> muxed.mp4
  4.  burn_captions                      -- ASS subtitles -> final.mp4
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
# Stage 1a -- Pillow mode: PNG stills -> silent video
# -----------------------------------------------------------------------

def build_slide_video(slide_paths, durations, out_path, cfg, gap_s=0.38):
    """Each PNG held for its beat duration + a short gap between beats."""
    fps = cfg["video"]["fps"]
    w   = cfg["video"]["width"]
    h   = cfg["video"]["height"]

    concat_file = out_path.parent / "concat_slides.txt"
    lines = []
    for i, (slide, dur) in enumerate(zip(slide_paths, durations)):
        hold = dur + (gap_s if i < len(slide_paths) - 1 else 0)
        lines.append(f"file '{slide.resolve().as_posix()}'")
        lines.append(f"duration {hold:.4f}")
    # concat demuxer needs last file repeated without duration to flush
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
    ], "Build slide video (Pillow mode)")
    return out_path


# -----------------------------------------------------------------------
# Stage 1b -- HTML renderer mode: frame dirs -> silent video
# -----------------------------------------------------------------------

def build_slide_video_from_frames(beat_dirs, out_path, cfg):
    """
    Convert Playwright frame sequences to a video.

    For each beat dir:
      frame_00000.png ... frame_NNNNN.png  ->  beat_N.mp4
    Then concat all beat_N.mp4 -> out_path (stream copy, no re-encode).
    """
    fps    = cfg["video"]["fps"]
    w      = cfg["video"]["width"]
    h      = cfg["video"]["height"]
    preset = cfg["video"]["preset"]
    crf    = str(cfg["video"]["crf"])
    work   = out_path.parent

    beat_videos = []

    for i, beat_dir in enumerate(sorted(pathlib.Path(d) for d in beat_dirs)):
        frames = sorted(beat_dir.glob("frame_*.png"))
        if not frames:
            raise RuntimeError(f"[assemble] No frames found in {beat_dir}")

        beat_mp4 = work / f"beat_{i}.mp4"
        pattern  = beat_dir / "frame_%05d.png"

        _run([
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", str(pattern),
            "-vf", f"scale={w}:{h}",
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", crf,
            "-pix_fmt", "yuv420p",
            str(beat_mp4),
        ], f"Beat {i} frames → video ({len(frames)} frames)")

        beat_videos.append(beat_mp4)

    # stream-copy concat (no re-encode)
    concat_file = work / "concat_beats.txt"
    concat_file.write_text(
        "\n".join(f"file '{p.resolve().as_posix()}'" for p in beat_videos),
        encoding="utf-8",
    )
    _run([
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_file),
        "-c", "copy",
        str(out_path),
    ], "Concat beat videos")

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


def _voice_duration(wav_path: pathlib.Path) -> float:
    """Get duration of a WAV file in seconds via ffprobe."""
    import json as _json
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            str(wav_path),
        ], text=True, stderr=subprocess.DEVNULL)
        return float(_json.loads(out)["format"]["duration"])
    except Exception:
        return 0.0


def mix_audio(voice_path, bgm_dir, out_path, bgm_vol=0.10):
    """
    Mix narration voice with a background music track.

    BGM treatment:
      - Trimmed/looped to exactly the voice duration.
      - Volume set to bgm_vol (default 10% — audible but not competing).
      - 1s fade-in at the start.
      - 2s fade-out at the end (calculated from actual voice duration).
      - Voice normalized to -16 LUFS so levels are consistent.
    """
    bgm = _pick_bgm(bgm_dir)

    if bgm is None:
        print("[assemble] No BGM — normalizing voice only")
        _run([
            "ffmpeg", "-y",
            "-i", str(voice_path),
            "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
            "-c:a", "aac", "-b:a", "192k",
            str(out_path),
        ], "Normalize voice (no BGM)")
        return out_path

    # Get actual voice duration so we can set the BGM fade-out correctly.
    # afade st= must be (duration - fade_length), not 0.
    voice_dur = _voice_duration(voice_path)
    fade_in   = 1.0
    fade_out  = 2.5
    fade_out_start = max(0.0, voice_dur - fade_out)

    print(f"[assemble] BGM: {bgm.name}  voice={voice_dur:.1f}s  "
          f"fade_out at t={fade_out_start:.1f}s  vol={bgm_vol}")

    _run([
        "ffmpeg", "-y",
        "-i", str(voice_path),
        # Loop BGM so it always covers the full video regardless of track length
        "-stream_loop", "-1", "-i", str(bgm),
        "-filter_complex", (
            # Voice: loudnorm to -16 LUFS
            "[0:a]loudnorm=I=-16:LRA=11:TP=-1.5[voice];"
            # BGM: set volume, trim to voice duration, fade in + fade out
            f"[1:a]"
            f"volume={bgm_vol},"
            f"afade=t=in:st=0:d={fade_in},"
            f"afade=t=out:st={fade_out_start:.3f}:d={fade_out}"
            f"[bgm];"
            # Mix: voice takes priority; BGM fills the full duration
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
    """Copy .ass to C:/tmp (short path, no spaces) for FFmpeg on Windows."""
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
            if "C:/tmp" in c.as_posix() or c == pathlib.Path("C:/tmp"):
                break
        except Exception:
            continue
    if tmp_dir is None:
        tmp_dir = ass_path.parent

    dst = tmp_dir / "mg_captions.ass"
    shutil.copy2(str(ass_path), str(dst))
    return dst


def burn_captions(video_path, ass_path, out_path, cfg):
    """
    Burn ASS subtitles.  Windows FFmpeg path workaround:
      - Resolve ALL paths to absolute BEFORE chdir.
      - Copy .ass to C:/tmp (short, no spaces).
      - chdir to drive root so the .ass is a relative path (no colon in vf).
    """
    tmp_ass = _short_temp_ass(ass_path)
    print(f"[assemble] ASS temp copy: {tmp_ass}")

    video_abs = str(video_path.resolve())
    out_abs   = str(out_path.resolve())
    tmp_abs   = tmp_ass.resolve()

    cwd_before = pathlib.Path.cwd()
    drive      = tmp_abs.drive
    drive_root = pathlib.Path(drive + "/")
    rel        = tmp_abs.relative_to(drive_root).as_posix()
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


# -----------------------------------------------------------------------
# Public API -- unified entry point
# -----------------------------------------------------------------------

def assemble(slide_paths, durations, voice_path, ass_path, run_dir, cfg):
    """
    Auto-detects renderer mode from slide_paths:
      - list of .png files  ->  Pillow mode (static slide hold)
      - list of directories ->  HTML renderer mode (frame sequences)
    """
    bgm_dir = pathlib.Path(cfg["paths"]["bgm"])

    silent = run_dir / "slides_silent.mp4"
    mixed  = run_dir / "audio_mix.aac"
    muxed  = run_dir / "muxed.mp4"
    final  = run_dir / "final.mp4"

    # detect mode: is the first item a directory?
    first = pathlib.Path(slide_paths[0])
    if first.is_dir():
        print("[assemble] HTML renderer mode — assembling from frame directories")
        build_slide_video_from_frames(slide_paths, silent, cfg)
    else:
        print("[assemble] Pillow mode — assembling from static PNGs")
        build_slide_video(slide_paths, durations, silent, cfg)

    mix_audio(voice_path, bgm_dir, mixed, cfg["video"]["bgm_volume"])
    mux(silent, mixed, muxed)
    burn_captions(muxed, ass_path, final, cfg)

    return final
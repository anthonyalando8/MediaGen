"""
assemble.py -- FFmpeg assembly pipeline (v2 — mood-aware BGM).

Supports two input modes, auto-detected:

  Pillow mode   slide_paths = [slide_0.png, slide_1.png, ...]
  HTML mode     slide_paths = [beat_0/, beat_1/, ...]  (frame directories)

────────────────────────────────────────────────────────────────────
v2 CHANGES
────────────────────────────────────────────────────────────────────
1. BGM is now selected based on script.global.music_mood by matching
   keywords against filenames in assets/bgm/.  No directory
   reorganisation required — name files like "tense_ambient_01.mp3"
   or "cinematic_strings.wav" and the picker will find them.
2. assemble() and mix_audio() now accept the script dict so mood
   reaches the picker.
3. Falls back to random pick when no filename matches the mood.
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
    """Convert Playwright frame sequences to a concatenated video."""
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
# Stage 2 -- mood-aware BGM picker + audio mix
# -----------------------------------------------------------------------

# Keyword vocabulary per mood. Filenames in assets/bgm/ are matched
# case-insensitively against these. Extend the lists as your library grows.
_BGM_KEYWORDS = {
    "tense":      ["tense", "suspense", "thriller", "anxious"],
    "cinematic":  ["cinematic", "epic", "filmic", "score", "drama"],
    "ambient":    ["ambient", "atmosphere", "drone", "pad"],
    "dark":       ["dark", "shadow", "noir", "low"],
    "aggressive": ["aggressive", "hard", "intense", "drive", "trap"],
    "suspense":   ["suspense", "tense", "thriller", "build"],
    "minimal":    ["minimal", "clean", "soft", "piano"],
    "emotional":  ["emotional", "warm", "heart", "soft"],
    "playful":    ["playful", "light", "fun", "bounce", "quirk"],
    "upbeat":     ["upbeat", "energy", "bright", "uplift"],
}


def _pick_bgm_for_mood(bgm_dir: pathlib.Path, mood: str | None) -> pathlib.Path | None:
    """
    Pick a BGM track that matches the script's music_mood.

    Strategy:
      1. List all *.mp3 / *.wav in bgm_dir
      2. If mood is None or unknown → random pick (legacy behaviour)
      3. Filter tracks whose filename contains any mood keyword (case-insensitive)
      4. If matches found → random pick among them
      5. If no matches → fall back to random across all (with a log warning)
    """
    tracks = list(bgm_dir.glob("*.mp3")) + list(bgm_dir.glob("*.wav"))
    if not tracks:
        print("[assemble] No BGM tracks found — continuing without music")
        return None

    mood_norm = (mood or "").strip().lower()
    if not mood_norm or mood_norm not in _BGM_KEYWORDS:
        track = random.choice(tracks)
        print(f"[assemble] BGM (random, no mood): {track.name}")
        return track

    keywords = _BGM_KEYWORDS[mood_norm]
    matches  = [
        t for t in tracks
        if any(kw in t.stem.lower() for kw in keywords)
    ]

    if matches:
        track = random.choice(matches)
        print(f"[assemble] BGM (mood='{mood_norm}', {len(matches)} match): {track.name}")
        return track

    # No filename matches — fall back but log so the user can see they need
    # to organise/rename their library to take advantage of mood filtering.
    track = random.choice(tracks)
    print(f"[assemble] BGM (mood='{mood_norm}' had no filename matches — falling back): {track.name}")
    print(f"[assemble]   tip: rename tracks to include mood keywords like {keywords[:2]}")
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


def mix_audio(
    voice_path: pathlib.Path,
    bgm_dir:    pathlib.Path,
    out_path:   pathlib.Path,
    bgm_vol:    float       = 0.10,
    mood:       str | None  = None,
) -> pathlib.Path:
    """
    Mix narration voice with a mood-matched background music track.

    bgm_vol — typically 0.08–0.12. Audible but not competing with voice.
    mood    — script.global.music_mood. Drives BGM filename filtering.
    """
    bgm = _pick_bgm_for_mood(bgm_dir, mood)

    if bgm is None:
        print("[assemble] No BGM — normalising voice only")
        _run([
            "ffmpeg", "-y",
            "-i", str(voice_path),
            "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
            "-c:a", "aac", "-b:a", "192k",
            str(out_path),
        ], "Normalise voice (no BGM)")
        return out_path

    voice_dur      = _voice_duration(voice_path)
    fade_in        = 1.0
    fade_out       = 2.5
    fade_out_start = max(0.0, voice_dur - fade_out)

    print(f"[assemble] BGM: {bgm.name}  voice={voice_dur:.1f}s  "
          f"fade_out at t={fade_out_start:.1f}s  vol={bgm_vol}")

    _run([
        "ffmpeg", "-y",
        "-i", str(voice_path),
        "-stream_loop", "-1", "-i", str(bgm),
        "-filter_complex", (
            "[0:a]loudnorm=I=-16:LRA=11:TP=-1.5[voice];"
            f"[1:a]"
            f"volume={bgm_vol},"
            f"afade=t=in:st=0:d={fade_in},"
            f"afade=t=out:st={fade_out_start:.3f}:d={fade_out}"
            f"[bgm];"
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
# Stage 4 -- burn captions (Windows path quirks)
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
# Public API
# -----------------------------------------------------------------------

def assemble(
    slide_paths,
    durations,
    voice_path,
    ass_path,
    run_dir,
    cfg,
    script: dict | None = None,
):
    """
    Auto-detects renderer mode and assembles the final video.

    script (optional) — passed to BGM picker for mood-matched selection.
                        If None, falls back to random BGM choice.
    """
    bgm_dir = pathlib.Path(cfg["paths"]["bgm"])
    mood    = (script or {}).get("global", {}).get("music_mood", "") if script else ""

    silent = run_dir / "slides_silent.mp4"
    mixed  = run_dir / "audio_mix.aac"
    muxed  = run_dir / "muxed.mp4"
    final  = run_dir / "final.mp4"

    first = pathlib.Path(slide_paths[0])
    if first.is_dir():
        print("[assemble] HTML renderer mode — assembling from frame directories")
        build_slide_video_from_frames(slide_paths, silent, cfg)
    else:
        print("[assemble] Pillow mode — assembling from static PNGs")
        build_slide_video(slide_paths, durations, silent, cfg)

    mix_audio(voice_path, bgm_dir, mixed, cfg["video"]["bgm_volume"], mood=mood)
    mux(silent, mixed, muxed)
    burn_captions(muxed, ass_path, final, cfg)

    return final

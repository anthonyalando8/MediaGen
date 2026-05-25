"""
assemble.py -- FFmpeg assembly pipeline (v3 — mood-aware BGM + transitions).

Supports two input modes, auto-detected:

  Pillow mode   slide_paths = [slide_0.png, slide_1.png, ...]
  HTML mode     slide_paths = [beat_0/, beat_1/, ...]  (frame directories)

────────────────────────────────────────────────────────────────────
v3 CHANGES  (transition-aware assembly)
────────────────────────────────────────────────────────────────────
Transition handling per beat.transition value:

  CSS-handled — just concat, visuals are already in the rendered frames:
    cut        plain cut
    slam_cut   trans-chroma CSS fires chromatic flash at beat start
    flash      trans-flash CSS fires white flash at beat start
    dip_black  trans-dip-black CSS fades to black into the 380ms gap frames

  ffmpeg xfade — applied between consecutive beat MP4s:
    blur_wipe  xfade fade       0.25 s
    fade       xfade fade       0.40 s
    whip_pan   xfade slideleft  0.20 s

  scene.json is located automatically at frames/../scene.json
  (one level up from the beat_* directories). When not found, all
  transitions fall back to plain concat — identical to v2 behaviour.
"""

import pathlib
import subprocess
import random
import shutil
import sys
import tempfile
import os
import json as _json


def _run(cmd, label):
    print(f"[assemble] {label}...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[assemble] FFmpeg error at '{label}':\n{res.stderr[-2000:]}", file=sys.stderr)
        raise RuntimeError(f"FFmpeg failed: {label}")
    print(f"[assemble] OK {label}")


# ── Transition config ────────────────────────────────────────────────────────
# CSS-handled transitions — no ffmpeg work needed, just concat.
_CSS_TRANSITIONS = {"cut", "slam_cut", "flash", "dip_black", ""}

# ffmpeg xfade parameters: transition → (xfade_name, duration_seconds)
_XFADE_MAP = {
    "blur_wipe": ("fade",       0.25),
    "fade":      ("fade",       0.40),
    "whip_pan":  ("slideleft",  0.20),
}


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

def _video_duration(video_path: pathlib.Path) -> float:
    """Return duration in seconds via ffprobe."""
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", str(video_path),
        ], text=True, stderr=subprocess.DEVNULL)
        return float(_json.loads(out)["format"]["duration"])
    except Exception:
        return 5.0


def _load_scene_json(beat_dirs) -> dict | None:
    """
    Find and parse scene.json.
    Expected location: frames/scene.json  (parent of the beat_* dirs).
    """
    for d in beat_dirs:
        candidate = pathlib.Path(d).parent / "scene.json"
        if candidate.exists():
            try:
                data = _json.loads(candidate.read_text(encoding="utf-8"))
                print(f"[assemble] scene.json loaded from {candidate}")
                return data
            except Exception as e:
                print(f"[assemble] Could not parse scene.json: {e}")
    return None


def _build_xfade_chain(beat_videos, transitions, work, cfg):
    """
    Build a single output video by chaining beat MP4s with per-beat
    xfade filters where needed, and plain concat everywhere else.

    Returns path to the assembled video.
    """
    fps    = cfg["video"]["fps"]
    preset = cfg["video"]["preset"]
    crf    = str(cfg["video"]["crf"])

    # Split beat_videos into runs separated by xfade boundaries.
    # A run is a list of consecutive videos that will be plain-concat'd,
    # then each run is joined to the next via xfade.
    #
    # transitions[i] = transition ENTERING beat i (from beat i-1 → beat i).
    # Index 0 is the first beat — no incoming transition.

    n = len(beat_videos)

    # Build segments: list of (video_path, incoming_xfade | None)
    segments = []
    for i, v in enumerate(beat_videos):
        t = transitions[i] if i < len(transitions) else "cut"
        xfade = _XFADE_MAP.get(t)   # None for CSS-handled transitions
        segments.append((v, xfade))

    # If no xfade transitions at all, plain concat is fastest
    if not any(xf for _, xf in segments[1:]):
        concat_file = work / "concat_beats.txt"
        concat_file.write_text(
            "\n".join(f"file '{p.resolve().as_posix()}'" for p in beat_videos),
            encoding="utf-8",
        )
        out = work / "assembled.mp4"
        _run([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            str(out),
        ], "Concat beat videos (no xfade transitions)")
        return out

    # ── Build one big filter_complex ────────────────────────────────
    # We process beats left-to-right. Each step either uses concat
    # (for CSS transitions) or xfade (for ffmpeg transitions).
    #
    # Approach: build a running "accumulated" video by processing
    # pairs sequentially. For each pair (accumulated, next_beat):
    #   - CSS transition  → concat them (extend the accumulation)
    #   - xfade           → apply xfade, track cumulative offset

    print(f"[assemble] Building transition chain across {n} beats…")

    # Get all durations up front
    durs = [_video_duration(v) for v in beat_videos]

    # We'll build the filter_complex incrementally.
    inputs = []
    for v in beat_videos:
        inputs += ["-i", str(v)]

    filter_parts = []
    label_idx    = 0
    prev_label   = "[0:v]"
    cumulative_s = durs[0]  # duration of what prev_label represents

    for i in range(1, n):
        next_label = f"[{i}:v]"
        t          = transitions[i] if i < len(transitions) else "cut"
        xfade      = _XFADE_MAP.get(t)

        if xfade:
            xf_name, xf_dur = xfade
            # Offset = cumulative duration MINUS xfade duration
            # (xfade starts this many seconds from the beginning of
            #  the accumulated stream, overlapping the last xf_dur
            #  seconds of beat i-1 with the first xf_dur seconds of beat i)
            offset = max(0.0, cumulative_s - xf_dur)
            out_label = f"xf{label_idx}"
            filter_parts.append(
                f"{prev_label}{next_label}"
                f"xfade=transition={xf_name}"
                f":duration={xf_dur:.3f}"
                f":offset={offset:.3f}"
                f"[{out_label}]"
            )
            print(f"[assemble]   Beat {i} ({t}): xfade={xf_name} "
                  f"dur={xf_dur}s offset={offset:.2f}s")
            cumulative_s += durs[i] - xf_dur
        else:
            # Plain concat: extend accumulated stream
            out_label = f"ct{label_idx}"
            filter_parts.append(
                f"{prev_label}{next_label}concat=n=2:v=1:a=0[{out_label}]"
            )
            cumulative_s += durs[i]

        prev_label = f"[{out_label}]"
        label_idx += 1

    out = work / "assembled.mp4"
    _run(
        inputs + [
            "-filter_complex", ";".join(filter_parts),
            "-map", prev_label,
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", crf,
            "-pix_fmt", "yuv420p",
            str(out),
        ],
        f"Assemble with {sum(1 for _, xf in segments if xf)} xfade transition(s)"
    )
    return out


def build_slide_video_from_frames(beat_dirs, out_path, cfg):
    """
    Convert Playwright frame sequences to a concatenated video.
    Reads scene.json for transition data automatically.
    Falls back to plain concat if scene.json is absent.
    """
    fps    = cfg["video"]["fps"]
    w      = cfg["video"]["width"]
    h      = cfg["video"]["height"]
    preset = cfg["video"]["preset"]
    crf    = str(cfg["video"]["crf"])
    work   = out_path.parent

    # ── Encode each beat dir to an individual MP4 ───────────────────
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

    # ── Load transitions from scene.json ────────────────────────────
    transitions = ["cut"] * len(beat_videos)  # default: all cuts
    scene_json = _load_scene_json(beat_dirs)
    if scene_json and "beats" in scene_json:
        for i, beat in enumerate(scene_json["beats"]):
            if i < len(transitions):
                transitions[i] = beat.get("transition", "cut") or "cut"
        # Log what we found
        xfade_beats = [
            f"beat {i} ({t})"
            for i, t in enumerate(transitions)
            if t in _XFADE_MAP
        ]
        css_beats = [
            f"beat {i} ({t})"
            for i, t in enumerate(transitions)
            if t in _CSS_TRANSITIONS and t
        ]
        if xfade_beats:
            print(f"[assemble] ffmpeg xfade transitions: {', '.join(xfade_beats)}")
        if css_beats:
            print(f"[assemble] CSS transitions (concat): {', '.join(css_beats)}")
    else:
        print("[assemble] No scene.json found — using plain concat for all beats")

    # ── Assemble with transitions ────────────────────────────────────
    assembled = _build_xfade_chain(beat_videos, transitions, work, cfg)

    # Copy/move to expected output path
    if assembled != out_path:
        import shutil as _shutil
        _shutil.move(str(assembled), str(out_path))

    return out_path


# -----------------------------------------------------------------------
# Stage 2 -- mood-aware BGM picker + audio mix
# -----------------------------------------------------------------------

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
    matches  = [t for t in tracks if any(kw in t.stem.lower() for kw in keywords)]

    if matches:
        track = random.choice(matches)
        print(f"[assemble] BGM (mood='{mood_norm}', {len(matches)} match): {track.name}")
        return track

    track = random.choice(tracks)
    print(f"[assemble] BGM (mood='{mood_norm}' had no filename matches — falling back): {track.name}")
    print(f"[assemble]   tip: rename tracks to include mood keywords like {keywords[:2]}")
    return track


def _voice_duration(wav_path: pathlib.Path) -> float:
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
# Public API  (signature unchanged from v2)
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
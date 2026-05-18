"""
frame_export.py
---------------
Handles PNG frame management and FFmpeg video assembly.

Responsibilities:
  - Validate frame sequence (detect gaps, corruption)
  - Assemble PNG frames into MP4 using FFmpeg
  - Optionally mux an audio track
  - Output formats: MP4 (H.264), WebM (VP9), GIF

Requirements:
    ffmpeg must be available in PATH.
    Install: https://ffmpeg.org/download.html
"""

import subprocess
import sys
import json
from pathlib import Path


class FrameExporter:
    """
    Manages the frame directory and final video assembly.

    Usage:
        exporter = FrameExporter(frames_dir="./output/frames/scene_001", fps=30)
        exporter.validate()
        exporter.assemble("./output/scene_001.mp4")
        exporter.assemble_with_audio("./output/scene_001.mp4", "audio.mp3")
    """

    def __init__(
        self,
        frames_dir:  str,
        fps:         int = 30,
        frame_count: int = 0,
    ):
        self.frames_dir  = Path(frames_dir)
        self.fps         = fps
        self.frame_count = frame_count

    def validate(self) -> dict:
        """
        Check frame sequence for gaps or missing files.
        Returns { ok: bool, total: int, missing: [int], corrupt: [int] }
        """
        if not self.frames_dir.exists():
            return { "ok": False, "error": f"Directory not found: {self.frames_dir}" }

        frames = sorted(self.frames_dir.glob("frame_*.png"))
        total  = len(frames)

        if total == 0:
            return { "ok": False, "error": "No frames found", "total": 0 }

        # Check for sequence gaps
        missing = []
        if self.frame_count > 0:
            present = set()
            for f in frames:
                try:
                    idx = int(f.stem.split("_")[1])
                    present.add(idx)
                except (ValueError, IndexError):
                    pass
            missing = [i for i in range(self.frame_count) if i not in present]

        # Check for zero-size files (corrupt)
        corrupt = [str(f) for f in frames if f.stat().st_size < 100]

        ok = len(missing) == 0 and len(corrupt) == 0
        return {
            "ok":      ok,
            "total":   total,
            "missing": missing,
            "corrupt": corrupt,
        }

    def assemble(
        self,
        output_path:  str,
        crf:          int = 18,      # 0–51, lower = higher quality
        preset:       str = "slow",  # ultrafast, fast, medium, slow
        pixel_format: str = "yuv420p",
    ) -> bool:
        """
        Assemble PNG frames into MP4 using FFmpeg.

        Args:
            output_path   — output .mp4 file path
            crf           — H.264 quality (18 = high quality, 23 = default)
            preset        — encoding speed/quality trade-off
            pixel_format  — yuv420p for maximum compatibility

        Returns True on success.
        """
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)

        frame_pattern = str(self.frames_dir / "frame_%05d.png")

        cmd = [
            "ffmpeg",
            "-y",                              # overwrite output
            "-framerate", str(self.fps),       # input FPS
            "-i", frame_pattern,               # input frame pattern
            "-c:v", "libx264",                 # H.264 encoder
            "-crf", str(crf),                  # quality
            "-preset", preset,                 # encoding preset
            "-pix_fmt", pixel_format,          # pixel format
            "-movflags", "+faststart",         # web streaming optimization
            str(output),
        ]

        return self._run_ffmpeg(cmd, output)

    def assemble_with_audio(
        self,
        output_path:  str,
        audio_path:   str,
        audio_offset: float = 0.0,
        crf:          int   = 18,
    ) -> bool:
        """
        Assemble frames + mux audio track into final MP4.

        Args:
            audio_path    — path to .mp3, .wav, or .aac file
            audio_offset  — delay audio by N seconds (default 0)
        """
        output      = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        frame_pattern = str(self.frames_dir / "frame_%05d.png")

        cmd = [
            "ffmpeg",
            "-y",
            "-framerate", str(self.fps),
            "-i", frame_pattern,
            "-itsoffset", str(audio_offset),
            "-i", audio_path,
            "-c:v", "libx264",
            "-crf", str(crf),
            "-preset", "slow",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",              # end at shorter of video/audio
            "-movflags", "+faststart",
            str(output),
        ]

        return self._run_ffmpeg(cmd, output)

    def assemble_webm(self, output_path: str, crf: int = 32) -> bool:
        """Assemble as WebM (VP9) — smaller file, slower encode."""
        output = Path(output_path)
        frame_pattern = str(self.frames_dir / "frame_%05d.png")

        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(self.fps),
            "-i", frame_pattern,
            "-c:v", "libvpx-vp9",
            "-crf", str(crf),
            "-b:v", "0",
            "-pix_fmt", "yuv420p",
            str(output),
        ]
        return self._run_ffmpeg(cmd, output)

    def assemble_gif(
        self,
        output_path: str,
        scale:       int = 480,     # pixel width of GIF
        fps:         int = None,    # GIF FPS (defaults to self.fps, max 25)
    ) -> bool:
        """Assemble as optimized GIF (palette-based)."""
        output    = Path(output_path)
        gif_fps   = min(fps or self.fps, 25)
        palette   = output.parent / f"{output.stem}_palette.png"
        frame_pattern = str(self.frames_dir / "frame_%05d.png")

        # Step 1: Generate palette
        palette_cmd = [
            "ffmpeg", "-y",
            "-framerate", str(self.fps),
            "-i", frame_pattern,
            "-vf", f"fps={gif_fps},scale={scale}:-1:flags=lanczos,palettegen",
            str(palette),
        ]
        if not self._run_ffmpeg(palette_cmd, palette):
            return False

        # Step 2: Render GIF with palette
        gif_cmd = [
            "ffmpeg", "-y",
            "-framerate", str(self.fps),
            "-i", frame_pattern,
            "-i", str(palette),
            "-lavfi", f"fps={gif_fps},scale={scale}:-1:flags=lanczos[x];[x][1:v]paletteuse",
            str(output),
        ]
        result = self._run_ffmpeg(gif_cmd, output)

        # Clean up palette file
        if palette.exists():
            palette.unlink()

        return result

    def get_stats(self) -> dict:
        """Return frame directory statistics."""
        frames = list(self.frames_dir.glob("frame_*.png"))
        total_size = sum(f.stat().st_size for f in frames)
        return {
            "frame_count":   len(frames),
            "total_size_mb": round(total_size / 1_048_576, 2),
            "avg_size_kb":   round(total_size / max(len(frames), 1) / 1024, 1),
            "fps":           self.fps,
            "duration_s":    round(len(frames) / self.fps, 2),
        }

    def _run_ffmpeg(self, cmd: list, output: Path) -> bool:
        """Run an FFmpeg command. Returns True on success."""
        print(f"[FFmpeg] → {output.name}")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True,
            )
            size_mb = round(output.stat().st_size / 1_048_576, 2)
            print(f"[FFmpeg] ✓ {output.name}  ({size_mb} MB)")
            return True

        except subprocess.CalledProcessError as e:
            print(f"[FFmpeg] ✗ Error assembling {output.name}")
            print(e.stderr[-500:] if e.stderr else "No error output")
            return False

        except FileNotFoundError:
            print("[FFmpeg] ✗ ffmpeg not found. Install from https://ffmpeg.org")
            return False
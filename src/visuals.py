"""
visuals.py  --  Visual renderer bridge (rev.03)

Routes to either:
  HTML renderer  (Node/Playwright)  when use_html_renderer: true in config.yaml
  Pillow renderer (rev.02 static)   otherwise

Migration path: set use_html_renderer: true once renderer/capture.js is running.
"""

import pathlib
import subprocess
import json
import sys
import textwrap
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter


# ---------------------------------------------------------------------------
# HTML renderer bridge
# ---------------------------------------------------------------------------

def _build_beat_contracts(beats: list, beat_durations_ms: list = None) -> list:
    scene_map = {0: "hook", 1: "insight", 2: "insight", 3: "climax", 4: "cta"}
    hud_tags  = {0: "// HOOK", 1: "// PROBLEM", 2: "// TRUTH", 3: "// KEY", 4: "// ACTION"}
    return [
        {
            "id":      i,
            "scene":   scene_map.get(i, "insight"),
            "hud_tag": hud_tags.get(i, "// INSIGHT"),
            "keyword": beat["keyword"],
            "body":    beat["text"],
            "duration_ms": beat_durations_ms[i] if beat_durations_ms else 5000,
            "accent_override": "spike" if i == 3 else None,
        }
        for i, beat in enumerate(beats)
    ]


def render_slides_html(script, out_dir, cfg, beat_durations_ms=None):
    """Call Node/Playwright renderer. Returns list of beat frame directories."""
    renderer_dir = pathlib.Path(__file__).parent.parent / "renderer"
    if not (renderer_dir / "capture.js").exists():
        raise FileNotFoundError(
            f"[visuals] renderer/capture.js not found at {renderer_dir}\n"
            f"Run: cd renderer && npm install"
        )

    palette = cfg.get("palette", {})
    scene_json = {
        "video_id": out_dir.name,
        "theme":    cfg.get("theme", "tech_blue"),
        "fps":      cfg["video"]["fps"],
        "width":    cfg["video"]["width"],
        "height":   cfg["video"]["height"],
        "palette": {
            "accent": palette.get("accent", "oklch(0.78 0.19 230)"),
            "spike":  palette.get("spike",  "oklch(0.78 0.19 30)"),
            "bg":     palette.get("bg",     "oklch(0.12 0.02 250)"),
            "fg":     palette.get("fg",     "oklch(0.97 0.005 250)"),
        },
        "brand": cfg["brand"]["name"],
        "beats": _build_beat_contracts(script["beats"], beat_durations_ms),
    }

    scene_path = out_dir / "scene.json"
    scene_path.write_text(json.dumps(scene_json, indent=2), encoding="utf-8")

    frames_dir = out_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    # Pass absolute paths with forward slashes so Node.js resolve() works
    # correctly regardless of cwd.  Pass PROJECT_ROOT env var so capture.js
    # can resolve any relative paths back to the project root.
    project_root = pathlib.Path(__file__).parent.parent.resolve()

    def _abs(p: pathlib.Path) -> str:
        return str(p.resolve()).replace("\\", "/")

    cmd = [
        "node", str(renderer_dir / "capture.js"),
        "--scene", _abs(scene_path),
        "--out",   _abs(frames_dir),
        "--fps",   str(cfg["video"]["fps"]),
    ]

    env = {**__import__("os").environ, "PROJECT_ROOT": str(project_root)}

    print("[visuals] Running HTML renderer (Playwright)...")
    result = subprocess.run(cmd, cwd=str(renderer_dir), env=env)
    if result.returncode != 0:
        raise RuntimeError("[visuals] HTML renderer failed")

    beat_dirs = sorted(frames_dir.glob("beat_*"))
    print(f"[visuals] HTML render done — {len(beat_dirs)} beat dirs")
    return beat_dirs


# ---------------------------------------------------------------------------
# Pillow renderer (rev.02)  --  fallback when use_html_renderer: false
# ---------------------------------------------------------------------------

class Palette:
    BG     = (14,  15,  20)
    FG     = (245, 245, 248)
    FG_DIM = (140, 142, 150)
    ACCENT = (50,  170, 255)
    SPIKE  = (255, 120,  60)


def _font(font_path, size):
    if font_path.exists():
        try:
            return ImageFont.truetype(str(font_path), size)
        except Exception:
            pass
    for fb in [
        pathlib.Path("C:/Windows/Fonts/arialbd.ttf"),
        pathlib.Path("C:/Windows/Fonts/segoeuib.ttf"),
        pathlib.Path("C:/Windows/Fonts/calibrib.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ]:
        if fb.exists():
            return ImageFont.truetype(str(fb), size)
    return ImageFont.load_default()


def _fit_font(font_path, text, max_w, start_size=200, min_size=48):
    size  = start_size
    fnt   = _font(font_path, size)
    dummy = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    while size > min_size:
        bb = dummy.textbbox((0, 0), text.upper(), font=fnt)
        if bb[2] - bb[0] <= max_w:
            break
        size -= 6
        fnt = _font(font_path, size)
    return fnt


def _to_np(img): return np.array(img.convert("RGB"), dtype=np.float32)
def _to_pil(arr): return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

def _apply_grain(arr, seed, strength=0.045):
    rng = np.random.default_rng(seed)
    return arr + rng.standard_normal(arr.shape).astype(np.float32) * (255 * strength)

def _apply_vignette(arr, strength=0.55, bias_x=0.52, bias_y=0.48):
    h, w = arr.shape[:2]
    xg, yg = np.meshgrid(np.linspace(0, 1, w), np.linspace(0, 1, h))
    dist = np.sqrt(((xg - bias_x) / bias_x) ** 2 + ((yg - bias_y) / bias_y) ** 2)
    return arr * (1.0 - np.clip(dist * strength, 0, 1) ** 1.6)[:, :, np.newaxis]

def _apply_halation(arr, threshold=0.82, sigma=22, gain=0.22):
    lum  = arr.mean(axis=2) / 255.0
    mask = (lum > threshold).astype(np.float32)
    red  = Image.fromarray((arr[:, :, 0] * mask).astype(np.uint8), "L")
    blur = np.array(red.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32)
    result = arr.copy()
    result[:, :, 0] = np.clip(arr[:, :, 0] + blur * gain, 0, 255)
    return result

def _post_process(img, beat_index):
    arr = _to_np(img)
    arr = _apply_grain(arr, seed=beat_index * 137 + 42)
    arr = _apply_vignette(arr)
    arr = _apply_halation(arr)
    return _to_pil(arr)


W, H       = 1080, 1920
SAFE_TOP   = 240
SAFE_BOT   = H - 500
SAFE_H     = SAFE_BOT - SAFE_TOP
LEFT_MG    = 72
RIGHT_MG   = W - 72
_HUD_TAGS  = ["// HOOK", "// PROBLEM", "// TRUTH", "// KEY", "// ACTION"]


def _draw_bg(draw, accent):
    r, g, b = accent
    for radius, alpha in [(900, 8), (600, 12), (360, 16), (200, 14)]:
        draw.ellipse([-radius, H-radius, radius, H+radius], fill=(r, g, b, alpha))
    draw.rectangle([0, 0, 5, H], fill=(r, g, b, 200))

def _draw_hud_tag(draw, tag, accent, font):
    r, g, b = accent
    x, y = LEFT_MG, SAFE_TOP + 28
    bb = draw.textbbox((x, y), tag, font=font)
    draw.rounded_rectangle([bb[0]-14, bb[1]-8, bb[2]+14, bb[3]+8],
                            radius=6, fill=(r, g, b, 22), outline=(r, g, b, 60), width=1)
    draw.text((x, y), tag, font=font, fill=(r, g, b, 180))

def _draw_keyword(draw, text, y, accent, font, is_hook=False):
    r, g, b = accent
    x = LEFT_MG
    off = 5 if is_hook else 3
    draw.text((x+off, y+off), text.upper(), font=font, fill=(0, 0, 0, 160))
    draw.text((x, y), text.upper(), font=font, fill=(*Palette.FG, 255))
    bb = draw.textbbox((x, y), text.upper(), font=font)
    tw, th = bb[2]-bb[0], bb[3]-bb[1]
    bar_y = y + th + 12
    bar_w = min(tw + 40, RIGHT_MG - x)
    draw.rounded_rectangle([x, bar_y, x+bar_w, bar_y+(6 if is_hook else 4)],
                            radius=3, fill=(r, g, b, 255))
    return bar_y + (6 if is_hook else 4)

def _draw_body(draw, text, y, font, max_w=7):
    x = LEFT_MG
    words = text.split()
    lines, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= max_w:
            lines.append(cur); cur = []
    if cur: lines.append(cur)
    for ln in lines:
        t = " ".join(ln)
        draw.text((x+2, y+2), t, font=font, fill=(0, 0, 0, 120))
        draw.text((x, y), t, font=font, fill=(*Palette.FG, 230))
        y += font.size + 18
    return y

def _draw_brand(draw, brand, accent, font):
    r, g, b = accent
    bb = draw.textbbox((0, 0), brand, font=font)
    draw.text((RIGHT_MG-(bb[2]-bb[0]), SAFE_BOT-60), brand, font=font, fill=(r, g, b, 120))

def _draw_bottom_line(draw, accent):
    r, g, b = accent
    draw.rectangle([0, H-3, W, H], fill=(r, g, b, 140))


def _render_slides_pillow(script, out_dir, cfg):
    font_ttf = pathlib.Path(cfg["paths"]["fonts"]) / cfg["paths"]["font_file"]
    brand    = cfg["brand"]["name"]
    accent   = tuple(cfg["slides"].get("accent_colors", [list(Palette.ACCENT)])[0])
    spike    = tuple(cfg["slides"].get("spike_color", list(Palette.SPIKE)))

    fonts = {
        "hero":  _fit_font(font_ttf, "CONSISTENT FEEDBACK", W - LEFT_MG*2, 200, 64),
        "stat":  _fit_font(font_ttf, "CONSISTENT FEEDBACK", W - LEFT_MG*2, 130, 48),
        "body":  _font(font_ttf, 64),
        "hud":   _font(font_ttf, 22),
        "brand": _font(font_ttf, 30),
    }

    beats = script["beats"]
    paths = []

    for i, beat in enumerate(beats):
        acc  = spike if i == 3 else accent
        img  = Image.new("RGBA", (W, H), (*Palette.BG, 255))
        draw = ImageDraw.Draw(img, "RGBA")

        _draw_bg(draw, acc)
        _draw_hud_tag(draw, _HUD_TAGS[i], acc, fonts["hud"])

        if i == 0:   # hook
            bb = draw.textbbox((0, 0), beat["keyword"].upper(), font=fonts["hero"])
            th = bb[3]-bb[1]
            y  = SAFE_TOP + (SAFE_H//2) - th//2 - 60
            _draw_keyword(draw, beat["keyword"], y, acc, fonts["hero"], is_hook=True)
            _draw_body(draw, beat["text"], y+th+80, fonts["body"], 5)
        elif i == len(beats)-1:   # cta
            kw_bot = _draw_keyword(draw, beat["keyword"], SAFE_TOP+int(SAFE_H*0.20), acc, fonts["stat"])
            r, g, b = acc
            dy = kw_bot + 44
            draw.rounded_rectangle([LEFT_MG, dy, LEFT_MG+80, dy+2], radius=1, fill=(r,g,b,90))
            _draw_body(draw, beat["text"], dy+38, fonts["body"], 7)
            cta_y = SAFE_BOT - 160
            draw.rounded_rectangle([LEFT_MG, cta_y, RIGHT_MG, cta_y+100], radius=12,
                                    fill=(r,g,b,30), outline=(r,g,b,80), width=2)
            draw.text((LEFT_MG+28, cta_y+30), "FOLLOW FOR MORE  ↗", font=fonts["hud"], fill=(r,g,b,200))
        else:   # insight / climax
            kw_bot = _draw_keyword(draw, beat["keyword"], SAFE_TOP+int(SAFE_H*0.22), acc, fonts["stat"])
            r, g, b = acc
            dy = kw_bot + 44
            draw.rounded_rectangle([LEFT_MG, dy, LEFT_MG+80, dy+2], radius=1, fill=(r,g,b,90))
            _draw_body(draw, beat["text"], dy+38, fonts["body"], 7)

        _draw_brand(draw, brand, acc, fonts["brand"])
        _draw_bottom_line(draw, acc)

        rgb = _post_process(img.convert("RGB"), beat_index=i)
        out = out_dir / f"slide_{i}.png"
        rgb.save(str(out), "PNG")
        paths.append(out)
        print(f"[visuals] ✓ slide_{i}.png — {beat['keyword']}")

    return paths


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def render_slides(script: dict, out_dir: pathlib.Path, cfg: dict,
                  beat_durations_ms: list = None) -> list[pathlib.Path]:
    """
    Main entry point called by main.py.
    Routes to HTML or Pillow renderer based on config.yaml use_html_renderer flag.
    """
    if cfg.get("use_html_renderer", False):
        return render_slides_html(script, out_dir, cfg, beat_durations_ms)
    return _render_slides_pillow(script, out_dir, cfg)
"""
visuals.py  --  Cinematic slide renderer (rev.02)

Implements the brief from cinematic.engine / rev.02:

  PALETTE     2-hue lock per video: BG neutral + one accent.
              Spike hue used exactly once at the climax beat (beat 4).
              No rainbow rotation.

  COMPOSITION Left-anchored, rule-of-thirds.  NOT centered stacks.
              Top 220px and bottom 480px are TikTok UI dead-zones.
              Critical type lives in the 1080x1220 middle band.

  TYPE SCALE  HERO  240px / line-height 0.86  (hook keyword)
              STAT  130px                      (stat/quote keyword)
              BODY   64px                      (body text)
              HUD    22px mono                 (content tag, NOT beat counter)

  COMPOSITING numpy-based post-processing stack per frame:
              1. film grain (seeded, per-beat)
              2. vignette   (anisotropic -- tighter right)
              3. halation   (red-channel bloom on near-white pixels)
              No LUT (requires external .cube file -- add later).

  NO:         01/05 beat counters
              centered paragraph body text
              rainbow accent rotation
              flat ellipse "glows"
              scanlines
"""

import pathlib
import textwrap
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter


# ---------------------------------------------------------------------------
# Palette  --  2 hues + neutral locked per preset
# ---------------------------------------------------------------------------

class Palette:
    """
    2-hue palette locked for the whole video.
    accent = main hue used on most beats.
    spike  = complementary hue used ONCE at climax beat.
    """
    # BG: near-black cool dark  (matches oklch(.12 .02 250))
    BG       = (14,  15,  20)
    # FG: near-white             (oklch(.96 .005 250))
    FG       = (245, 245, 248)
    FG_DIM   = (140, 142, 150)

    # default accent: electric blue  (oklch(.78 .19 230))
    ACCENT   = (50,  170, 255)
    # spike: coral / amber  (oklch(.78 .19 30)) -- used at beat index 3 only
    SPIKE    = (255, 120,  60)


# ---------------------------------------------------------------------------
# Font loader
# ---------------------------------------------------------------------------

def _font(font_path: pathlib.Path, size: int) -> ImageFont.FreeTypeFont:
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


def _fit_font(font_path: pathlib.Path, text: str, max_w: int,
              start_size: int, min_size: int = 48) -> ImageFont.FreeTypeFont:
    """Return the largest font size where text fits within max_w px."""
    size = start_size
    fnt = _font(font_path, size)
    dummy = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    while size > min_size:
        bb = dummy.textbbox((0, 0), text.upper(), font=fnt)
        if bb[2] - bb[0] <= max_w:
            break
        size -= 6
        fnt = _font(font_path, size)
    return fnt


# ---------------------------------------------------------------------------
# Post-processing stack  (numpy)
# ---------------------------------------------------------------------------

def _to_np(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("RGB"), dtype=np.float32)


def _to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def _apply_grain(arr: np.ndarray, seed: int, strength: float = 0.045) -> np.ndarray:
    """
    Add seeded film grain.  strength=0.045 ~ 35mm fine grain at 18% opacity.
    Using a fixed seed per beat so the grain doesn't flicker on the static slide.
    """
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(arr.shape).astype(np.float32) * (255 * strength)
    return arr + noise


def _apply_vignette(arr: np.ndarray, strength: float = 0.55,
                    bias_x: float = 0.52, bias_y: float = 0.48) -> np.ndarray:
    """
    Anisotropic vignette.  bias_x > 0.5 = tighter right, bias_y < 0.5 = tighter top.
    This biases attention to the left-third where the type lives.
    """
    h, w = arr.shape[:2]
    ys = np.linspace(0, 1, h)
    xs = np.linspace(0, 1, w)
    xg, yg = np.meshgrid(xs, ys)
    dx = (xg - bias_x) / bias_x
    dy = (yg - bias_y) / bias_y
    dist = np.sqrt(dx ** 2 + dy ** 2)
    # smooth falloff
    mask = 1.0 - np.clip(dist * strength, 0, 1) ** 1.6
    mask = mask[:, :, np.newaxis]
    return arr * mask


def _apply_halation(arr: np.ndarray, threshold: float = 0.82,
                    sigma: int = 22, gain: float = 0.22) -> np.ndarray:
    """
    Cheap halation: red-channel bloom on near-white pixels.
    Threshold selects the bright regions; they bleed red outward.
    """
    # isolate highlights
    lum = arr.mean(axis=2) / 255.0
    mask = (lum > threshold).astype(np.float32)

    # red bleed = gaussian of red channel masked to highlights
    red_layer = (arr[:, :, 0] * mask).astype(np.uint8)
    red_pil   = Image.fromarray(red_layer, "L")
    red_blur  = np.array(red_pil.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32)

    result = arr.copy()
    result[:, :, 0] = np.clip(arr[:, :, 0] + red_blur * gain, 0, 255)
    return result


def _post_process(img: Image.Image, beat_index: int) -> Image.Image:
    arr = _to_np(img)
    arr = _apply_grain(arr, seed=beat_index * 137 + 42)
    arr = _apply_vignette(arr)
    arr = _apply_halation(arr)
    return _to_pil(arr)


# ---------------------------------------------------------------------------
# Safe-zone constants  (TikTok 1080x1920)
# ---------------------------------------------------------------------------

W, H          = 1080, 1920
SAFE_TOP      = 240          # TikTok UI obstructs top 220px; add 20px buffer
SAFE_BOT      = H - 500      # TikTok UI obstructs bottom 480px; add 20px buffer
SAFE_H        = SAFE_BOT - SAFE_TOP   # 1180px usable height
LEFT_MARGIN   = 72           # rule-of-thirds left anchor
RIGHT_MARGIN  = W - 72


# ---------------------------------------------------------------------------
# Drawing helpers -- all left-anchored, not centered
# ---------------------------------------------------------------------------

def _draw_bg(draw: ImageDraw.Draw, accent: tuple) -> None:
    """
    Dark background with:
    - subtle radial glow at bottom-left (the composition anchor corner)
    - thin accent bar on left edge
    """
    r, g, b = accent
    # radial gradient approximation: concentric ellipses, low alpha
    for radius, alpha in [(900, 8), (600, 12), (360, 16), (200, 14)]:
        draw.ellipse(
            [-radius, H - radius, radius, H + radius],
            fill=(r, g, b, alpha),
        )
    # left edge bar
    draw.rectangle([0, 0, 5, H], fill=(r, g, b, 200))


def _draw_hud_tag(draw: ImageDraw.Draw, tag: str, accent: tuple,
                  font_hud: ImageFont.FreeTypeFont) -> None:
    """
    Content-referencing HUD tag (NOT beat counter).
    Small monospace tag top-left inside safe zone.
    """
    r, g, b = accent
    x, y = LEFT_MARGIN, SAFE_TOP + 28
    # pill background
    bb = draw.textbbox((x, y), tag, font=font_hud)
    draw.rounded_rectangle(
        [bb[0] - 14, bb[1] - 8, bb[2] + 14, bb[3] + 8],
        radius=6,
        fill=(r, g, b, 22),
        outline=(r, g, b, 60),
        width=1,
    )
    draw.text((x, y), tag, font=font_hud, fill=(r, g, b, 180))


def _draw_keyword(draw: ImageDraw.Draw, text: str, y: int,
                  accent: tuple, font: ImageFont.FreeTypeFont,
                  is_hook: bool = False) -> int:
    """
    Left-anchored keyword.  Returns bottom y of the block.
    - No backing box
    - Accent underline bar that extends beyond the text width
    - At hook beat: extra-large, fills more vertical space
    """
    r, g, b = accent
    text_up = text.upper()

    # left-anchored x position (rule of thirds)
    x = LEFT_MARGIN

    # text with offset shadow
    shadow_off = 5 if is_hook else 3
    draw.text((x + shadow_off, y + shadow_off), text_up, font=font,
              fill=(0, 0, 0, 160))
    draw.text((x, y), text_up, font=font, fill=(*Palette.FG, 255))

    bb = draw.textbbox((x, y), text_up, font=font)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]

    # accent underline -- extends 40px past text on right, stops at margin
    bar_y = y + th + 12
    bar_w = min(tw + 40, RIGHT_MARGIN - x)
    draw.rounded_rectangle(
        [x, bar_y, x + bar_w, bar_y + (6 if is_hook else 4)],
        radius=3,
        fill=(r, g, b, 255),
    )

    return bar_y + (6 if is_hook else 4)


def _draw_body(draw: ImageDraw.Draw, text: str, y: int,
               font: ImageFont.FreeTypeFont,
               accent: tuple, max_words_per_line: int = 7) -> int:
    """
    Left-anchored body text.
    Short lines (max 7 words) -- NOT paragraph wrap.
    Emphasizes the first stressed word per line with accent color.
    Returns bottom y.
    """
    words = text.split()
    lines = []
    current = []
    for w in words:
        current.append(w)
        if len(current) >= max_words_per_line:
            lines.append(current)
            current = []
    if current:
        lines.append(current)

    r, g, b = accent
    x = LEFT_MARGIN
    line_h = font.size + 18

    for li, line_words in enumerate(lines):
        line_text = " ".join(line_words)
        draw.text((x + 2, y + 2), line_text, font=font, fill=(0, 0, 0, 120))
        draw.text((x, y), line_text, font=font, fill=(*Palette.FG, 230))
        y += line_h

    return y


def _draw_brand(draw: ImageDraw.Draw, brand: str, accent: tuple,
                font: ImageFont.FreeTypeFont) -> None:
    """Brand watermark -- bottom right, inside safe zone."""
    r, g, b = accent
    bb = draw.textbbox((0, 0), brand, font=font)
    bw = bb[2] - bb[0]
    draw.text(
        (RIGHT_MARGIN - bw, SAFE_BOT - 60),
        brand, font=font,
        fill=(r, g, b, 120),
    )


def _draw_bottom_accent_line(draw: ImageDraw.Draw, accent: tuple) -> None:
    """2px accent line at very bottom of frame."""
    r, g, b = accent
    draw.rectangle([0, H - 3, W, H], fill=(r, g, b, 140))


# ---------------------------------------------------------------------------
# Scene templates
# ---------------------------------------------------------------------------

def _scene_hook(draw, beat, accent, fonts, brand):
    """
    HOOK scene (beat 0):
    Single 1-3 word punch in massive type.
    Left-anchored, vertically centered in safe zone.
    """
    _draw_bg(draw, accent)
    _draw_hud_tag(draw, "// HOOK", accent, fonts["hud"])

    # keyword at hero size (240px class) -- vertically centered
    kw = beat["keyword"].upper()
    bb = draw.textbbox((0, 0), kw, font=fonts["hero"])
    th = bb[3] - bb[1]
    y_kw = SAFE_TOP + (SAFE_H // 2) - th // 2 - 60
    _draw_keyword(draw, beat["keyword"], y_kw, accent, fonts["hero"], is_hook=True)

    # body: 1-2 words per line, large, below keyword
    body_y = y_kw + th + 80
    _draw_body(draw, beat["text"], body_y, fonts["body"], accent, max_words_per_line=5)
    _draw_brand(draw, brand, accent, fonts["brand"])
    _draw_bottom_accent_line(draw, accent)


def _scene_default(draw, beat, accent, fonts, brand, hud_tag: str = "// INSIGHT"):
    """
    Default scene (beats 1-3):
    Keyword in STAT size (130px), body below.
    Left-anchored.
    """
    _draw_bg(draw, accent)
    _draw_hud_tag(draw, hud_tag, accent, fonts["hud"])

    # keyword positioned at ~38% of safe zone height
    kw_y = SAFE_TOP + int(SAFE_H * 0.22)
    kw_bottom = _draw_keyword(draw, beat["keyword"], kw_y, accent,
                               fonts["stat"], is_hook=False)

    # short divider
    r, g, b = accent
    div_y = kw_bottom + 44
    draw.rounded_rectangle(
        [LEFT_MARGIN, div_y, LEFT_MARGIN + 80, div_y + 2],
        radius=1,
        fill=(r, g, b, 90),
    )

    # body text below divider
    body_y = div_y + 38
    _draw_body(draw, beat["text"], body_y, fonts["body"], accent, max_words_per_line=7)
    _draw_brand(draw, brand, accent, fonts["brand"])
    _draw_bottom_accent_line(draw, accent)


def _scene_climax(draw, beat, accent, spike, fonts, brand):
    """
    CLIMAX scene (beat 3):
    Uses the SPIKE hue instead of accent.
    Keyword at hero size, centered vertically higher (more dramatic).
    """
    _draw_bg(draw, spike)
    _draw_hud_tag(draw, "// KEY", spike, fonts["hud"])

    # keyword at hero size with spike color
    kw_y = SAFE_TOP + int(SAFE_H * 0.28)
    kw_bottom = _draw_keyword(draw, beat["keyword"], kw_y, spike,
                               fonts["hero"], is_hook=True)

    body_y = kw_bottom + 60
    _draw_body(draw, beat["text"], body_y, fonts["body"], spike, max_words_per_line=6)
    _draw_brand(draw, brand, spike, fonts["brand"])
    _draw_bottom_accent_line(draw, spike)


def _scene_cta(draw, beat, accent, fonts, brand):
    """
    CTA scene (beat 4):
    Keyword + CTA band at bottom of safe zone.
    """
    _draw_bg(draw, accent)
    _draw_hud_tag(draw, "// ACTION", accent, fonts["hud"])

    kw_y = SAFE_TOP + int(SAFE_H * 0.20)
    kw_bottom = _draw_keyword(draw, beat["keyword"], kw_y, accent,
                               fonts["stat"], is_hook=False)

    body_y = kw_bottom + 52
    _draw_body(draw, beat["text"], body_y, fonts["body"], accent, max_words_per_line=7)

    # CTA band -- bottom of safe zone
    r, g, b = accent
    cta_y = SAFE_BOT - 160
    draw.rounded_rectangle(
        [LEFT_MARGIN, cta_y, RIGHT_MARGIN, cta_y + 100],
        radius=12,
        fill=(r, g, b, 30),
        outline=(r, g, b, 80),
        width=2,
    )
    cta_text = "FOLLOW FOR MORE  ↗"
    cta_bb = draw.textbbox((0, 0), cta_text, font=fonts["hud"])
    cta_w = cta_bb[2] - cta_bb[0]
    cta_h = cta_bb[3] - cta_bb[1]
    cta_x = LEFT_MARGIN + 28
    draw.text((cta_x, cta_y + (100 - cta_h) // 2), cta_text,
              font=fonts["hud"], fill=(r, g, b, 200))

    _draw_brand(draw, brand, accent, fonts["brand"])
    _draw_bottom_accent_line(draw, accent)


# ---------------------------------------------------------------------------
# HUD tag helpers  --  content-driven, NOT playback counters
# ---------------------------------------------------------------------------

_HUD_TAGS = [
    "// HOOK",
    "// PROBLEM",
    "// TRUTH",
    "// KEY",       # climax -- spike beat
    "// ACTION",
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def render_slides(script: dict, out_dir: pathlib.Path, cfg: dict) -> list[pathlib.Path]:
    """
    Render one slide PNG per beat using the cinematic engine design.
    Returns [slide_0.png, slide_1.png, ...]
    """
    font_ttf = pathlib.Path(cfg["paths"]["fonts"]) / cfg["paths"]["font_file"]
    brand    = cfg["brand"]["name"]

    # palette: read from config or fall back to defaults
    acc_cfg   = cfg["slides"].get("accent_colors", [list(Palette.ACCENT)])
    spike_cfg = cfg["slides"].get("spike_color",   list(Palette.SPIKE))
    accent    = tuple(acc_cfg[0])     # single accent hue for whole video
    spike     = tuple(spike_cfg)

    # font set
    fonts = {
        "hero":  _fit_font(font_ttf, "CONSISTENT FEEDBACK", W - LEFT_MARGIN * 2,
                           start_size=200, min_size=64),
        "stat":  _fit_font(font_ttf, "CONSISTENT FEEDBACK", W - LEFT_MARGIN * 2,
                           start_size=130, min_size=48),
        "body":  _font(font_ttf, 64),
        "hud":   _font(font_ttf, 22),
        "brand": _font(font_ttf, 30),
    }

    beats = script["beats"]
    paths = []

    for i, beat in enumerate(beats):
        img  = Image.new("RGBA", (W, H), (*Palette.BG, 255))
        draw = ImageDraw.Draw(img, "RGBA")

        # pick scene template by position
        if i == 0:
            _scene_hook(draw, beat, accent, fonts, brand)
        elif i == 3:
            _scene_climax(draw, beat, accent, spike, fonts, brand)
        elif i == len(beats) - 1:
            _scene_cta(draw, beat, accent, fonts, brand)
        else:
            _scene_default(draw, beat, accent, fonts, brand, _HUD_TAGS[i])

        # convert to RGB before post-processing
        rgb = img.convert("RGB")

        # post-processing: grain -> vignette -> halation
        rgb = _post_process(rgb, beat_index=i)

        out = out_dir / f"slide_{i}.png"
        rgb.save(str(out), "PNG")
        paths.append(out)
        print(f"[visuals] ✓ slide_{i}.png — {beat['keyword']}")

    return paths
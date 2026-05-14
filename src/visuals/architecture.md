# Cinematic Engine — HTML Renderer Architecture
## rev.03 · replacing Pillow with a browser-based frame pipeline

---

## 1. Why HTML/CSS/JS over Pillow

| Pillow renderer | HTML renderer |
|---|---|
| Static PNGs — no motion | CSS animations run at 60fps |
| Grain/vignette via numpy ops | Native CSS blend modes, SVG filters |
| Font layout via textbbox math | Browser renders text perfectly |
| New scene = rewrite Python | New scene = new HTML component |
| No GPU | Chromium uses GPU compositing |
| Hard to theme | CSS variables = instant theme swap |
| 30 LOC per visual effect | 3 LOC of CSS |

The browser is a production-grade compositing engine. Playwright captures it
frame-accurately. This is how motion graphics studios work at scale.

---

## 2. Architecture overview

```
Python backend (existing)          Node renderer (new)
─────────────────────────          ────────────────────────────────
main.py                            renderer/
  llm.py      → script.json   →     server.js          # HTTP API
  tts.py      → voice.wav           scenes/
  captions.py → captions.ass          hook.html
  assemble.py ←── frames/            insight.html
                                      climax.html
                                      cta.html
                                    themes/
                                      tech_blue.css
                                      cyber_noir.css
                                    capture.js         # Playwright
                                    export.js          # FFmpeg wrap
```

Python calls `renderer/capture.js` via subprocess (or HTTP).
The renderer outputs a sequence of PNG frames.
FFmpeg assembles frames + audio → final.mp4 (unchanged pipeline).

---

## 3. Folder structure

```
renderer/
├── package.json
├── server.js              # Express API: POST /render → frames[]
├── capture.js             # Playwright capture CLI
├── export.js              # FFmpeg frame → mp4 helper
│
├── scenes/                # One HTML file per scene type
│   ├── _base.html         # shared boilerplate + CSS vars
│   ├── hook.html          # massive punch word, kinetic entry
│   ├── insight.html       # stat-size keyword + body
│   ├── climax.html        # spike hue, hero size, dramatic
│   └── cta.html           # keyword + follow band
│
├── themes/                # CSS variable overrides per preset
│   ├── tech_blue.css      # default: electric blue accent
│   ├── cyber_noir.css     # purple/green
│   ├── warm_amber.css     # amber/coral
│   └── _theme_base.css    # invariant tokens
│
├── components/            # Reusable HTML partials (via JS inject)
│   ├── grain.html         # SVG feTurbulence grain overlay
│   ├── vignette.html      # radial-gradient vignette div
│   ├── hud-tag.html       # // HOOK tag pill
│   └── caption-band.html  # word-level caption bar
│
├── motion/                # CSS @keyframes libraries
│   ├── entries.css        # wordIn, wordPunch, lineIn, glitchIn
│   ├── camera.css         # kenBurns, parallaxSlow, parallaxMid
│   └── overlays.css       # grain, bloomPulse, gridDrift
│
└── lib/
    ├── timing.js          # deterministic animation clock
    ├── inject.js          # template variable substitution
    └── schema.js          # JSON contract validator
```

---

## 4. JSON scene contract

```json
{
  "video_id": "cf057624",
  "theme": "tech_blue",
  "fps": 30,
  "width": 1080,
  "height": 1920,

  "palette": {
    "accent": "oklch(0.78 0.19 230)",
    "spike":  "oklch(0.78 0.19 30)",
    "bg":     "oklch(0.12 0.02 250)",
    "fg":     "oklch(0.97 0.005 250)"
  },

  "brand": "TechBytes",

  "beats": [
    {
      "id": 0,
      "scene": "hook",
      "hud_tag": "// HOOK",
      "keyword": "CODE FRUSTRATION",
      "body": "You're the hired gun but it's not your passion.",
      "duration_ms": 4700,
      "accent_override": null
    },
    {
      "id": 1,
      "scene": "insight",
      "hud_tag": "// PROBLEM",
      "keyword": "LACK OF FREEDOM",
      "body": "Your creative control is strangled by micromanaging.",
      "duration_ms": 5000,
      "accent_override": null
    },
    {
      "id": 2,
      "scene": "insight",
      "hud_tag": "// TRUTH",
      "keyword": "NO CLEAR GOAL",
      "body": "Building without purpose leaves you empty.",
      "duration_ms": 6200,
      "accent_override": null
    },
    {
      "id": 3,
      "scene": "climax",
      "hud_tag": "// KEY",
      "keyword": "INCONSISTENT FEEDBACK",
      "body": "Broken loops cause frustration and demotivation.",
      "duration_ms": 7600,
      "accent_override": "spike"
    },
    {
      "id": 4,
      "scene": "cta",
      "hud_tag": "// ACTION",
      "keyword": "TAKE BACK CONTROL",
      "body": "Don't let burnout win. Take control of your career now.",
      "duration_ms": 6200,
      "accent_override": null
    }
  ]
}
```

---

## 5. Rendering pipeline

```
Python: generate scene.json
          ↓
Node: POST /render { scene_json }
          ↓
  For each beat:
    1. Load scene HTML template
    2. Inject CSS vars from palette
    3. Inject beat data (keyword, body, hud_tag)
    4. Open in Playwright headless Chromium (1080×1920)
    5. Seek animation to t=0
    6. Capture N frames at 1000/fps ms intervals
    7. Write frame_BEAT_FRAME.png to frames/
          ↓
Python: FFmpeg
  - concat frames → scene video segments
  - apply zoompan Ken Burns per segment
  - overlay captions.ass
  - mix voice + BGM
  - encode final.mp4
```

---

## 6. Animation timing system

Deterministic rendering requires that CSS animations produce identical frames
for the same timestamp every time. Two strategies:

### Strategy A — paused + seek (recommended)
```javascript
// In capture.js
await page.addStyleTag({ content: `
  *, *::before, *::after {
    animation-play-state: paused !important;
  }
` });

// For each frame N at fps=30:
const t_ms = (N / fps) * 1000;
await page.evaluate((t) => {
  document.getAnimations().forEach(a => {
    a.currentTime = t;
  });
}, t_ms);

await page.screenshot({ path: `frame_${N.toString().padStart(5,'0')}.png` });
```

This gives frame-perfect determinism. Same input → identical PNG every time.

### Strategy B — CSS custom property clock
Set `--t: Xms` via JS and use `animation-delay: calc(-1 * var(--t))` on all
animations. Slightly more setup but works even with complex keyframe chains.

---

## 7. Theme system

Each theme is a CSS file that overrides the root variables:

```css
/* themes/cyber_noir.css */
:root {
  --acc:   oklch(0.72 0.22 290);   /* electric purple */
  --spike: oklch(0.78 0.20 140);   /* acid green */
  --bg:    oklch(0.08 0.01 250);   /* deeper black */
}
```

Applied at render time by injecting the theme CSS after `_theme_base.css`.
Switching themes = one line change in the JSON contract.

---

## 8. Migration plan from Pillow

### Keep conceptually
- Scene type mapping (hook / insight / climax / cta)
- 2-hue palette lock (accent + spike)
- Safe zone constants (SAFE_TOP=240, SAFE_BOT=H-480)
- Left-anchored composition
- HUD content tags (not beat counters)
- Post-processing intent (grain, vignette, halation)

### Discard entirely
- All PIL `ImageDraw` calls
- numpy grain/vignette/halation (replace with CSS/SVG)
- `_fit_font()` / manual textbbox math (browser handles this)
- `_resize_font()` logic (CSS `font-size: clamp()` replaces it)
- `_shadow_text()` (CSS `text-shadow` replaces it)

### Migration sequence
1. Keep `visuals.py` running — it still generates fallback PNGs
2. Build `renderer/` alongside it
3. Add `USE_HTML_RENDERER=true` flag in config.yaml
4. When flag is true, `visuals.py` calls `renderer/capture.js` instead of PIL
5. Once stable, delete the PIL path

---

## 9. Docker strategy

```dockerfile
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /app

# Python deps
COPY requirements.txt .
RUN pip install -r requirements.txt --break-system-packages

# Node renderer
COPY renderer/package.json renderer/
RUN cd renderer && npm install

# Playwright browsers (Chromium already in base image)
RUN cd renderer && npx playwright install chromium

COPY . .
```

One container, both runtimes. Chromium in the base image means no download
at runtime. GPU: add `--gpus all` to `docker run` and set
`--enable-gpu` in Playwright launch args.

---

## 10. Performance bottlenecks + caching

| Bottleneck | Fix |
|---|---|
| Playwright launch per beat (1-2s) | Launch once, reuse browser context across beats |
| Font load per page | Preload fonts in `_base.html`; they cache in browser |
| Screenshot is CPU-bound | Run 4 Playwright workers in parallel (4 beats at once) |
| Frame PNG write to disk | Write to tmpfs / RAM disk in Docker |
| FFmpeg concat of 900 PNGs (30fps × 30s) | Use `rawvideo` pipe instead of PNG files |

Target: 5-beat video at 30fps = ~900 frames total.
With browser reuse + parallel workers: ~8-12s render time.

---

## 11. GPU acceleration

```javascript
// capture.js — Playwright launch args
const browser = await chromium.launch({
  args: [
    '--enable-gpu',
    '--enable-accelerated-2d-canvas',
    '--enable-accelerated-video-decode',
    '--use-gl=egl',              // EGL for headless GPU
    '--disable-software-rasterizer',
  ]
});
```

In Docker with NVIDIA: `docker run --gpus all --env DISPLAY=:99`.
CSS blur filters (used for bloom/halation) are GPU-accelerated by default
in Chromium — this is the main win vs Pillow's CPU gaussian.

---

## 12. Future scalability

- **Audio-reactive**: pipe RMS values per frame into scene JSON;
  CSS custom property `--rms` drives `scale()` or `opacity` on elements.
- **3D parallax**: use CSS `perspective` + `translateZ` on depth layers.
  No Three.js needed for subtle effects.
- **AI-generated plates**: SDXL generates a BG image; inject as `background-image`
  in the scene template. Cached by content hash.
- **Animated BG video**: `<video>` element as BG layer, muted, looped.
  Playwright captures it frame-by-frame correctly.
- **60fps**: change `fps: 30` to `fps: 60` in JSON. Capture loop doubles.
  No code changes.
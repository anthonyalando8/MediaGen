/**
 * capture.js  --  Playwright frame capture for cinematic renderer
 *
 * Usage:
 *   node capture.js --scene scene.json --out frames/ --fps 30
 *
 * Reads scene.json (the full 5-beat contract), renders each beat as a
 * sequence of PNG frames, writes to out/beat_N/frame_FFFFF.png.
 *
 * Determinism:  all CSS animations are paused immediately on page load,
 * then seeked to exact milliseconds per frame — same input = same output.
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { parseArgs } from 'util';

// ── CLI args ────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    scene: { type: 'string' },
    out:   { type: 'string', default: 'frames' },
    fps:   { type: 'string', default: '30' },
    beats: { type: 'string' },   // optional: "0,2,4" to render subset
  }
});

if (!args.scene) {
  console.error('Usage: node capture.js --scene scene.json --out frames/ --fps 30');
  process.exit(1);
}

// resolve() on Windows uses cwd as base, which is renderer/ when called
// from Python with cwd=renderer_dir.  We need absolute paths.
// If the path is already absolute (starts with drive letter or /), use as-is.
// Otherwise resolve relative to the CALLER's cwd (process.env.INIT_CWD or
// the path passed in).  Simplest fix: Python always passes absolute paths.
function toAbs(p) {
  // already absolute on Windows (C:\...) or POSIX (/...)
  if (/^([A-Za-z]:[/\\]|\/)/.test(p)) return p;
  // relative: resolve from the initial working directory (project root)
  const base = process.env.PROJECT_ROOT || process.cwd();
  return join(base, p);
}

const scenePath  = toAbs(args.scene);
const sceneJson  = JSON.parse(readFileSync(scenePath, 'utf8'));
const outDir     = toAbs(args.out);
const fps        = parseInt(args.fps, 10);
const beatFilter = args.beats ? args.beats.split(',').map(Number) : null;

console.log('[capture] scene:', scenePath);
console.log('[capture] out:  ', outDir);

mkdirSync(outDir, { recursive: true });

// ── Load scene templates ─────────────────────────────────────────────────────
// On Windows, import.meta.url gives file:///D:/path so pathname = /D:/path
// (leading slash before drive letter). fileURLToPath handles this correctly.
import { fileURLToPath } from 'url';
const __dir = fileURLToPath(new URL('.', import.meta.url));

function loadTemplate(sceneName) {
  const base   = readFileSync(join(__dir, 'scenes/_base.html'), 'utf8');
  const scene  = readFileSync(join(__dir, `scenes/${sceneName}.html`), 'utf8');
  return base.replace('{{SCENE_CONTENT}}', scene);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function injectVariables(html, beat, palette, brand) {
  const layout = beat.layout || sceneJson.layout || 'left';

  // CSS vars block — injected before </head>
  const cssVars = [
    '<style id="palette-inject">',
    ':root {',
    '  --acc:      ' + palette.accent + ';',
    '  --spike:    ' + palette.spike + ';',
    '  --bg:       ' + palette.bg + ';',
    '  --fg:       ' + palette.fg + ';',
    '  --beat-dur: ' + beat.duration_ms + 'ms;',
    '}',
    '</style>',
  ].join('\n');

  // Beat data for inject.js — must escape </script> inside JSON
  const beatJson = JSON.stringify(beat).replace(/<\/script>/gi, '<\\/script>');
  const beatScript = '<script id="beat-data">window.__BEAT__ = ' + beatJson + ';</scri' + 'pt>';

  // Anchor injection before </head> — works whether or not preconnect exists
  html = html.replace('</head>', cssVars + '\n' + beatScript + '\n</head>');

  // Text content replacements
  const replacements = {
    '{{KEYWORD}}': escapeHtml(beat.keyword),
    '{{BODY}}':    escapeHtml(beat.body),
    '{{HUD_TAG}}': escapeHtml(beat.hud_tag),
    '{{BRAND}}':   escapeHtml(brand),
    '{{LAYOUT}}':  layout,
  };
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll(token, value);
  }

  // Fix UTF-8 mojibake from Ollama output
  const mojibake = [
    ['\u00e2\u0080\u0093', '\u2014'],
    ['\u00e2\u0080\u0098', '\u2018'],
    ['\u00e2\u0080\u0099', '\u2019'],
    ['\u00e2\u0080\u009c', '\u201c'],
    ['\u00e2\u0080\u009d', '\u201d'],
    ['\u00e2\u0080\u00a6', '\u2026'],
    ['\u00c3\u00a9', '\u00e9'],
    ['\u00c3\u00a0', '\u00e0'],
  ];
  for (const [bad, good] of mojibake) {
    html = html.split(bad).join(good);
  }

  return html;
}

// ── Playwright helpers ───────────────────────────────────────────────────────

/** Pause all animations immediately on load, before first paint. */
const PAUSE_SCRIPT = `
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation-play-state: paused !important; }';
    document.head.appendChild(style);
  }, { once: true });
`;

/**
 * Seek all Web Animations API animations to t_ms.
 * Works for CSS animations because Chromium exposes them via getAnimations().
 */
async function seekAnimations(page, t_ms) {
  await page.evaluate((t) => {
    document.getAnimations().forEach(anim => {
      anim.currentTime = t;
    });
  }, t_ms);
}

// ── Main render loop ─────────────────────────────────────────────────────────

async function renderBeat(browser, beat, beatIdx, palette, brand) {
  const beatOutDir = join(outDir, `beat_${beatIdx}`);
  mkdirSync(beatOutDir, { recursive: true });

  const html = injectVariables(
    loadTemplate(beat.scene),
    beat, palette, brand
  );

  // Write the HTML to a temp file (file:// is more reliable than data: URLs
  // for complex CSS with fonts)
  const tmpHtml = join(beatOutDir, '_scene.html');
  writeFileSync(tmpHtml, html, 'utf8');

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });

  // Inject the pause script before page load
  await context.addInitScript(PAUSE_SCRIPT);

  const page = await context.newPage();
  // domcontentloaded is instant for local file:// pages.
  // networkidle was waiting 500ms+ for Google Fonts to timeout (or load) — removed.
  await page.goto(`file://${tmpHtml}`, { waitUntil: 'domcontentloaded' });

  // Brief wait for @font-face to apply from local file
  await page.waitForTimeout(80);

  // Add a 380ms silence gap at the end of every beat except the last,
  // matching the gap_s=0.38 in assemble.py's build_slide_video_from_frames.
  // This prevents the video from cutting off before the narration ends.
  const isLastBeat   = beatIdx === sceneJson.beats.length - 1;
  const gap_ms       = isLastBeat ? 0 : 380;
  const duration_ms  = beat.duration_ms + gap_ms;
  const frame_count  = Math.ceil((duration_ms / 1000) * fps);
  const frame_ms     = 1000 / fps;

  console.log(`[capture] Beat ${beatIdx} "${beat.keyword}" — ${frame_count} frames @ ${fps}fps`);

  // Seek frame 0 to 80ms (not 0ms) so CSS animations have already begun.
  // At t=0 all elements are at opacity:0 (their animation start state),
  // producing black frames until the first delay passes.
  // 80ms puts us past the label reveal delay so at least one element
  // is visible on the very first captured frame.
  const TIME_OFFSET_MS = 80;

  for (let f = 0; f < frame_count; f++) {
    const t_ms = (f * frame_ms) + TIME_OFFSET_MS;
    await seekAnimations(page, t_ms);

    const framePath = join(beatOutDir, `frame_${String(f).padStart(5, '0')}.png`);
    await page.screenshot({
      path: framePath,
      clip: { x: 0, y: 0, width: 1080, height: 1920 },
    });
  }

  await context.close();
  console.log(`[capture] Beat ${beatIdx} done → ${beatOutDir}`);
  return { beatIdx, frameCount: frame_count, dir: beatOutDir };
}

async function main() {
  let browser = await chromium.launch({
    // --use-gl=egl is Linux-only and crashes Chromium on Windows.
    // --disable-gpu is the safe headless default for Windows.
    // Screenshots work correctly without GPU acceleration.
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const { palette, brand, beats } = sceneJson;
  const results = [];

  for (let i = 0; i < beats.length; i++) {
    if (beatFilter && !beatFilter.includes(i)) continue;

    // Retry up to 2 times per beat. On Windows, Chromium can fail with
    // "Unable to capture screenshot" after resource exhaustion or a GPU
    // process crash. Closing and relaunching the browser clears the state.
    let result = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        result = await renderBeat(browser, beats[i], i, palette, brand);
        break;  // success
      } catch (err) {
        lastErr = err;
        console.error(`[capture] Beat ${i} attempt ${attempt} failed: ${err.message}`);
        if (attempt < 2) {
          console.log('[capture] Restarting browser...');
          try { await browser.close(); } catch (_) {}
          browser = await chromium.launch({
            args: [
              '--disable-gpu',
              '--disable-dev-shm-usage',
              '--no-sandbox',
              '--disable-setuid-sandbox',
            ],
          });
        }
      }
    }
    if (!result) throw lastErr;
    results.push(result);
  }

  await browser.close();

  // Write a manifest for FFmpeg assembly
  const manifest = {
    fps,
    beats: results.map(r => ({ beatIdx: r.beatIdx, frameCount: r.frameCount, dir: r.dir })),
  };
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[capture] Manifest → ${manifestPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
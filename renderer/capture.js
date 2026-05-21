/**
 * capture.js  --  Playwright frame capture for cinematic renderer
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { parseArgs } from 'util';

const { values: args } = parseArgs({
  options: {
    scene: { type: 'string' },
    out:   { type: 'string', default: 'frames' },
    fps:   { type: 'string', default: '30' },
    beats: { type: 'string' },
  }
});

if (!args.scene) {
  console.error('Usage: node capture.js --scene scene.json --out frames/ --fps 30');
  process.exit(1);
}

function toAbs(p) {
  if (/^([A-Za-z]:[/\\]|\/)/.test(p)) return p;
  const base = process.env.PROJECT_ROOT || process.cwd();
  return join(base, p);
}

const scenePath  = toAbs(args.scene);
const sceneJson  = JSON.parse(readFileSync(scenePath, 'utf8'));
const outDir     = toAbs(args.out);
const fps        = parseInt(args.fps, 10);
const beatFilter = args.beats ? args.beats.split(',').map(Number) : null;

// ── Unsplash ─────────────────────────────────────────────────────────────────
// Uses the Access Key (UNSPLASH_API_KEY), not the secret.
// Set in environment: UNSPLASH_API_KEY=your_access_key
const UNSPLASH_KEY = process.env.UNSPLASH_API_KEY || '';

/**
 * Fetch a single contextual image URL from Unsplash for a beat.
 *
 * Uses the /photos/random endpoint with portrait orientation so images
 * are vertical — closer to 9:16 than landscape shots.
 *
 * Returns the `urls.regular` URL (1080px wide) or null on any failure.
 * Never throws — a missing image is a degraded experience, not a crash.
 */
async function fetchUnsplashUrl(query) {
  if (!UNSPLASH_KEY) {
    console.warn('[capture] UNSPLASH_API_KEY not set — skipping all background images');
    return null;
  }
  if (!query) {
    console.log(`[capture] Beat has no visual_query — skipping image`);
    return null;
  }

  const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=portrait&content_filter=high&client_id=${UNSPLASH_KEY}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept-Version': 'v1' },
      signal: AbortSignal.timeout(6000),   // 6s hard timeout — never stall render
    });

    if (!res.ok) {
      console.warn(`[capture] Unsplash ${res.status} for "${query}" — skipping`);
      return null;
    }

    const data = await res.json();
    const imageUrl = data?.urls?.regular;

    if (!imageUrl) {
      console.warn(`[capture] Unsplash returned no URL for "${query}"`);
      return null;
    }

    // Log attribution — Unsplash API guidelines require it
    const credit = data?.user?.name || 'unknown';
    console.log(`[capture] ✓ Image fetched: "${query}" → ${credit}`);
    console.log(`[capture]   URL: ${imageUrl.slice(0, 80)}…`);
    return imageUrl;

  } catch (err) {
    console.warn(`[capture] Unsplash fetch failed for "${query}": ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log('[capture] scene:', scenePath);
console.log('[capture] out:  ', outDir);

mkdirSync(outDir, { recursive: true });

import { fileURLToPath } from 'url';
const __dir = fileURLToPath(new URL('.', import.meta.url));

function loadTemplate(sceneName) {
  const base  = readFileSync(join(__dir, 'scenes/_base.html'), 'utf8');
  const scene = readFileSync(join(__dir, `scenes/${sceneName}.html`), 'utf8');
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

function wrapKeywordWords(keyword) {
  if (!keyword) return '';
  return keyword
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `<span class="kw-word">${escapeHtml(w)}</span>`)
    .join(' ');
}

function wrapBodyLines(body) {
  if (!body) return '';

  const raw = body.split(/(?<=[.!?])\s+/).filter(Boolean);

  if (raw.length <= 1 || raw.length > 3) {
    return `<span class="body-line">${escapeHtml(body)}</span>`;
  }

  const merged = [];
  for (const sentence of raw) {
    const wordCount = sentence.trim().split(/\s+/).length;
    if (wordCount < 4 && merged.length > 0) {
      merged[merged.length - 1] += ' ' + sentence;
    } else {
      merged.push(sentence);
    }
  }

  return merged
    .map(line => `<span class="body-line">${escapeHtml(line.trim())}</span>`)
    .join('');
}

/**
 * injectVariables — same as before plus one new CSS var: --bg-image.
 *
 * imageUrl is the Unsplash URL string, or null.
 * When null, --bg-image is set to 'none' so the .scene-bg-image div
 * in _base.html renders as invisible — no visual change.
 */
function injectVariables(html, beat, palette, brand, imageUrl) {
  const layout   = beat.layout || sceneJson.layout || 'left';
  const camDur   = ((beat.duration_ms || 5000) / 1000).toFixed(2) + 's';
  const beatIdx  = String(beat.beat_index  || '').padStart(2, '0');
  const beatTot  = String(beat.beat_total  || '').padStart(2, '0');

  // Escape URL for CSS — parentheses and quotes need escaping inside url()
  const bgImageValue = imageUrl
    ? `url("${imageUrl.replace(/"/g, '%22')}")`
    : 'none';

  // CSS vars — --bg-image added so _base.html .scene-bg-image can read it
  const cssVars = [
    '<style id="palette-inject">',
    ':root {',
    '  --acc:      ' + palette.accent + ';',
    '  --spike:    ' + palette.spike  + ';',
    '  --bg:       ' + palette.bg     + ';',
    '  --fg:       ' + palette.fg     + ';',
    '  --beat-dur: ' + beat.duration_ms + 'ms;',
    '  --cam-dur:  ' + camDur + ';',
    '  --bg-image: ' + bgImageValue + ';',
    '}',
    '</style>',
  ].join('\n');

  const beatJson   = JSON.stringify(beat).replace(/<\/script>/gi, '<\\/script>');
  const beatScript = '<script id="beat-data">window.__BEAT__ = ' + beatJson + ';</scri' + 'pt>';
  const themeLink  = '<link rel="stylesheet" href="../themes/' + sceneJson.theme + '.css">';

  html = html.replace('</head>', themeLink + '\n' + cssVars + '\n' + beatScript + '\n</head>');

  const replacements = {
    '{{KEYWORD}}':    wrapKeywordWords(beat.keyword),
    '{{BODY}}':       wrapBodyLines(beat.body),
    '{{HUD_TAG}}':    escapeHtml(beat.hud_tag),
    '{{BRAND}}':      escapeHtml(brand),
    '{{LAYOUT}}':     layout,
    '{{BEAT_INDEX}}': beatIdx,
    '{{BEAT_TOTAL}}': beatTot,
  };
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll(token, value);
  }

  // Fix UTF-8 mojibake
  const mojibake = [
    ['\u00e2\u0080\u0093', '\u2014'],
    ['\u00e2\u0080\u0098', '\u2018'],
    ['\u00e2\u0080\u0099', '\u2019'],
    ['\u00e2\u0080\u009c', '\u201c'],
    ['\u00e2\u0080\u009d', '\u201d'],
    ['\u00e2\u0080\u00a6', '\u2026'],
    ['\u00c3\u00a9',       '\u00e9'],
    ['\u00c3\u00a0',       '\u00e0'],
  ];
  for (const [bad, good] of mojibake) {
    html = html.split(bad).join(good);
  }

  return html;
}

const PAUSE_SCRIPT = `
  document.addEventListener('DOMContentLoaded', () => {
    // Pause all animations for frame-seek rendering
    const pauseStyle = document.createElement('style');
    pauseStyle.textContent = '*, *::before, *::after { animation-play-state: paused !important; }';
    document.head.appendChild(pauseStyle);

    // Apply Unsplash image directly as .scene background.
    // Multi-layer: scrim on top keeps text readable, image underneath.
    // All glows, grain, vignette overlays run above it — no z-index conflicts.
    const bgImage = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-image').trim();
    if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
      const scene = document.querySelector('.scene');
      if (scene) {
        const scrim = 'linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0.72))';
        scene.style.backgroundImage    = scrim + ', ' + bgImage;
        scene.style.backgroundSize     = 'cover, cover';
        scene.style.backgroundPosition = 'center center, center center';
        console.log('[PAUSE_SCRIPT] background image applied to .scene');
      }
    }
  }, { once: true });
`;

async function seekAnimations(page, t_ms) {
  await page.evaluate((t) => {
    document.getAnimations().forEach(anim => { anim.currentTime = t; });
  }, t_ms);
}

/**
 * renderBeat — now async-fetches the Unsplash image before rendering.
 *
 * Fetch happens before injectVariables so the URL is baked into the
 * static HTML file — no runtime network request inside the browser page.
 * The image loads via Playwright's own network stack (which bypasses
 * CORS since it's a top-level fetch, not a cross-origin xhr).
 */
async function renderBeat(browser, beat, beatIdx, palette, brand) {
  const beatOutDir = join(outDir, `beat_${beatIdx}`);
  mkdirSync(beatOutDir, { recursive: true });

  // Fetch background image before building the HTML — baked into CSS vars
  const imageUrl = await fetchUnsplashUrl(beat.visual_query || '');
  if (imageUrl) {
    console.log(`[capture] Beat ${beatIdx}: background image applied`);
  } else {
    console.log(`[capture] Beat ${beatIdx}: no background image (visual_query="${beat.visual_query || ''}")`);
  }

  const html    = injectVariables(loadTemplate(beat.scene), beat, palette, brand, imageUrl);
  const tmpHtml = join(beatOutDir, '_scene.html');
  writeFileSync(tmpHtml, html, 'utf8');

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(PAUSE_SCRIPT);

  const page = await context.newPage();

  // Wait for the background image to load before we start capturing.
  // We use 'networkidle' only when there's an image to fetch — otherwise
  // keep the cheaper 'domcontentloaded' which is fast for local files.
  const waitUntil = imageUrl ? 'networkidle' : 'domcontentloaded';
  await page.goto(`file://${tmpHtml}`, { waitUntil, timeout: 15000 });
  await page.waitForTimeout(80);

  const isLastBeat  = beatIdx === sceneJson.beats.length - 1;
  const gap_ms      = isLastBeat ? 0 : 380;
  const duration_ms = beat.duration_ms + gap_ms;
  const frame_count = Math.ceil((duration_ms / 1000) * fps);
  const frame_ms    = 1000 / fps;

  console.log(`[capture] Beat ${beatIdx} "${beat.keyword}" — ${frame_count} frames @ ${fps}fps`);

  const TIME_OFFSET_MS = 80;
  for (let f = 0; f < frame_count; f++) {
    const t_ms     = (f * frame_ms) + TIME_OFFSET_MS;
    await seekAnimations(page, t_ms);
    const framePath = join(beatOutDir, `frame_${String(f).padStart(5, '0')}.png`);
    await page.screenshot({ path: framePath, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
  }

  await context.close();
  console.log(`[capture] Beat ${beatIdx} done → ${beatOutDir}`);
  return { beatIdx, frameCount: frame_count, dir: beatOutDir };
}

async function main() {
  let browser = await chromium.launch({
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
  });

  const { palette, brand, beats } = sceneJson;
  const results = [];

  for (let i = 0; i < beats.length; i++) {
    if (beatFilter && !beatFilter.includes(i)) continue;
    let result = null, lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        result = await renderBeat(browser, beats[i], i, palette, brand);
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[capture] Beat ${i} attempt ${attempt} failed: ${err.message}`);
        if (attempt < 2) {
          console.log('[capture] Restarting browser...');
          try { await browser.close(); } catch (_) {}
          browser = await chromium.launch({
            args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
          });
        }
      }
    }
    if (!result) throw lastErr;
    results.push(result);
  }

  await browser.close();

  const manifest = { fps, beats: results.map(r => ({ beatIdx: r.beatIdx, frameCount: r.frameCount, dir: r.dir })) };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[capture] Manifest → ${join(outDir, 'manifest.json')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
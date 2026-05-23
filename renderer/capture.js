/**
 * capture.js  --  Playwright frame capture for cinematic renderer
 *
 * ────────────────────────────────────────────────────────────────────
 * PATH RESOLUTION FIX (v3.1)
 * ────────────────────────────────────────────────────────────────────
 * _scene.html is written to workspace/runs/<id>/frames/beat_N/_scene.html,
 * but the template's CSS/JS hrefs are relative (../motion/..., ../lib/...).
 * Those relative paths resolved RELATIVE TO THE WRITTEN HTML LOCATION —
 * not the renderer/ folder — so every external CSS / JS was 404'ing
 * inside Playwright.
 *
 * Fix: rewrite every `href="../folder/…"` and `src="../folder/…"` to an
 * absolute file:// URL pointing at the renderer/ directory before writing.
 * The renderer dir is the location of THIS module (capture.js), discovered
 * via import.meta.url → pathToFileURL.
 *
 * A bonus requestfailed listener logs any remaining 404s so we can verify
 * the fix worked at runtime.
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { parseArgs } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';

const { values: args } = parseArgs({
  options: {
    scene:       { type: 'string' },
    out:         { type: 'string', default: 'frames' },
    fps:         { type: 'string', default: '30' },
    beats:       { type: 'string' },
    concurrency: { type: 'string', default: '2' },
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
const beatFilter   = args.beats ? args.beats.split(',').map(Number) : null;
const CONCURRENCY  = parseInt(args.concurrency || '2', 10);

/** Run async tasks in chunks of n. Order of results is preserved. */
async function runChunked(items, n, fn) {
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += n) {
    const chunk = items.slice(i, i + n);
    const out   = await Promise.all(chunk.map((item, j) => fn(item, i + j)));
    out.forEach((r, j) => { results[i + j] = r; });
  }
  return results;
}

// ── Renderer directory + absolute file:// URL ───────────────────────────────
const __dir        = fileURLToPath(new URL('.', import.meta.url));
const RENDERER_URL = pathToFileURL(__dir).href;  // file:///D:/Projects/MediaGen/renderer/

/**
 * Rewrite relative asset URLs in scene HTML to absolute file:// URLs.
 */
function rewriteAssetUrls(html) {
  return html.replace(
    /(href|src)="\.\.\/(motion|themes|lib|scenes|assets)\//g,
    `$1="${RENDERER_URL}$2/`
  );
}

// ── Unsplash ─────────────────────────────────────────────────────────────────
const UNSPLASH_KEY = process.env.UNSPLASH_API_KEY || '';

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
      signal: AbortSignal.timeout(6000),
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

console.log('[capture] scene:    ', scenePath);
console.log('[capture] out:      ', outDir);
console.log('[capture] renderer: ', RENDERER_URL);

mkdirSync(outDir, { recursive: true });

/**
 * Load the base + per-scene HTML templates and rewrite relative URLs.
 */
function loadTemplate(sceneName) {
  const base  = readFileSync(join(__dir, 'scenes/_base.html'), 'utf8');
  const scene = readFileSync(join(__dir, `scenes/${sceneName}.html`), 'utf8');
  const html  = base.replace('{{SCENE_CONTENT}}', scene);
  return rewriteAssetUrls(html);
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

  function withEmphasis(line) {
    const escaped = escapeHtml(line);
    return escaped
      .replace(/\*([^*\n]{1,60}?)\*/g, '<span class="em">$1</span>')
      .replace(/\*/g, '');
  }

  if (raw.length <= 1 || raw.length > 3) {
    return `<span class="body-line">${withEmphasis(body)}</span>`;
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
    .map(line => `<span class="body-line">${withEmphasis(line.trim())}</span>`)
    .join('');
}

/**
 * injectVariables — bake palette + beat data + theme link into HTML.
 *
 * The theme stylesheet is injected here (not in the static _base.html)
 * because the theme name comes from scene.json. We use RENDERER_URL so
 * the absolute file:// path is correct regardless of where _scene.html
 * ends up being written.
 */
function injectVariables(html, beat, palette, brand, imageUrl) {
  const layout   = beat.layout || sceneJson.layout || 'left';
  const camDur   = ((beat.duration_ms || 5000) / 1000).toFixed(2) + 's';
  const beatIdx  = String(beat.beat_index  || '').padStart(2, '0');
  const beatTot  = String(beat.beat_total  || '').padStart(2, '0');

  const bgImageValue = imageUrl
    ? `url("${imageUrl.replace(/"/g, '%22')}")`
    : 'none';

  // ▼▼▼ NEW: read sz_kw from beat contract ▼▼▼
  // visuals.py calculates sz_kw per beat using _calc_kw_font_size().
  // When present, inject as --sz-kw CSS variable into :root AND add a
  // one-line global override rule that forces ALL keyword elements
  // ([class$="-kw"] covers hook-kw, truth-kw, climax-kw, insight-kw,
  // flip-kw, tension-kw, payoff-kw, cta-kw) to use the calculated size.
  // !important beats scene-specific font-size rules including full-layout
  // upscaling (e.g. calc(var(--sz-hero)*1.10) in climax/flip/hook).
  // When sz_kw equals the scene default the override is a no-op.
  const szKw = (beat.sz_kw ? beat.sz_kw + 'px' : null);
  // ▲▲▲ END NEW ▲▲▲

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
    // ▼▼▼ NEW: inject --sz-kw when a reduced size was calculated ▼▼▼
    ...(szKw ? ['  --sz-kw:    ' + szKw + ';'] : []),
    // ▲▲▲ END NEW ▲▲▲
    '}',
    // ▼▼▼ NEW: global kw font-size override — applies to all scene types ▼▼▼
    // Injected only when sz_kw is set (i.e. longest word would overflow at
    // the scene default size). Silent no-op for short keywords.
    ...(szKw ? [
      '</style>',
      '<style id="sz-kw-override">',
      '[class$="-kw"] { font-size: var(--sz-kw) !important; }',
    ] : []),
    // ▲▲▲ END NEW ▲▲▲
    '</style>',
  ].join('\n');

  const beatJson   = JSON.stringify(beat).replace(/<\/script>/gi, '<\\/script>');
  const beatScript = '<script id="beat-data">window.__BEAT__ = ' + beatJson + ';</scri' + 'pt>';
  const themeLink  = '<link rel="stylesheet" href="' + RENDERER_URL + 'themes/' + sceneJson.theme + '.css">';

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
    const pauseStyle = document.createElement('style');
    pauseStyle.textContent = '*, *::before, *::after { animation-play-state: paused !important; }';
    document.head.appendChild(pauseStyle);

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

async function renderBeat(browser, beat, beatIdx, palette, brand, imageUrl = null) {
  const beatOutDir = join(outDir, `beat_${beatIdx}`);
  mkdirSync(beatOutDir, { recursive: true });

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

  page.on('requestfailed', req => {
    const url = req.url();
    if (url.endsWith('.css') || url.endsWith('.js') || url.includes('/motion/') ||
        url.includes('/themes/') || url.includes('/lib/')) {
      console.warn(`[capture] ASSET FAIL ${req.failure()?.errorText || ''} ${url}`);
    }
  });
  page.on('response', resp => {
    const url = resp.url();
    if ((url.endsWith('.css') || url.endsWith('.js')) && resp.status() >= 400) {
      console.warn(`[capture] ASSET ${resp.status()} ${url}`);
    }
  });

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

  const activeIndices = beats
    .map((_, i) => i)
    .filter(i => !beatFilter || beatFilter.includes(i));

  console.log(`[capture] Pre-fetching ${activeIndices.length} images in parallel…`);
  const imageUrls = await Promise.all(
    activeIndices.map(i => fetchUnsplashUrl(beats[i].visual_query || ''))
  );

  console.log(`[capture] Rendering ${activeIndices.length} beats (concurrency=${CONCURRENCY})…`);
  const beatTasks = activeIndices.map((beatIdx, j) => ({ beatIdx, imageUrl: imageUrls[j] }));

  const chunkResults = await runChunked(beatTasks, CONCURRENCY, async ({ beatIdx, imageUrl }) => {
    let result = null, lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        result = await renderBeat(browser, beats[beatIdx], beatIdx, palette, brand, imageUrl);
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[capture] Beat ${beatIdx} attempt ${attempt} failed: ${err.message}`);
        if (attempt < 2) {
          console.log('[capture] Restarting browser…');
          try { await browser.close(); } catch (_) {}
          browser = await chromium.launch({
            args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
          });
        }
      }
    }
    if (!result) throw lastErr;
    return result;
  });

  results.push(...chunkResults);

  await browser.close();

  const manifest = { fps, beats: results.map(r => ({ beatIdx: r.beatIdx, frameCount: r.frameCount, dir: r.dir })) };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[capture] Manifest → ${join(outDir, 'manifest.json')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
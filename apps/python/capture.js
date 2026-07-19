/**
 * capture.js  --  Playwright frame capture (OPTIMIZED v4.1)
 *
 * v4.1 FIX — the body paragraph regression
 * ─────────────────────────────────────────────────────────────────────────
 * v4 replaced goto(file://) with page.setContent() ("Optimization 5").
 * That broke text/fonts because setContent() does NOT change the page URL:
 * a pooled page sits at about:blank, so the document origin is OPAQUE.
 * Chromium blocks loading file:// sub-resources from an opaque origin, so:
 *   - inlined <style> CSS still worked (no fetch)        → layout/keyword OK
 *   - <script src="file://.../lib/*.js"> were BLOCKED    → inject.js et al dead
 *   - @font-face { src: url(file://...) } were BLOCKED   → body font never
 *     loaded; with font-display:block/auto the paragraph stays invisible
 *
 * Fix: write _scene.html and navigate with goto('file://...') again, so the
 * document origin is file:// and every file:// resource is allowed to load.
 * ALL the other v4 wins are kept:
 *   1. Inlined CSS (no per-beat file:// CSS round-trips)
 *   3. Async PNG write queue
 *   4. Persistent context pool
 *   7. True worker pool (idle workers self-assign the next beat)
 *   + anti-throttling launch flags
 *
 * Because PAUSE_SCRIPT is registered via ctx.addInitScript (pool init) and
 * addInitScript RE-FIRES on every navigation, each goto() re-applies the
 * pause + background logic automatically — no manual page.evaluate() needed.
 *
 * Cleanups:
 *   - Motion/theme CSS is inlined once; the template's <link> tags for those
 *     are stripped so each sheet is parsed ONCE (v4 loaded them twice).
 *   - lib/* <script> tags and asset URLs are still rewritten to file:// and
 *     load normally under the restored file:// origin.
 */

import { chromium }                                      from 'playwright';
import { readFileSync, mkdirSync, writeFileSync, writeFile } from 'fs';
import { resolve, join }                                 from 'path';
import { parseArgs }                                     from 'util';
import { fileURLToPath, pathToFileURL }                  from 'url';
import { promisify }                                     from 'util';

const writeFileAsync = promisify(writeFile);

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

const scenePath   = toAbs(args.scene);
const sceneJson   = JSON.parse(readFileSync(scenePath, 'utf8'));
const outDir      = toAbs(args.out);
const fps         = parseInt(args.fps, 10);
const beatFilter  = args.beats ? args.beats.split(',').map(Number) : null;
const CONCURRENCY = parseInt(args.concurrency || '2', 10);

const __dir        = fileURLToPath(new URL('.', import.meta.url));
const RENDERER_URL = pathToFileURL(__dir).href;

// ─── OPTIMIZATION 1: inline all motion CSS as <style> blocks ────────────────
// CSS is read once at startup and embedded directly, eliminating a file://
// round-trip per beat. (Still correct under goto(file://) — inline needs no
// fetch — and we strip the matching <link> tags below so it's parsed once.)

function inlineCssFiles() {
  const cssFiles = [
    'motion/camera.css',
    'motion/cinematic.css',
    'motion/entries.css',
    'motion/overlays.css',
    'motion/retention.css',
    'motion/typography.css',
    'motion/ambient-life.css',
  ];

  return cssFiles.map(f => {
    try {
      const css = readFileSync(join(__dir, f), 'utf8');
      return `<style data-src="${f}">\n${css}\n</style>`;
    } catch {
      console.warn(`[capture] Could not inline ${f}`);
      return '';
    }
  }).join('\n');
}

const INLINED_CSS = inlineCssFiles();  // computed once at startup

// ─── OPTIMIZATION 2: preload theme CSS at startup too ───────────────────────
function inlineThemeCss(themeName) {
  try {
    const css = readFileSync(join(__dir, `themes/${themeName}.css`), 'utf8');
    return `<style data-theme="${themeName}">\n${css}\n</style>`;
  } catch {
    // Fallback to a link (works under goto(file://)).
    return `<link rel="stylesheet" href="${RENDERER_URL}themes/${themeName}.css">`;
  }
}
const THEME_CSS = inlineThemeCss(sceneJson.theme);  // computed once at startup

// ─── Template loading ────────────────────────────────────────────────────────

// Rewrite relative asset URLs (lib/scenes/assets — and any themes/motion links
// we did NOT strip) to absolute file:// so they resolve under goto(file://).
function rewriteAssetUrls(html) {
  return html.replace(
    /(href|src)="\.\.\/(motion|themes|lib|scenes|assets)\//g,
    `$1="${RENDERER_URL}$2/`
  );
}

// CLEANUP: remove the template's <link> tags for motion/* and themes/* — that
// CSS is now inlined (INLINED_CSS / THEME_CSS). Prevents loading each sheet
// twice (v4 inlined AND linked them). lib/* <script> tags are left intact so
// inject.js & friends still load over file://.
function stripInlinedCssLinks(html) {
  return html.replace(
    /<link\b[^>]*href="\.\.\/(?:motion|themes)\/[^"]*"[^>]*>\s*/gi,
    ''
  );
}

// Cache all scene templates at startup — eliminates repeated disk reads.
const TEMPLATE_CACHE = new Map();

function loadTemplate(sceneName) {
  if (TEMPLATE_CACHE.has(sceneName)) return TEMPLATE_CACHE.get(sceneName);
  const base  = readFileSync(join(__dir, 'scenes/_base.html'), 'utf8');
  const scene = readFileSync(join(__dir, `scenes/${sceneName}.html`), 'utf8');
  let   html  = base.replace('{{SCENE_CONTENT}}', scene);
  html = stripInlinedCssLinks(html);   // drop motion/theme <link>s (inlined)
  html = rewriteAssetUrls(html);       // absolutise remaining lib/asset URLs
  TEMPLATE_CACHE.set(sceneName, html);
  return html;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

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
  return keyword.split(/\s+/).filter(Boolean)
    .map(w => `<span class="kw-word">${escapeHtml(w)}</span>`)
    .join(' ');
}

function wrapBodyLines(body) {
  if (!body) return '';
  const raw = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  function withEmphasis(line) {
    return escapeHtml(line)
      .replace(/\*([^*\n]{1,60}?)\*/g, '<span class="em">$1</span>')
      .replace(/\*/g, '');
  }
  if (raw.length <= 1 || raw.length > 3) {
    return `<span class="body-line">${withEmphasis(body)}</span>`;
  }
  const merged = [];
  for (const sentence of raw) {
    const wordCount = sentence.trim().split(/\s+/).length;
    if (wordCount < 4 && merged.length > 0) merged[merged.length - 1] += ' ' + sentence;
    else merged.push(sentence);
  }
  return merged.map(line => `<span class="body-line">${withEmphasis(line.trim())}</span>`).join('');
}

function injectVariables(html, beat, palette, brand, imageUrl) {
  const layout  = beat.layout || sceneJson.layout || 'left';
  const camDur  = ((beat.duration_ms || 5000) / 1000).toFixed(2) + 's';
  const beatIdx = String(beat.beat_index || '').padStart(2, '0');
  const beatTot = String(beat.beat_total || '').padStart(2, '0');
  const bgImageValue = imageUrl ? `url("${imageUrl.replace(/"/g, '%22')}")` : 'none';
  const szKw = beat.sz_kw ? beat.sz_kw + 'px' : null;

  const cssVars = [
    '<style id="palette-inject">',
    ':root {',
    `  --acc:      ${palette.accent};`,
    `  --spike:    ${palette.spike};`,
    `  --bg:       ${palette.bg};`,
    `  --fg:       ${palette.fg};`,
    `  --beat-dur: ${beat.duration_ms}ms;`,
    `  --cam-dur:  ${camDur};`,
    `  --bg-image: ${bgImageValue};`,
    ...(szKw ? [`  --sz-kw:    ${szKw};`] : []),
    '}',
    ...(szKw ? [
      '</style>',
      '<style id="sz-kw-override">',
      '[class$="-kw"] { font-size: var(--sz-kw) !important; }',
    ] : []),
    '</style>',
  ].join('\n');

  const beatJson   = JSON.stringify(beat).replace(/<\/script>/gi, '<\\/script>');
  const beatScript = `<script id="beat-data">window.__BEAT__ = ${beatJson};</scri` + `pt>`;

  // Inject theme + inlined motion CSS + palette vars + beat data before </head>.
  html = html.replace(
    '</head>',
    THEME_CSS + '\n' + INLINED_CSS + '\n' + cssVars + '\n' + beatScript + '\n</head>'
  );

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

  const mojibake = [
    ['\u00e2\u0080\u0093', '\u2014'], ['\u00e2\u0080\u0098', '\u2018'],
    ['\u00e2\u0080\u0099', '\u2019'], ['\u00e2\u0080\u009c', '\u201c'],
    ['\u00e2\u0080\u009d', '\u201d'], ['\u00e2\u0080\u00a6', '\u2026'],
    ['\u00c3\u00a9',       '\u00e9'], ['\u00c3\u00a0',       '\u00e0'],
  ];
  for (const [bad, good] of mojibake) html = html.split(bad).join(good);

  return html;
}

// ─── PAUSE_SCRIPT ────────────────────────────────────────────────────────────
// Registered with ctx.addInitScript() in the pool. addInitScript re-fires on
// EVERY navigation, so each goto(file://) re-applies pause + background. The
// document origin is file:// under goto, so .depth-bg (created by inject.js)
// exists and the camera-on-image motion works as in v3.
const PAUSE_SCRIPT = `
  document.addEventListener('DOMContentLoaded', () => {
    const pauseStyle = document.createElement('style');
    pauseStyle.textContent = '*, *::before, *::after { animation-play-state: paused !important; }';
    document.head.appendChild(pauseStyle);

    const bgImage = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-image').trim();
    if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
      const match = bgImage.match(/^url\\(["']?(.+?)["']?\\)$/);
      const src   = match ? match[1] : null;
      const applyBg = () => {
        const scene = document.querySelector('.scene');
        if (!scene) return;
        const depthBg = scene.querySelector('.depth-bg > .life-layer')
                     || scene.querySelector('.depth-bg') || scene;
        const scrim = 'linear-gradient(rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.78) 100%)';
        depthBg.style.backgroundImage    = scrim + ', ' + bgImage;
        depthBg.style.backgroundSize     = 'cover, cover';
        depthBg.style.backgroundPosition = 'center center, center center';
        scene.style.backgroundColor = 'var(--bg, #09090b)';
      };
      if (src) {
        const img = new Image();
        img.onload = img.onerror = applyBg;
        img.src = src;
      } else {
        applyBg();
      }
    }
  }, { once: true });
`;

// ─── OPTIMIZATION 3: PNG write queue ─────────────────────────────────────────
// Decouples screenshot buffer capture from disk write. Screenshot returns a
// Buffer (no path=) so Chromium can composite the next frame while Node writes
// the previous one. Writes drain through a capped concurrent queue.
const WRITE_CONCURRENCY = 8;
let activeWrites = 0;
const writeQueue = [];

function queueWrite(path, buffer) {
  return new Promise((resolve, reject) => {
    writeQueue.push({ path, buffer, resolve, reject });
    drainWriteQueue();
  });
}

function drainWriteQueue() {
  while (activeWrites < WRITE_CONCURRENCY && writeQueue.length > 0) {
    const { path, buffer, resolve, reject } = writeQueue.shift();
    activeWrites++;
    writeFileAsync(path, buffer)
      .then(() => { activeWrites--; resolve(); drainWriteQueue(); })
      .catch(err => { activeWrites--; reject(err); drainWriteQueue(); });
  }
}

// ─── OPTIMIZATION 4: persistent context pool ─────────────────────────────────
class ContextPool {
  constructor(browser, size) {
    this.browser = browser;
    this.size    = size;
    this.pool    = [];
    this.waiters = [];
  }

  async init() {
    console.log(`[pool] Creating ${this.size} persistent contexts...`);
    for (let i = 0; i < this.size; i++) {
      const ctx = await this.browser.newContext({
        viewport: { width: 1080, height: 1920 },
        deviceScaleFactor: 1,
      });
      // Re-fires on every navigation → re-applies pause + bg per beat.
      await ctx.addInitScript(PAUSE_SCRIPT);
      const page = await ctx.newPage();

      // Surface blocked/failed file:// loads (silent killers of fonts & lib JS).
      page.on('requestfailed', req => {
        const url = req.url();
        if (url.startsWith('file://') ||
            url.endsWith('.css') || url.endsWith('.js') ||
            /\.(woff2?|ttf|otf)(\?|$)/i.test(url)) {
          console.warn(`[capture] ASSET FAIL ${req.failure()?.errorText || ''} ${url}`);
        }
      });

      this.pool.push({ ctx, page, busy: false });
    }
    console.log(`[pool] ${this.size} contexts ready`);
  }

  async close() {
    for (const w of this.pool) {
      try { await w.ctx.close(); } catch (_) {}
    }
  }
}

// ─── Beat load: write _scene.html + goto(file://) ────────────────────────────
// FIX (v4.1): restores file:// origin so lib/*.js and @font-face fonts load.
// PAUSE_SCRIPT (addInitScript) re-fires on this navigation, so NO manual
// page.evaluate() pause/bg injection is needed here.
async function loadBeatOnPage(page, html, imageUrl, beatOutDir) {
  const tmpHtml = join(beatOutDir, '_scene.html');
  writeFileSync(tmpHtml, html, 'utf8');

  await page.goto(pathToFileURL(tmpHtml).href, {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  });

  // Wait for fonts (so the body paragraph isn't captured mid font-swap) and,
  // if present, the background image — then settle layout with a double rAF.
  if (imageUrl) {
    try {
      await page.waitForFunction(
        (src) => new Promise(res => {
          const img = new Image();
          img.onload  = () => res(true);
          img.onerror = () => res(true);   // proceed even if the image 404s
          img.src = src;
        }),
        imageUrl,
        { timeout: 10000 }
      );
    } catch { /* image wait timed out — continue without it */ }
  }

  try {
    await page.evaluate(() => (document.fonts && document.fonts.ready) || true);
  } catch { /* fonts API unavailable — ignore */ }

  // Two rAFs let layout + applied background + fonts settle before first seek.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// ─── OPTIMIZATION 6: seek + buffer screenshot + async write ──────────────────
async function captureFrames(page, beatOutDir, frame_count, fps) {
  const frame_ms      = 1000 / fps;
  const TIME_OFFSET   = 80;
  const writePromises = [];

  for (let f = 0; f < frame_count; f++) {
    const t_ms = (f * frame_ms) + TIME_OFFSET;

    await page.evaluate((t) => {
      document.getAnimations().forEach(anim => { anim.currentTime = t; });
    }, t_ms);

    const buffer = await page.screenshot({
      clip: { x: 0, y: 0, width: 1080, height: 1920 },
      type: 'png',
    });

    const framePath = join(beatOutDir, `frame_${String(f).padStart(5, '0')}.png`);
    writePromises.push(queueWrite(framePath, buffer));  // non-blocking
  }

  await Promise.all(writePromises);
}

// ─── Media fetching ──────────────────────────────────────────────────────────
const UNSPLASH_KEY = process.env.UNSPLASH_API_KEY || '';
const PEXELS_KEY   = process.env.PEXELS_API_KEY   || '';
const PIXABAY_KEY  = process.env.PIXABAY_API_KEY  || '';

async function fetchMediaAsset(query, type = 'image') {
  if (!query) return null;
  const TIMEOUT_MS = 6000;

  async function fetchPexelsImage(q) {
    if (!PEXELS_KEY) return null;
    async function search(sq) {
      try {
        const res = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(sq)}&orientation=portrait&per_page=8&size=medium`,
          { headers: { Authorization: PEXELS_KEY }, signal: AbortSignal.timeout(TIMEOUT_MS) }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.photos) ? data.photos : [];
      } catch { return []; }
    }
    let results = await search(q);
    if (!results.length) {
      const subject = q.split(/\s+/).slice(0, 2).join(' ');
      if (subject !== q) results = await search(subject);
    }
    if (!results.length) return null;
    const pick = results[0];
    const url  = pick?.src?.portrait || pick?.src?.large2x || pick?.src?.large;
    if (url) { console.log(`[media] Pexels ✓ "${q}" → ${pick?.photographer || 'unknown'}`); return url; }
    return null;
  }

  async function fetchUnsplashImage(q) {
    if (!UNSPLASH_KEY) return null;
    async function search(sq) {
      try {
        const res = await fetch(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(sq)}&orientation=portrait&content_filter=high&per_page=8&order_by=relevant&client_id=${UNSPLASH_KEY}`,
          { headers: { 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(TIMEOUT_MS) }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.results) ? data.results : [];
      } catch { return []; }
    }
    let results = await search(q);
    if (!results.length) {
      const subject = q.split(/\s+/).slice(0, 2).join(' ');
      if (subject !== q) results = await search(subject);
    }
    if (!results.length) return null;
    const top  = results.slice(0, Math.min(5, results.length));
    const pick = top[Math.floor(Math.random() * top.length)];
    if (pick?.links?.download_location) {
      fetch(`${pick.links.download_location}?client_id=${UNSPLASH_KEY}`, {
        headers: { 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => {});
    }
    const url = pick?.urls?.regular;
    if (url) { console.log(`[media] Unsplash ✓ "${q}" → ${pick?.user?.name || 'unknown'}`); return url + '&bri=-30&con=10'; }
    return null;
  }

  async function fetchPixabayImage(q) {
    if (!PIXABAY_KEY) return null;
    async function search(sq) {
      try {
        const res = await fetch(
          `https://pixabay.com/api/?key=${encodeURIComponent(PIXABAY_KEY)}&q=${encodeURIComponent(sq)}&image_type=photo&orientation=vertical&safesearch=true&per_page=8&order=relevant`,
          { signal: AbortSignal.timeout(TIMEOUT_MS) }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.hits) ? data.hits : [];
      } catch { return []; }
    }
    let results = await search(q);
    if (!results.length) {
      const subject = q.split(/\s+/).slice(0, 2).join(' ');
      if (subject !== q) results = await search(subject);
    }
    if (!results.length) return null;
    const pick = results[0];
    const url  = pick?.webformatURL || pick?.largeImageURL;
    if (url) { console.log(`[media] Pixabay ✓ "${q}" → ${pick?.user || 'unknown'}`); return url; }
    return null;
  }

  if (type === 'image') {
    return (await fetchPexelsImage(query))
        || (await fetchUnsplashImage(query))
        || (await fetchPixabayImage(query))
        || null;
  }
  return null;
}

// ─── OPTIMIZATION 7: true worker pool ────────────────────────────────────────
// Idle workers self-assign the next beat — no "wait for slowest in chunk".
async function runWorkerPool(tasks, pool, fn) {
  const results  = new Array(tasks.length);
  let   nextTask = 0;

  async function workerLoop(worker) {
    while (nextTask < tasks.length) {
      const myIdx = nextTask++;
      results[myIdx] = await fn(worker, tasks[myIdx], myIdx);
    }
  }

  await Promise.all(pool.pool.map(worker => workerLoop(worker)));
  return results;
}

// ─── Beat renderer ───────────────────────────────────────────────────────────
async function renderBeat(worker, { beatIdx, imageUrl }, _taskIdx) {
  const beat       = sceneJson.beats[beatIdx];
  const { palette, brand } = sceneJson;
  const beatOutDir = join(outDir, `beat_${beatIdx}`);
  mkdirSync(beatOutDir, { recursive: true });

  if (imageUrl) {
    console.log(`[capture] Beat ${beatIdx}: background image applied`);
  } else {
    console.log(`[capture] Beat ${beatIdx}: no background image (visual_query="${beat.visual_query || ''}")`);
  }

  // Build HTML in Node (CPU work, no IPC).
  const html = injectVariables(loadTemplate(beat.scene), beat, palette, brand, imageUrl);

  // FIX v4.1: write + goto(file://) instead of setContent().
  await loadBeatOnPage(worker.page, html, imageUrl, beatOutDir);

  const isLastBeat  = beatIdx === sceneJson.beats.length - 1;
  const gap_ms      = isLastBeat ? 0 : 380;
  const duration_ms = beat.duration_ms + gap_ms;
  const frame_count = Math.ceil((duration_ms / 1000) * fps);

  console.log(`[capture] Beat ${beatIdx} "${beat.keyword}" — ${frame_count} frames @ ${fps}fps`);

  await captureFrames(worker.page, beatOutDir, frame_count, fps);

  console.log(`[capture] Beat ${beatIdx} done → ${beatOutDir}`);
  return { beatIdx, frameCount: frame_count, dir: beatOutDir };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[capture] scene:    ', scenePath);
  console.log('[capture] out:      ', outDir);
  console.log('[capture] renderer: ', RENDERER_URL);

  mkdirSync(outDir, { recursive: true });

  // Pre-cache scene templates.
  const uniqueScenes = [...new Set(sceneJson.beats.map(b => b.scene))];
  uniqueScenes.forEach(s => loadTemplate(s));
  console.log(`[capture] Cached ${uniqueScenes.length} scene templates`);

  const browser = await chromium.launch({
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Headless renderers are always "background" — stop Chromium throttling
      // timers/rAF so seek + screenshot run at full speed.
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });

  const pool = new ContextPool(browser, CONCURRENCY);

  const { beats } = sceneJson;
  const activeIndices = beats
    .map((_, i) => i)
    .filter(i => !beatFilter || beatFilter.includes(i));

  // Overlap context init with image fetching.
  console.log(`[capture] Pre-fetching ${activeIndices.length} images in parallel…`);
  const [imageUrls] = await Promise.all([
    Promise.all(activeIndices.map(i => fetchMediaAsset(beats[i].visual_query || '', 'image'))),
    pool.init(),
  ]);

  const tasks = activeIndices.map((beatIdx, j) => ({ beatIdx, imageUrl: imageUrls[j] }));

  console.log(`[capture] Rendering ${activeIndices.length} beats (concurrency=${CONCURRENCY})…`);
  const results = await runWorkerPool(tasks, pool, renderBeat);

  await pool.close();
  await browser.close();

  const manifest = {
    fps,
    beats: results.map(r => ({ beatIdx: r.beatIdx, frameCount: r.frameCount, dir: r.dir })),
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[capture] Manifest → ${join(outDir, 'manifest.json')}`);
}

main().catch(err => { console.error(err); process.exit(1); });

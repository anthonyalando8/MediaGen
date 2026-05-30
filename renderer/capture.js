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
 *
 * ────────────────────────────────────────────────────────────────────
 * BACKGROUND IMAGE FIX (v3.2)
 * ────────────────────────────────────────────────────────────────────
 * Previously, PAUSE_SCRIPT applied backgroundImage to .scene.
 * camera.css animates .depth-bg (a child of .scene), not .scene itself.
 * Scaling an empty transparent .depth-bg does nothing visible — the
 * background image on .scene shows through unchanged, so the camera
 * motion was real in the DOM but invisible on screen.
 *
 * Fix: apply backgroundImage to .depth-bg instead. Now when camera.css
 * runs camPushBg { scale(1.06)→scale(1.18) }, the image actually zooms.
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
const PEXELS_KEY = process.env.PEXELS_API_KEY || '';
const PIXABAY_KEY = process.env.PIXABAY_API_KEY || '';

async function fetchMediaAsset(query, type = "image") {
  if (!query) return null;

  const TIMEOUT_MS = 6000;

  // ─── PROVIDER 1: PEXELS ───────────────────────────────────────────────────

  async function fetchPexelsImage(q) {
    if (!PEXELS_KEY) return null;

    async function search(searchQuery) {
      const url = `https://api.pexels.com/v1/search`
        + `?query=${encodeURIComponent(searchQuery)}`
        + `&orientation=portrait&per_page=8&size=medium`;

      try {
        const res = await fetch(url, {
          headers: { Authorization: PEXELS_KEY },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) {
          console.warn(`[media] Pexels ${res.status} for "${searchQuery}"`);
          return [];
        }

        const data = await res.json();
        return Array.isArray(data?.photos) ? data.photos : [];
      } catch (err) {
        console.warn(`[media] Pexels search failed for "${searchQuery}": ${err.message}`);
        return [];
      }
    }

    let results = await search(q);

    if (!results.length) {
      const subject = q.split(/\s+/).slice(0, 2).join(" ");
      if (subject && subject !== q) {
        console.log(`[media] Pexels: "${q}" had 0 hits — retrying subject "${subject}"`);
        results = await search(subject);
      }
    }

    if (!results.length) return null;

    const pick = results[0]; // Pexels returns by relevance — always take top result
    const imageUrl = pick?.src?.portrait || pick?.src?.large2x || pick?.src?.large;

    if (imageUrl) {
      console.log(`[media] Pexels ✓ "${q}" → ${pick?.photographer || "unknown"}`);
      return imageUrl;
    }

    return null;
  }

  // ─── PROVIDER 2: UNSPLASH ─────────────────────────────────────────────────

  async function fetchUnsplashImage(q) {
    if (!UNSPLASH_KEY) return null;

    async function search(searchQuery) {
      const url = `https://api.unsplash.com/search/photos`
        + `?query=${encodeURIComponent(searchQuery)}`
        + `&orientation=portrait&content_filter=high&per_page=8&order_by=relevant`
        + `&client_id=${UNSPLASH_KEY}`;

      try {
        const res = await fetch(url, {
          headers: { "Accept-Version": "v1" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) {
          console.warn(`[media] Unsplash ${res.status} for "${searchQuery}"`);
          return [];
        }

        const data = await res.json();
        return Array.isArray(data?.results) ? data.results : [];
      } catch (err) {
        console.warn(`[media] Unsplash search failed for "${searchQuery}": ${err.message}`);
        return [];
      }
    }

    let results = await search(q);

    if (!results.length) {
      const subject = q.split(/\s+/).slice(0, 2).join(" ");
      if (subject && subject !== q) {
        console.log(`[media] Unsplash: "${q}" had 0 hits — retrying subject "${subject}"`);
        results = await search(subject);
      }
    }

    if (!results.length) return null;

    const top = results.slice(0, Math.min(5, results.length));
    const pick = top[Math.floor(Math.random() * top.length)];
    const imageUrl = pick?.urls?.regular;

    // ✅ REQUIRED: Trigger Unsplash download tracking
    if (pick?.links?.download_location) {
      try {
        await fetch(
          `${pick.links.download_location}?client_id=${UNSPLASH_KEY}`,
          {
            headers: { "Accept-Version": "v1" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }
        );
        console.log(`[media] Unsplash download tracked for "${q}"`);
      } catch (err) {
        console.warn(`[media] Unsplash download tracking failed: ${err.message}`);
      }
    }

    if (imageUrl) {
      console.log(`[media] Unsplash ✓ "${q}" → ${pick?.user?.name || "unknown"}`);
      return imageUrl + "&bri=-30&con=10";
    }

    return null;
  }

  // ─── PROVIDER 3: PIXABAY ─────────────────────────────────────────────────

  async function fetchPixabayImage(q) {
    if (!PIXABAY_KEY) return null;

    async function search(searchQuery) {
      const url = `https://pixabay.com/api/`
        + `?key=${encodeURIComponent(PIXABAY_KEY)}`
        + `&q=${encodeURIComponent(searchQuery)}`
        + `&image_type=photo&orientation=vertical&safesearch=true`
        + `&per_page=8&order=relevant`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) {
          console.warn(`[media] Pixabay ${res.status} for "${searchQuery}"`);
          return [];
        }

        const data = await res.json();
        return Array.isArray(data?.hits) ? data.hits : [];
      } catch (err) {
        console.warn(`[media] Pixabay search failed for "${searchQuery}": ${err.message}`);
        return [];
      }
    }

    let results = await search(q);

    if (!results.length) {
      const subject = q.split(/\s+/).slice(0, 2).join(" ");
      if (subject && subject !== q) {
        console.log(`[media] Pixabay: "${q}" had 0 hits — retrying subject "${subject}"`);
        results = await search(subject);
      }
    }

    if (!results.length) return null;

    const pick = results[0];
    const imageUrl = pick?.webformatURL || pick?.largeImageURL;

    if (imageUrl) {
      console.log(`[media] Pixabay ✓ "${q}" → ${pick?.user || "unknown"}`);
      return imageUrl;
    }

    return null;
  }

  // ─── PROVIDER DISPATCH: VIDEO (future) ────────────────────────────────────

  async function fetchPexelsVideo(q) {
    if (!PEXELS_KEY) return null;

    async function search(searchQuery) {
      const url = `https://api.pexels.com/v1/videos/search`
        + `?query=${encodeURIComponent(searchQuery)}`
        + `&orientation=portrait&per_page=8&size=medium`;

      try {
        const res = await fetch(url, {
          headers: { Authorization: PEXELS_KEY },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) {
          console.warn(`[media] Pexels Video ${res.status} for "${searchQuery}"`);
          return [];
        }

        const data = await res.json();
        return Array.isArray(data?.videos) ? data.videos : [];
      } catch (err) {
        console.warn(`[media] Pexels Video search failed for "${searchQuery}": ${err.message}`);
        return [];
      }
    }

    let results = await search(q);

    if (!results.length) {
      const subject = q.split(/\s+/).slice(0, 2).join(" ");
      if (subject && subject !== q) {
        console.log(`[media] Pexels Video: "${q}" had 0 hits — retrying subject "${subject}"`);
        results = await search(subject);
      }
    }

    if (!results.length) return null;

    const pick = results[0];
    const videoFile = pick?.video_files?.find(
      (f) => f.quality === "hd" && f.width <= 1080
    ) || pick?.video_files?.[0];

    const videoUrl = videoFile?.link;

    if (videoUrl) {
      console.log(`[media] Pexels Video ✓ "${q}" → ${pick?.user?.name || "unknown"}`);
      return videoUrl;
    }

    return null;
  }

  // ─── PIPELINE ORCHESTRATION ───────────────────────────────────────────────

  if (type === "video") {
    const pexelsVideo = await fetchPexelsVideo(query);
    if (pexelsVideo) return pexelsVideo;

    console.warn(`[media] All video providers exhausted for "${query}" — returning null`);
    return null;
  }

  // type === "image" — waterfall through providers
  const pexelsImage = await fetchPexelsImage(query);
  if (pexelsImage) return pexelsImage;

  const unsplashImage = await fetchUnsplashImage(query);
  if (unsplashImage) return unsplashImage;

  const pixabayImage = await fetchPixabayImage(query);
  if (pixabayImage) return pixabayImage;

  console.warn(`[media] All image providers exhausted for "${query}" — returning null`);
  return null;
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
 */
function injectVariables(html, beat, palette, brand, imageUrl) {
  const layout   = beat.layout || sceneJson.layout || 'left';
  const camDur   = ((beat.duration_ms || 5000) / 1000).toFixed(2) + 's';
  const beatIdx  = String(beat.beat_index  || '').padStart(2, '0');
  const beatTot  = String(beat.beat_total  || '').padStart(2, '0');

  const bgImageValue = imageUrl
    ? `url("${imageUrl.replace(/"/g, '%22')}")`
    : 'none';

  const szKw = (beat.sz_kw ? beat.sz_kw + 'px' : null);

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
    ...(szKw ? ['  --sz-kw:    ' + szKw + ';'] : []),
    '}',
    ...(szKw ? [
      '</style>',
      '<style id="sz-kw-override">',
      '[class$="-kw"] { font-size: var(--sz-kw) !important; }',
    ] : []),
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

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE_SCRIPT — injected via addInitScript, runs before page load.
//
// KEY CHANGE v3.2: background image applied to .depth-bg, not .scene.
//
// Why this matters:
//   camera.css animates .depth-bg with scale/translate transforms.
//   If backgroundImage lives on .scene, the animated .depth-bg is an
//   empty transparent div — scaling it changes nothing visible.
//   Moving the image to .depth-bg means the CSS scale(1.06→1.18) directly
//   zooms the image, producing real visible camera motion on screen.
//
//   inject.js creates .depth-bg synchronously as an inline <script>
//   in <body>, which runs before DOMContentLoaded. So .depth-bg
//   always exists when this listener fires.
// ─────────────────────────────────────────────────────────────────────────────
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

        // ── v3.2 FIX: target .depth-bg, not .scene ──────────────────────
        // camera.css runs scale/translate on .depth-bg. The background must
        // live on the same element that animates, otherwise the camera motion
        // scales an empty transparent div and nothing visible moves.
        //
        // inject.js creates .depth-bg before DOMContentLoaded so it always
        // exists here. Fall back to .scene only if depth planes are absent.
        //const depthBg = scene.querySelector('.depth-bg') || scene;
        const depthBg = scene.querySelector('.depth-bg > .life-layer')
                || scene.querySelector('.depth-bg') || scene;

        //const scrim = 'linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.85))';
        //const scrim = 'linear-gradient(rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.80) 40%, rgba(0,0,0,0.80) 60%, rgba(0,0,0,0.92) 100%)';
        const scrim = 'linear-gradient(rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.78) 100%)';
        depthBg.style.backgroundImage    = scrim + ', ' + bgImage;
        depthBg.style.backgroundSize     = 'cover, cover';
        depthBg.style.backgroundPosition = 'center center, center center';

        // Ensure .scene shows its theme background-color on beats without
        // an image, and as the base colour visible around any scale overflow.
        scene.style.backgroundColor = 'var(--bg, #09090b)';

        console.log('[PAUSE_SCRIPT] background image applied to .depth-bg');
      };

      if (src) {
        const img = new Image();
        img.onload  = applyBg;
        img.onerror = applyBg;
        img.src = src;
      } else {
        applyBg();
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

  await page.goto(`file://${tmpHtml}`, { waitUntil: 'domcontentloaded', timeout: 15000 });

  if (imageUrl) {
    try {
      await page.waitForFunction(
        (src) => {
          return new Promise((resolve) => {
            const img = new Image();
            img.onload  = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
            img.onerror = () => resolve(false);
            img.src = src;
          });
        },
        imageUrl,
        { timeout: 12000 }
      );
    } catch (err) {
      console.warn(`[capture] Beat ${beatIdx}: bg image wait timed out (${err.message}) — proceeding without background`);
    }
  } else {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

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
    activeIndices.map(i => fetchMediaAsset(beats[i].visual_query || '', "image"))
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
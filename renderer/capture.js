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

/**
 * Wrap each word of the keyword in a <span class="kw-word"> so the
 * animated underline (entries.css .kw-word::after) can stagger per word.
 * Input:  "STOP WASTING TIME"
 * Output: '<span class="kw-word">STOP</span> <span class="kw-word">WASTING</span> ...'
 */
function wrapKeywordWords(keyword) {
  if (!keyword) return '';
  return keyword
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `<span class="kw-word">${escapeHtml(w)}</span>`)
    .join(' ');
}

/**
 * Split body text into sentence-based lines and wrap each in a
 * <span class="body-line"> for staggered entry animation.
 *
 * Split strategy:
 *   - Split on sentence-ending punctuation (. ! ?) followed by whitespace
 *   - Preserve the punctuation on the preceding token
 *   - Collapse any fragments under 4 words into the previous line
 *     (avoids orphan words on their own line)
 * At most 3 lines — longer text stays as 1 block to avoid layout issues.
 */
function wrapBodyLines(body) {
  if (!body) return '';

  // Split on sentence boundaries while keeping the punctuation
  const raw = body.split(/(?<=[.!?])\s+/).filter(Boolean);

  // If only 1 sentence or splitting would create too many lines, keep as-is
  if (raw.length <= 1 || raw.length > 3) {
    return `<span class="body-line">${escapeHtml(body)}</span>`;
  }

  // Merge any fragment under 4 words into the previous line
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

function injectVariables(html, beat, palette, brand) {
  const layout   = beat.layout || sceneJson.layout || 'left';
  const camDur   = ((beat.duration_ms || 5000) / 1000).toFixed(2) + 's';
  const beatIdx  = String(beat.beat_index  || '').padStart(2, '0');
  const beatTot  = String(beat.beat_total  || '').padStart(2, '0');

  // CSS vars
  const cssVars = [
    '<style id="palette-inject">',
    ':root {',
    '  --acc:      ' + palette.accent + ';',
    '  --spike:    ' + palette.spike  + ';',
    '  --bg:       ' + palette.bg     + ';',
    '  --fg:       ' + palette.fg     + ';',
    '  --beat-dur: ' + beat.duration_ms + 'ms;',
    '  --cam-dur:  ' + camDur + ';',
    '}',
    '</style>',
  ].join('\n');

  const beatJson   = JSON.stringify(beat).replace(/<\/script>/gi, '<\\/script>');
  const beatScript = '<script id="beat-data">window.__BEAT__ = ' + beatJson + ';</scri' + 'pt>';
  const themeLink  = '<link rel="stylesheet" href="../themes/' + sceneJson.theme + '.css">';

  html = html.replace('</head>', themeLink + '\n' + cssVars + '\n' + beatScript + '\n</head>');

  // Text content replacements
  // {{KEYWORD}} → word-wrapped spans for underline animation
  // {{BODY}}    → sentence-split spans for line stagger
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
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation-play-state: paused !important; }';
    document.head.appendChild(style);
  }, { once: true });
`;

async function seekAnimations(page, t_ms) {
  await page.evaluate((t) => {
    document.getAnimations().forEach(anim => { anim.currentTime = t; });
  }, t_ms);
}

async function renderBeat(browser, beat, beatIdx, palette, brand) {
  const beatOutDir = join(outDir, `beat_${beatIdx}`);
  mkdirSync(beatOutDir, { recursive: true });

  const html    = injectVariables(loadTemplate(beat.scene), beat, palette, brand);
  const tmpHtml = join(beatOutDir, '_scene.html');
  writeFileSync(tmpHtml, html, 'utf8');

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(PAUSE_SCRIPT);

  const page = await context.newPage();
  await page.goto(`file://${tmpHtml}`, { waitUntil: 'domcontentloaded' });
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
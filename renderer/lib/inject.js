/**
 * inject.js  --  Runtime beat-data injector
 *
 * Reads window.__BEAT__ and applies all per-beat styling.
 *
 * TIMING CONSTRAINT:
 * capture.js injects PAUSE_SCRIPT via addInitScript — fires at
 * DOMContentLoaded and sets animation-play-state: paused !important.
 * inject.js is an inline <script> at the bottom of <body>, which runs
 * SYNCHRONOUSLY before DOMContentLoaded, so styles applied here take
 * effect before animations are paused. This is the correct window for
 * setting animation-duration/delay and CSS custom properties.
 *
 * Steps:
 *   1.  Camera class + --cam-dur
 *   2.  Background variant class
 *   3.  Emotion tint class
 *   4.  Transition classes (dip_black / flash / slam_cut → chroma)
 *   5.  Pace scaling (animation duration + delay multiplier)
 *   6.  Spike accent override (deferred to after step 13)
 *   7.  Ambient particles injection
 *   8.  Keyword idle pulse delay (--kw-settle-delay) + .kw-pulse class
 *   9.  Keyword word-index vars for staggered underlines
 *   10. Body line stagger delays + parent animation suppression
 *   11. [Phase 4] Energy-driven vignette intensity (--vignette-strength)
 *   12. [Phase 4] Pace-driven keyword letter-spacing
 *   13. [Phase 4] Scene-type accent colour identity shift (filter)
 *   14. [Phase 4] Emotion-driven grain opacity (--grain-opacity)
 */

(function () {
  const beat = window.__BEAT__;
  if (!beat) return;

  const scene = document.querySelector('.scene');
  if (!scene) return;

  // ── 1. Camera class + duration var ──────────────────────────────
  const CAMERA_MAP = {
    static:      'cam-static',
    push_in:     'cam-push-in',
    pull_out:    'cam-pull-out',
    handheld:    'cam-handheld',
    snap_zoom:   'cam-snap-zoom',
    micro_shake: 'cam-micro-shake',
    tilt_up:     'cam-tilt-up',
  };
  scene.classList.add(CAMERA_MAP[beat.camera] || 'cam-static');
  scene.style.setProperty('--cam-dur', (beat.duration_ms / 1000).toFixed(2) + 's');

  // ── 2. Background variant ────────────────────────────────────────
  const BG_MAP = {
    solid:    'bg-solid',
    gradient: 'bg-gradient',
    noise:    'bg-noise',
    grid:     'bg-grid',
    glow:     'bg-glow',
    lines:    'bg-lines',
    abstract: 'bg-abstract',
  };
  scene.classList.add(BG_MAP[beat.background] || 'bg-solid');

  // ── 3. Emotion tint ──────────────────────────────────────────────
  const EMOTION_MAP = {
    urgent:      'tint-urgent',
    tense:       'tint-tense',
    hopeful:     'tint-hopeful',
    melancholic: 'tint-melancholic',
    angry:       'tint-angry',
    cold:        'tint-cold',
    confident:   'tint-confident',
    anxious:     'tint-anxious',
    serious:     'tint-serious',
  };
  if (beat.emotion && EMOTION_MAP[beat.emotion]) {
    scene.classList.add(EMOTION_MAP[beat.emotion]);
  }

  // ── 4. Transition classes ────────────────────────────────────────
  if (beat.transition) {
    scene.dataset.transition = beat.transition;
    if (beat.transition === 'dip_black')                               scene.classList.add('trans-dip-black');
    if (beat.transition === 'flash')                                   scene.classList.add('trans-flash');
    if (beat.transition === 'slam_cut' || beat.transition === 'flash') scene.classList.add('trans-chroma');
  }

  // ── 5. Pace scaling ──────────────────────────────────────────────
  const PACE_MULT = { slow: 1.45, mid: 1.00, fast: 0.70, explosive: 0.45 };
  const mult = PACE_MULT[beat.pace] ?? 1.0;
  scene.style.setProperty('--pace-mult', String(mult));

  if (mult !== 1.0) {
    function scaleTimes(str) {
      if (!str || str === 'none') return str;
      return str.split(',').map(function(s) {
        s = s.trim();
        if (!s || s === '0s' || s === '0ms') return s;
        var v = parseFloat(s);
        if (isNaN(v)) return s;
        if (s.endsWith('ms')) v /= 1000;
        return (v * mult).toFixed(3) + 's';
      }).join(', ');
    }
    scene.querySelectorAll('*').forEach(function(el) {
      var cs    = window.getComputedStyle(el);
      var dur   = cs.animationDuration;
      var delay = cs.animationDelay;
      if (dur   && dur   !== '0s' && dur   !== 'none') { var s = scaleTimes(dur);   if (s !== dur)   el.style.animationDuration = s; }
      if (delay && delay !== '0s' && delay !== '0ms')  { var d = scaleTimes(delay); if (d !== delay) el.style.animationDelay    = d; }
    });
  }

  // ── 6. Spike override deferred — runs after step 13 ─────────────
  var applySpike = beat.accent_override === 'spike';

  // ── 7. Ambient particles ─────────────────────────────────────────
  if (!scene.querySelector('.ambient-particles')) {
    var p = document.createElement('div');
    p.className = 'ambient-particles';
    p.setAttribute('aria-hidden', 'true');
    scene.insertBefore(p, scene.firstChild);
  }

  // ── 8. Keyword idle pulse ────────────────────────────────────────
  var SETTLE_DELAYS = {
    hook: '1.1s', insight: '0.9s', climax: '1.4s', tension: '1.5s',
    truth: '0.9s', flip: '1.6s', payoff: '1.4s', cta: '0.9s',
  };
  scene.style.setProperty('--kw-settle-delay', SETTLE_DELAYS[beat.scene] || '1.2s');

  var KW_SELECTORS = [
    '.hook-kw', '.insight-kw', '.climax-kw', '.cta-kw',
    '.tension-kw', '.truth-kw', '.flip-kw', '.payoff-kw',
  ];
  KW_SELECTORS.forEach(function(sel) {
    var el = scene.querySelector(sel);
    if (el) el.classList.add('kw-pulse');
  });

  // ── 9. Word-index vars for staggered underlines ──────────────────
  scene.querySelectorAll('.kw-word').forEach(function(span, i) {
    span.style.setProperty('--word-index', String(i));
  });

  // ── 10. Body line stagger delays ─────────────────────────────────
  var BODY_BASE_DELAYS = {
    hook: 1.05, insight: 1.10, climax: 1.35, tension: 1.50,
    truth: 1.15, flip: 1.55, payoff: 1.65, cta: 0.95,
  };
  var baseDelay = (BODY_BASE_DELAYS[beat.scene] || 1.1) * mult;
  var staggerMs = 0.08 * mult;
  scene.style.setProperty('--body-line-1-delay', baseDelay.toFixed(3) + 's');
  scene.style.setProperty('--body-line-2-delay', (baseDelay + staggerMs).toFixed(3) + 's');
  scene.style.setProperty('--body-line-3-delay', (baseDelay + staggerMs * 2).toFixed(3) + 's');

  var BODY_SELECTORS = [
    '.hook-body', '.insight-body', '.climax-body', '.cta-body',
    '.tension-body', '.truth-body', '.flip-body', '.payoff-body',
  ];
  BODY_SELECTORS.forEach(function(sel) {
    var el = scene.querySelector(sel);
    if (el) { el.style.animationName = 'none'; el.style.opacity = '1'; }
  });

  // ── 11. Energy-driven vignette intensity ─────────────────────────
  // --vignette-strength multiplies all vignette opacity stops in
  // _base.html via calc(). Default 1.0 = designed baseline.
  // Scene-type overrides take precedence over energy field.
  var VIGNETTE_BY_ENERGY = { high: 1.30, mid: 1.00, low: 0.72 };
  var VIGNETTE_BY_SCENE  = {
    payoff: 0.68, tension: 1.35, climax: 1.25, hook: 1.10,
  };
  var vigStrength = VIGNETTE_BY_ENERGY[beat.energy] != null
    ? VIGNETTE_BY_ENERGY[beat.energy]
    : 1.0;
  if (VIGNETTE_BY_SCENE[beat.scene] != null) {
    vigStrength = VIGNETTE_BY_SCENE[beat.scene];
  }
  scene.style.setProperty('--vignette-strength', vigStrength.toFixed(2));

  // ── 12. Pace-driven keyword letter-spacing ────────────────────────
  // null = use scene CSS default (mid pace — no override needed).
  // Applied directly to element.style so it overrides any stylesheet value.
  var TRACKING_BY_PACE = {
    slow:      '-0.030em',
    mid:       null,
    fast:      '-0.060em',
    explosive: '-0.075em',
  };
  var tracking = TRACKING_BY_PACE[beat.pace];
  if (tracking !== null && tracking !== undefined) {
    KW_SELECTORS.forEach(function(sel) {
      var el = scene.querySelector(sel);
      if (el) el.style.letterSpacing = tracking;
    });
  }

  // ── 13. Scene-type accent colour identity ─────────────────────────
  // Applies a CSS filter to structural accent elements (rules, eyebrows,
  // arrows) rather than overriding --acc itself — this preserves the
  // oklch(from var(--acc) ...) relative colour functions used in glows.
  //
  // tension: cooler hue + desaturated — unease without aggression
  // flip:    brighter — the reframe should feel clean and sudden
  // payoff:  warmer golden shift — earned, human
  var ACCENT_FILTER_BY_SCENE = {
    tension: 'hue-rotate(15deg) saturate(0.80)',
    flip:    'brightness(1.12)',
    payoff:  'hue-rotate(-12deg) brightness(1.08)',
  };
  var accentFilter = ACCENT_FILTER_BY_SCENE[beat.scene];
  if (accentFilter) {
    scene.querySelectorAll(
      '.rule-left, [class$="-rule"], .cta-follow-eyebrow, .truth-eyebrow, .flip-arrow'
    ).forEach(function(el) {
      el.style.filter = accentFilter;
    });
  }

  // Spike override executes last — always wins over scene identity shift
  if (applySpike) {
    scene.style.setProperty('--acc', 'var(--spike)');
  }

  // ── 14. Emotion-driven grain opacity ─────────────────────────────
  // overlays.css .grain reads: opacity: var(--grain-opacity, 0.038)
  // Scene-type overrides take precedence over emotion value.
  // Range: 0.018 (payoff/cleanest) → 0.058 (angry/grittiest).
  var GRAIN_BY_EMOTION = {
    urgent: 0.055, angry: 0.058, anxious: 0.050, tense: 0.048,
    hopeful: 0.040, confident: 0.036,
    melancholic: 0.032, cold: 0.028, serious: 0.026,
  };
  var GRAIN_BY_SCENE = {
    payoff: 0.018, truth: 0.024, climax: 0.050, tension: 0.052,
  };
  var grainOpacity = GRAIN_BY_EMOTION[beat.emotion] != null
    ? GRAIN_BY_EMOTION[beat.emotion]
    : 0.038;
  if (GRAIN_BY_SCENE[beat.scene] != null) {
    grainOpacity = GRAIN_BY_SCENE[beat.scene];
  }
  scene.style.setProperty('--grain-opacity', grainOpacity.toFixed(3));

  // ── 15. Motion carry — inherit direction from previous beat ──
// scene.json beats now optionally carry:
//   entry_vector: { x: 12, y: -8, scale: 1.02 }
// Python emits this as `prev_beat.exit_vector` rebadged for the next beat.
// Default: { x:0, y:0, scale:1 } — no carry, hard cut as before.
var entry = beat.entry_vector || { x:0, y:0, scale:1 };
if (entry.x || entry.y || entry.scale !== 1) {
  scene.style.setProperty('--carry-x', entry.x + 'px');
  scene.style.setProperty('--carry-y', entry.y + 'px');
  scene.style.setProperty('--carry-scale', String(entry.scale));
  scene.classList.add('with-carry');
}

// ── 16. Pace data-attr (drives overshoot magnitude in CSS) ──
if (beat.pace) scene.dataset.pace = beat.pace;

// ── 17. Per-element micro-stagger ────────────────────────
// Adds a hash-derived 0-40ms jitter to each animated element's
// delay so three sibling animations never land on the same frame.
// Deterministic from element index — same hash every render. */
function microStagger(idx) {
  // fibonacci-ish offsets in ms, looping every 5
  return [0, 13, 21, 34, 28][idx % 5] / 1000;
}
['.kw-word', '.body-line'].forEach(function(sel) {
  scene.querySelectorAll(sel).forEach(function(el, i) {
    var cs = getComputedStyle(el);
    var base = parseFloat(cs.animationDelay) || 0;
    el.style.animationDelay = (base + microStagger(i)).toFixed(3) + 's';
  });
});

// ── 18. Emit exit_vector AFTER capture loop ──────────────
// capture.js reads document.body.dataset.exitVector at end of
// beat capture and writes it into manifest.json so the Python
// orchestrator can pass it as the NEXT beat's entry_vector.
// (We don't move anything here — Python owns the handoff.) */
var exitVec = {
  x: beat.camera === 'push_in' ? -6 : beat.camera === 'pull_out' ? 8  : 0,
  y: beat.camera === 'tilt_up' ? -12 : beat.camera === 'push_in' ? -10 : 0,
  scale: beat.camera === 'push_in' ? 1.04 : 1
};
document.body.dataset.exitVector = JSON.stringify(exitVec);

})();
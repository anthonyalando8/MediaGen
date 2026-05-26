/**
 * inject.js  --  Runtime beat-data injector (cinematic v2)
 *
 * Reads window.__BEAT__ and applies all per-beat styling.
 *
 * SEEK-RENDERING CONTRAINT:
 *   capture.js injects PAUSE_SCRIPT via addInitScript — pauses all
 *   animations at DOMContentLoaded. inject.js runs SYNCHRONOUSLY before
 *   DOMContentLoaded (inline <script> in <body>), so styles set here
 *   apply before any animation runs.
 *
 * Steps:
 *   1.  Camera class + --cam-dur
 *   2.  Background variant class
 *   3.  Emotion tint class
 *   4.  Transition classes
 *   5.  Pace scaling
 *   6.  Spike accent override (deferred to step 13)
 *   7.  Ambient particles + god-ray injection
 *   8.  Keyword idle pulse delay + .kw-pulse class
 *   9.  Keyword word-index vars
 *   10. Body line stagger delays + parent animation suppression
 *   11. Energy-driven vignette intensity
 *   12. Pace-driven keyword letter-spacing
 *   13. Scene-type accent identity (filter)
 *   14. Emotion-driven grain opacity
 *   15. [NEW v2] Motion-carry entry_vector
 *   16. [NEW v2] data-pace attr (drives overshoot magnitude)
 *   17. [NEW v2] Per-element micro-stagger
 *   18. [NEW v2] Emit exit_vector for next beat
 *   19. [NEW v2] Auto-wrap into depth planes (.depth-bg/mid/fg)
 *   20. [NEW v2] Camera-style global (handheld layer for whole video)
 */

(function () {
  var beat = window.__BEAT__;
  if (!beat) return;

  var scene = document.querySelector('.scene');
  if (!scene) return;

  // ── 19. AUTO-WRAP INTO DEPTH PLANES (runs FIRST so all later steps
  //       can target .depth-mid / .depth-fg directly) ──────────────────
  //
  // The scene HTML files keep their existing flat structure. We restructure
  // them at runtime so authoring stays simple. The wrap order matters —
  // depth-bg → depth-mid → depth-fg → chrome — so z-index works.
  //
  // Classification rules:
  //   - bg layer:   class ends in -bg / -light / -ambient-glow / -glow
  //   - chrome:     rule-left, scene-label, brand, beat-counter, grain,
  //                 vignette, tension-stress, ambient-particles, ambient-ray
  //                 → stays at .scene level (z-index baked in)
  //   - everything else → .depth-fg (text, content blocks)
  //
  // .depth-mid is created empty here. Particles + god-ray are inserted
  // into it by step 7 below.
  (function autoWrapDepth() {
    if (scene.querySelector('.depth-fg')) return;  // already wrapped, skip

    var bgPattern     = /-bg$|-light$|-ambient-glow$|-glow$/;
    var chromeClasses = [
      'rule-left', 'scene-label', 'brand', 'beat-counter',
      'grain', 'vignette', 'tension-stress',
      'ambient-particles', 'ambient-ray',
    ];

    var depthBg  = document.createElement('div'); depthBg.className  = 'depth-bg';
    var depthMid = document.createElement('div'); depthMid.className = 'depth-mid';
    var depthFg  = document.createElement('div'); depthFg.className  = 'depth-fg';

    var children = Array.prototype.slice.call(scene.children);
    children.forEach(function (child) {
      var cls = (child.className || '').toString();
      var firstCls = cls.split(/\s+/)[0];

      if (chromeClasses.indexOf(firstCls) !== -1) return;        // chrome stays
      if (bgPattern.test(cls))                    depthBg.appendChild(child);
      else                                         depthFg.appendChild(child);
    });

    // Insert in z-order: bg first, then mid (empty), then fg
    scene.insertBefore(depthFg,  scene.firstChild);
    scene.insertBefore(depthMid, scene.firstChild);
    scene.insertBefore(depthBg,  scene.firstChild);
  })();

  // ── 1. Camera class + duration var ──────────────────────────────
  var CAMERA_MAP = {
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
  var BG_MAP = {
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
  var EMOTION_MAP = {
    urgent:'tint-urgent', tense:'tint-tense', hopeful:'tint-hopeful',
    melancholic:'tint-melancholic', angry:'tint-angry', cold:'tint-cold',
    confident:'tint-confident', anxious:'tint-anxious', serious:'tint-serious',
    playful:'tint-hopeful', amused:'tint-hopeful', surprised:'tint-confident',
  };
  if (beat.emotion && EMOTION_MAP[beat.emotion]) {
    scene.classList.add(EMOTION_MAP[beat.emotion]);
  }

  // ── 4. Transition classes ────────────────────────────────────────
  if (beat.transition) {
    scene.dataset.transition = beat.transition;
    if (beat.transition === 'dip_black') scene.classList.add('trans-dip-black');
    if (beat.transition === 'flash')     scene.classList.add('trans-flash');
    if (beat.transition === 'slam_cut' || beat.transition === 'flash') {
      scene.classList.add('trans-chroma');
    }
  }

  // ── 5. Pace scaling ──────────────────────────────────────────────
  var PACE_MULT = { slow: 1.45, mid: 1.00, fast: 0.70, explosive: 0.45 };
  var mult = PACE_MULT[beat.pace] != null ? PACE_MULT[beat.pace] : 1.0;
  scene.style.setProperty('--pace-mult', String(mult));

  if (mult !== 1.0) {
    function scaleTimes(str) {
      if (!str || str === 'none') return str;
      return str.split(',').map(function (s) {
        s = s.trim();
        if (!s || s === '0s' || s === '0ms') return s;
        var v = parseFloat(s);
        if (isNaN(v)) return s;
        if (s.endsWith('ms')) v /= 1000;
        return (v * mult).toFixed(3) + 's';
      }).join(', ');
    }
    scene.querySelectorAll('*').forEach(function (el) {
      var cs    = window.getComputedStyle(el);
      var dur   = cs.animationDuration;
      var delay = cs.animationDelay;
      if (dur   && dur   !== '0s' && dur   !== 'none') {
        var s = scaleTimes(dur);   if (s !== dur)   el.style.animationDuration = s;
      }
      if (delay && delay !== '0s' && delay !== '0ms') {
        var d = scaleTimes(delay); if (d !== delay) el.style.animationDelay = d;
      }
    });
  }

  // ── 6. Spike override (deferred — runs after step 13) ───────────
  var applySpike = beat.accent_override === 'spike';

  // ── 7. Ambient particles + god-ray (target .depth-mid if present) ─
  var midLayer = scene.querySelector('.depth-mid') || scene;

  if (!scene.querySelector('.ambient-particles')) {
    var p = document.createElement('div');
    p.className = 'ambient-particles';
    p.setAttribute('aria-hidden', 'true');
    midLayer.appendChild(p);
  }

  // God-ray sweep: only for high-energy beats (motivated lighting).
  // One pass per beat, deterministic — see motion/camera.css.
  if (beat.energy === 'high' || beat.pace === 'explosive' || beat.scene === 'climax') {
    if (!scene.querySelector('.ambient-ray')) {
      var r = document.createElement('div');
      r.className = 'ambient-ray';
      r.setAttribute('aria-hidden', 'true');
      midLayer.appendChild(r);
    }
  }

  // ── 8. Keyword idle pulse ────────────────────────────────────────
  var SETTLE_DELAYS = {
    hook:'1.1s', insight:'0.9s', climax:'1.4s', tension:'1.5s',
    truth:'0.9s', flip:'1.6s', payoff:'1.4s', cta:'0.9s',
  };
  var KW_ENTRY_BASE = {
    hook:'0.28s', insight:'0.35s', climax:'0.20s', tension:'0.40s',
    truth:'0.32s', flip:'0.30s', payoff:'0.38s', cta:'0.28s',
  };
  scene.style.setProperty('--kw-settle-delay', SETTLE_DELAYS[beat.scene] || '1.2s');
  scene.style.setProperty('--kw-entry-base',   KW_ENTRY_BASE[beat.scene]  || '0.42s');

  var KW_SELECTORS = [
    '.hook-kw', '.insight-kw', '.climax-kw', '.cta-kw',
    '.tension-kw', '.truth-kw', '.flip-kw', '.payoff-kw',
  ];
  KW_SELECTORS.forEach(function (sel) {
    var el = scene.querySelector(sel);
    if (el) el.classList.add('kw-pulse');
  });

  // ── 9. Word-index vars ───────────────────────────────────────────
  scene.querySelectorAll('.kw-word').forEach(function (span, i) {
    span.style.setProperty('--word-index', String(i));
  });

  // ── 10. Body line stagger delays ─────────────────────────────────
  var BODY_BASE_DELAYS = {
    hook:1.05, insight:1.10, climax:1.35, tension:1.50,
    truth:1.15, flip:1.55, payoff:1.65, cta:0.95,
  };
  var baseDelay = (BODY_BASE_DELAYS[beat.scene] || 1.1) * mult;
  var staggerMs = 0.16 * mult;        // bumped from 0.08 → 0.16 for better readability
  scene.style.setProperty('--body-line-1-delay', baseDelay.toFixed(3) + 's');
  scene.style.setProperty('--body-line-2-delay', (baseDelay + staggerMs).toFixed(3) + 's');
  scene.style.setProperty('--body-line-3-delay', (baseDelay + staggerMs * 2).toFixed(3) + 's');

  var BODY_SELECTORS = [
    '.hook-body', '.insight-body', '.climax-body', '.cta-body',
    '.tension-body', '.truth-body', '.flip-body', '.payoff-body',
  ];
  BODY_SELECTORS.forEach(function (sel) {
    var el = scene.querySelector(sel);
    if (el) { el.style.animationName = 'none'; el.style.opacity = '1'; }
  });

  // ── 11. Energy-driven vignette intensity ─────────────────────────
  var VIG_BY_ENERGY = { high: 1.30, mid: 1.00, low: 0.72 };
  var VIG_BY_SCENE  = { payoff: 0.68, tension: 1.35, climax: 1.25, hook: 1.10 };
  var vigStrength = VIG_BY_ENERGY[beat.energy] != null ? VIG_BY_ENERGY[beat.energy] : 1.0;
  if (VIG_BY_SCENE[beat.scene] != null) vigStrength = VIG_BY_SCENE[beat.scene];
  scene.style.setProperty('--vignette-strength', vigStrength.toFixed(2));

  // ── 12. Pace-driven keyword letter-spacing ───────────────────────
  var TRACKING_BY_PACE = {
    slow: '-0.030em', mid: null, fast: '-0.060em', explosive: '-0.075em',
  };
  var tracking = TRACKING_BY_PACE[beat.pace];
  if (tracking !== null && tracking !== undefined) {
    KW_SELECTORS.forEach(function (sel) {
      var el = scene.querySelector(sel);
      if (el) el.style.letterSpacing = tracking;
    });
  }

  // ── 13. Scene-type accent identity ───────────────────────────────
  var ACCENT_FILTER_BY_SCENE = {
    tension: 'hue-rotate(15deg) saturate(0.80)',
    flip:    'brightness(1.12)',
    payoff:  'hue-rotate(-12deg) brightness(1.08)',
  };
  var accentFilter = ACCENT_FILTER_BY_SCENE[beat.scene];
  if (accentFilter) {
    scene.querySelectorAll(
      '.rule-left, [class$="-rule"], .cta-follow-eyebrow, .truth-eyebrow, .flip-arrow'
    ).forEach(function (el) { el.style.filter = accentFilter; });
  }

  if (applySpike) scene.style.setProperty('--acc', 'var(--spike)');

  // ── 14. Emotion-driven grain opacity ─────────────────────────────
  var GRAIN_BY_EMOTION = {
    urgent: 0.055, angry: 0.058, anxious: 0.050, tense: 0.048,
    hopeful: 0.040, confident: 0.036, melancholic: 0.032,
    cold: 0.028, serious: 0.026, playful: 0.038, amused: 0.038, surprised: 0.045,
  };
  var GRAIN_BY_SCENE = { payoff: 0.018, truth: 0.024, climax: 0.050, tension: 0.052 };
  var grainOpacity = GRAIN_BY_EMOTION[beat.emotion] != null ? GRAIN_BY_EMOTION[beat.emotion] : 0.038;
  if (GRAIN_BY_SCENE[beat.scene] != null) grainOpacity = GRAIN_BY_SCENE[beat.scene];
  scene.style.setProperty('--grain-opacity', grainOpacity.toFixed(3));

  // ── 15. Motion carry: inherit direction from previous beat ────────
  var entry = beat.entry_vector || { x: 0, y: 0, scale: 1 };
  if (entry.x || entry.y || entry.scale !== 1) {
    scene.style.setProperty('--carry-x',     entry.x + 'px');
    scene.style.setProperty('--carry-y',     entry.y + 'px');
    scene.style.setProperty('--carry-scale', String(entry.scale));
    scene.classList.add('with-carry');
  }

  // ── 16. Pace data-attr (CSS reads it to scale overshoot magnitude) ─
  if (beat.pace) scene.dataset.pace = beat.pace;

  // ── 17. Per-element micro-stagger ────────────────────────────────
  // Adds a fibonacci-ish 0-40ms jitter so sibling animations never
  // land on the exact same frame. Deterministic from index.
  //
  // SEEK-SAFE: .kw-word uses duration-based stagger (not delay).
  // Setting animationDelay on .kw-word would put it in IDLE state,
  // causing document.getAnimations() to skip it and seekAnimations()
  // to never advance it → invisible keyword.
  //
  // For .kw-word: add micro-stagger to animationDuration instead.
  // For .body-line: animationDelay is safe (body-line doesn't use
  // opacity:0 as a base style, so IDLE state shows opacity:1 → visible).
  function microStagger(idx) {
    return [0, 13, 21, 34, 28][idx % 5] / 1000;
  }

  // .kw-word: stagger via duration (delay=0 stays, Active state preserved)
  scene.querySelectorAll('.kw-word').forEach(function (el, i) {
    var cs  = window.getComputedStyle(el);
    var dur = parseFloat(cs.animationDuration) || 0.78;
    el.style.animationDuration = (dur + microStagger(i)).toFixed(3) + 's';
  });

  // .body-line: delay-based stagger is safe (no opacity:0 base state issue)
  scene.querySelectorAll('.body-line').forEach(function (el, i) {
    var cs   = window.getComputedStyle(el);
    var base = parseFloat(cs.animationDelay) || 0;
    el.style.animationDelay = (base + microStagger(i)).toFixed(3) + 's';
  });

  // ── 18. Emit exit_vector for next beat's entry_vector ────────────
  var exitVec = {
    x:     beat.camera === 'push_in' ? -6 : beat.camera === 'pull_out' ?  8 : 0,
    y:     beat.camera === 'tilt_up' ? -12 : beat.camera === 'push_in' ? -10 : 0,
    scale: beat.camera === 'push_in' ? 1.04 : 1.0,
  };
  document.body.dataset.exitVector = JSON.stringify(exitVec);

  // ── 20. Camera-style global (whole-video bias) ───────────────────
  // window.__BEAT__.camera_style is the script's global.camera_style.
  // Adds a body data attribute the runtime can hook into for global
  // handheld layering or extra dynamic motion on every beat.
  if (beat.camera_style) {
    document.body.dataset.cameraStyle = beat.camera_style;
    // For "handheld": layer micro-shake onto .depth-mid additively
    // regardless of the per-beat camera (subtle, not stacked too hard).
    if (beat.camera_style === 'handheld') {
      scene.classList.add('cam-handheld-layer');
    }
  }


  // ── 21. INTENSITY — master magnitude dial ──────────────────────
// beat.intensity ∈ [0, 1]. Sets a CSS var every retention rule reads.
// Default 0.65 if missing — neutral, doesn't accidentally amp anything.
var intensity = typeof beat.intensity === 'number'
  ? Math.max(0, Math.min(1, beat.intensity))
  : 0.65;
scene.style.setProperty('--intensity', intensity.toFixed(3));
if (intensity < 0.60) scene.classList.add('breath');

// ── 22. PATTERN INTERRUPT — one per beat, eligible at intensity > .80
// OR explicit beat.pattern_interrupt. inject.js picks the type and
// schedules it at 45-65% of beat duration (peak attention window). */
var PI_TYPES = ['slam', 'chroma', 'iris', 'tilt', 'flash', 'freeze', 'invert'];
var PI_BY_SCENE = {
  hook:    'slam',
  climax:  'chroma',
  tension: 'iris',
  truth:   'iris',
  flip:    'invert',
  payoff:  'flash',
  cta:     'slam',
};
var pi = beat.pattern_interrupt
  || (intensity >= 0.80 ? PI_BY_SCENE[beat.scene] || 'slam' : null);
if (pi && PI_TYPES.indexOf(pi) !== -1) {
  scene.classList.add('pi-' + pi);
  // Delay = 50% of beat (peak attention window).
  var piDelay = (beat.duration_ms || 5000) * 0.5 / 1000;
  scene.style.setProperty('--pi-delay', piDelay.toFixed(2) + 's');
}

// ── 23. EMPHASIS WORDS — time per-word punch to body line entry
// capture.js wraps *foo* as <span class="em">foo</span>.
// Each .em gets a CSS var --em-delay = body line entry + 0.42s,
// so the punch lands on the spoken word (≈ syllable 2 of the line). */
scene.querySelectorAll('.body-line').forEach(function (line, i) {
  var ems = line.querySelectorAll('.em');
  if (!ems.length) return;
  var base = parseFloat(getComputedStyle(line).animationDelay) || 1.1;
  // Punch on second-syllable timing ≈ 420ms after line entry */
  var emDelay = base + 0.42;
  ems.forEach(function (em, j) {
    // Stagger if multiple emphasis words in the same line. */
    em.style.setProperty('--em-delay', (emDelay + j * 0.25).toFixed(3) + 's');
  });
});

// ── 24. COMPOSITION MUTATOR — optional, opt-in via beat field ──
// beat.composition ∈ ['crop-low', 'tilt', 'corner', 'sparse']
// Applied as .comp-{name} class. CSS handles the override. */
if (beat.composition) {
  scene.classList.add('comp-' + beat.composition);
}

})();
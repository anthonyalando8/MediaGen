/**
 * inject.js  --  Runtime beat-data injector
 *
 * Reads window.__BEAT__ and applies all per-beat styling.
 *
 * TIMING CONSTRAINT:
 * capture.js injects a PAUSE_SCRIPT via addInitScript that runs at
 * DOMContentLoaded and sets animation-play-state: paused !important.
 * inject.js runs as an inline <script> at the bottom of <body>, which
 * executes SYNCHRONOUSLY before DOMContentLoaded fires — so we have a
 * safe window to set inline animation-duration/delay before the pause
 * style is applied.
 *
 * However: computedStyle-based scaling still won't work before layout.
 * Instead we embed the pace multiplier as a CSS custom property and
 * use it directly in keyframe/animation declarations where possible.
 * For elements with fixed durations we scale via a one-time DOM walk
 * using the DECLARED (not computed) style — read from element.style
 * after the stylesheet parses, which happens synchronously.
 *
 * Applies:
 *   1. Camera class + --cam-dur on .scene
 *   2. Background variant class
 *   3. Emotion tint class
 *   4. data-transition attribute
 *   5. --pace-mult CSS var (available to any animation that uses it)
 *   6. Spike accent override
 */

(function () {
  const beat = window.__BEAT__;
  if (!beat) return;

  // Run immediately (synchronous inline script) — DOM is parsed,
  // stylesheets are applied, but DOMContentLoaded has NOT fired yet.
  // This means the PAUSE_SCRIPT hasn't run yet either.
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
  const camClass = CAMERA_MAP[beat.camera] || 'cam-static';
  scene.classList.add(camClass);
  // Set --cam-dur so camera animations match beat duration
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

  // ── 4. Transition data attr ──────────────────────────────────────
  if (beat.transition) {
    scene.dataset.transition = beat.transition;
  }

  // ── 5. Pace scaling ──────────────────────────────────────────────
  // Set --pace-mult for CSS to consume directly.
  // Also do a direct DOM walk to scale animation-duration/delay on
  // all elements. This runs BEFORE the PAUSE_SCRIPT DOMContentLoaded
  // handler, so stylesheets are applied but animations are still running.
  const PACE_MULT = { slow: 1.45, mid: 1.00, fast: 0.70, explosive: 0.45 };
  const mult = PACE_MULT[beat.pace] ?? 1.0;
  scene.style.setProperty('--pace-mult', String(mult));

  if (mult !== 1.0) {
    function scaleTimes(str) {
      if (!str || str === 'none') return str;
      return str.split(',').map(s => {
        s = s.trim();
        if (!s || s === '0s' || s === '0ms') return s;
        let v = parseFloat(s);
        if (isNaN(v)) return s;
        if (s.endsWith('ms')) v /= 1000;
        return (v * mult).toFixed(3) + 's';
      }).join(', ');
    }

    // Use getComputedStyle here — we are in a sync inline script,
    // stylesheets have been parsed, animations are NOT yet paused.
    scene.querySelectorAll('*').forEach(el => {
      const cs = window.getComputedStyle(el);
      const dur   = cs.animationDuration;
      const delay = cs.animationDelay;
      if (dur && dur !== '0s' && dur !== 'none') {
        const scaled = scaleTimes(dur);
        if (scaled !== dur) el.style.animationDuration = scaled;
      }
      if (delay && delay !== '0s' && delay !== '0ms') {
        const scaled = scaleTimes(delay);
        if (scaled !== delay) el.style.animationDelay = scaled;
      }
    });
  }

  // ── 6. Spike accent override ─────────────────────────────────────
  if (beat.accent_override === 'spike') {
    scene.style.setProperty('--acc', 'var(--spike)');
  }
})();

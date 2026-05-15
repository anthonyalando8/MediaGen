/**
 * inject.js  --  Runtime beat-data injector
 *
 * This script is inlined into every rendered scene page by capture.js
 * (via page.addInitScript or a <script> tag at the bottom of _base.html).
 *
 * It reads window.__BEAT__ (set by capture.js before navigation) and:
 *   1. Applies camera class to .scene
 *   2. Applies background variant class to .scene
 *   3. Applies emotion tint class to .scene
 *   4. Sets data-transition on .scene
 *   5. Scales animation timings by pace multiplier
 *   6. Applies accent override (spike) if flagged
 */

(function () {
  const beat = window.__BEAT__;
  if (!beat) return;

  document.addEventListener('DOMContentLoaded', () => {
    const scene = document.querySelector('.scene');
    if (!scene) return;

    // ── 1. Camera class ──────────────────────────────────────────
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

    // ── 2. Background variant ────────────────────────────────────
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

    // ── 3. Emotion tint ──────────────────────────────────────────
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

    // ── 4. Transition data attr ──────────────────────────────────
    if (beat.transition) {
      scene.dataset.transition = beat.transition;
    }

    // ── 5. Pace timing ───────────────────────────────────────────
    const PACE_MULT = {
      slow:      1.45,
      mid:       1.00,
      fast:      0.70,
      explosive: 0.45,
    };
    const mult = PACE_MULT[beat.pace] ?? 1.0;
    if (mult !== 1.0) {
      // Scale all animated elements
      scene.querySelectorAll('*').forEach(el => {
        const cs = window.getComputedStyle(el);
        const dur   = cs.animationDuration;
        const delay = cs.animationDelay;

        function scaleTimes(str) {
          return str.split(',').map(s => {
            s = s.trim();
            let v = parseFloat(s);
            if (s.endsWith('ms')) v /= 1000;
            return (v * mult).toFixed(3) + 's';
          }).join(', ');
        }

        if (dur && dur !== '0s' && dur !== 'none') {
          el.style.animationDuration = scaleTimes(dur);
        }
        if (delay && delay !== '0s') {
          el.style.animationDelay = scaleTimes(delay);
        }
      });
    }

    // ── 6. Spike accent override ─────────────────────────────────
    if (beat.accent_override === 'spike') {
      scene.style.setProperty('--acc', 'var(--spike)');
    }
  });
})();

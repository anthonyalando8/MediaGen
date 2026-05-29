/**
 * inject-life.js  --  v4 PERPETUAL-LIFE layer (companion to inject.js)
 *
 * Runs as a second <script> AFTER inject.js in _base.html:
 *     <script src="../lib/inject.js"></script>
 *     <script src="../lib/inject-life.js"></script>
 *
 * inject.js must run first because this relies on:
 *   - the .depth-bg / .depth-mid / .depth-fg planes it creates (step 19)
 *   - the .ambient-particles / .ambient-ray it appends to .depth-mid (step 7)
 * Both scripts execute synchronously before DOMContentLoaded, so all
 * styling here lands before PAUSE_SCRIPT pauses + capture.js seeks.
 *
 * WHAT IT DOES
 *   25. Wrap each depth plane's children in a .life-layer (so the perpetual
 *       drift in ambient-life.css can move WITHIN the plane the camera moves
 *       — two separate transform contexts compose instead of fighting).
 *   26. Insert a drifting .atmos-haze into the mid life-layer.
 *   27. Set --life-* vars (amplitude / rotation character / periods) from
 *       beat.pace + beat.emotion + intensity — emotionally directed motion.
 *   28. Set NEGATIVE-delay desync vars per layer, varied by beat_index, so
 *       no two layers (and no two beats) breathe in lockstep. Negative delays
 *       only phase-shift an infinite loop, so they stay fully seek-safe.
 *
 * SEEK-SAFETY: every var feeds an `infinite both` loop with delay <= 0.
 * Such loops are always in the Active state → always returned by
 * document.getAnimations() → always advanced by seekAnimations(). No
 * positive delays are introduced anywhere in this file.
 */

(function () {
  var beat = window.__BEAT__;
  if (!beat) return;
  var scene = document.querySelector('.scene');
  if (!scene) return;

  /* Global dial — raise/lower the whole perpetual system at once.
     1.0 == the v5 tuned default (≈ "7/10 boldness" — clearly alive,
     still premium). Drop to 0.7 for restraint, push to 1.3 for more. */
  var LIFE_CEILING = 1.0;

  // ── 25. WRAP EACH PLANE'S CHILDREN IN .life-layer ────────────────
  ['.depth-bg', '.depth-mid', '.depth-fg'].forEach(function (sel) {
    var plane = scene.querySelector(sel);
    if (!plane) return;
    // already wrapped? skip (idempotent)
    var existing = plane.querySelector(':scope > .life-layer');
    if (existing) return;

    var layer = document.createElement('div');
    layer.className = 'life-layer';
    // move every current child into the layer (preserves order)
    while (plane.firstChild) layer.appendChild(plane.firstChild);
    plane.appendChild(layer);
  });

  var midLayer = scene.querySelector('.depth-mid > .life-layer')
              || scene.querySelector('.depth-mid')
              || scene;

  // ── 26. ATMOSPHERIC HAZE — drifting soft light in the mid plane ──
  if (!scene.querySelector('.atmos-haze')) {
    var haze = document.createElement('div');
    haze.className = 'atmos-haze';
    haze.setAttribute('aria-hidden', 'true');
    midLayer.appendChild(haze);
  }

  // ── recompute intensity exactly as inject.js step 21 does ────────
  var intensity = typeof beat.intensity === 'number'
    ? Math.max(0, Math.min(1, beat.intensity))
    : 0.65;

  // ── 27. EMOTIONAL COUPLING → amplitude / character / speed ───────
  var pace = beat.pace || 'mid';

  // amplitude by pace, then nudged by intensity, then global ceiling.
  // v5: floor raised so even calm/slow beats are unmistakably alive.
  var AMP_BY_PACE = { slow: 0.85, mid: 1.05, fast: 1.30, explosive: 1.70 };
  var ampBase = AMP_BY_PACE[pace] != null ? AMP_BY_PACE[pace] : 1.05;
  var amp = ampBase * (0.88 + intensity * 0.34) * LIFE_CEILING;

  // duration multiplier by pace (calm = slower/longer periods). Kept modest
  // so periods stay ~2-2.5x the beat → continuous in-beat travel.
  var DUR_BY_PACE = { slow: 1.20, mid: 1.00, fast: 0.86, explosive: 0.72 };
  var dm = DUR_BY_PACE[pace] != null ? DUR_BY_PACE[pace] : 1.0;

  // rotation character by emotion — taut/nervous scenes rotate more,
  // calm/cold scenes barely rotate. Drives the "feel", not the amount.
  var ROT_BY_EMOTION = {
    tense: 1.40, anxious: 1.55, urgent: 1.20, angry: 1.35, surprised: 1.25,
    hopeful: 0.55, confident: 0.50, serious: 0.45, melancholic: 0.40,
    cold: 0.35, playful: 0.80, amused: 0.80,
  };
  var rot = ROT_BY_EMOTION[beat.emotion] != null ? ROT_BY_EMOTION[beat.emotion] : 0.55;

  scene.style.setProperty('--life-amp', amp.toFixed(3));
  scene.style.setProperty('--life-rot-mult', rot.toFixed(2));

  // final periods (seconds) — base × pace multiplier.
  // v5: periods are ~2-2.5x a 5s beat so each beat shows continuous travel.
  var bgDur    = 11 * dm;
  var midDur   = 9.5 * dm;
  var fgDur    = 13 * dm;
  var hazeDur  = 17 * dm;
  var breathDur= 7.5 * dm;
  var settleDur= 6.5 * dm;
  var kwDur    = 4.6 * dm;

  // ── PER-BEAT DIRECTION FLIP ────────────────────────────────────
  // Flip the drift bias per beat so consecutive scenes lean different
  // ways (kills the "every scene moves the same" predictability). The
  // negative-delay phase shift below adds further variety on top.
  var bgSx = (bi % 2 === 0) ? 1 : -1;
  var bgSy = (bi % 4 < 2)   ? -1 : 1;
  var fgSx = (bi % 3 === 0) ? -1 : 1;
  var fgSy = ((bi + 1) % 2 === 0) ? -1 : 1;
  scene.style.setProperty('--bg-dx', String(bgSx));
  scene.style.setProperty('--bg-dy', String(bgSy));
  scene.style.setProperty('--fg-dx', String(fgSx));
  scene.style.setProperty('--fg-dy', String(fgSy));

  scene.style.setProperty('--life-bg-dur',  bgDur.toFixed(1) + 's');
  scene.style.setProperty('--life-mid-dur', midDur.toFixed(1) + 's');
  scene.style.setProperty('--life-fg-dur',  fgDur.toFixed(1) + 's');
  scene.style.setProperty('--haze-dur',     hazeDur.toFixed(1) + 's');
  scene.style.setProperty('--breath-dur',   breathDur.toFixed(1) + 's');
  scene.style.setProperty('--settle-dur',   settleDur.toFixed(1) + 's');

  // ── 28. NEGATIVE-DELAY DESYNC (per layer, varied per beat) ───────
  // Deterministic from beat_index so a render is reproducible, but each
  // beat lands on a different phase → a multi-beat video never repeats the
  // same breathing pose. Each layer gets a distinct salt so planes desync
  // from each other too. Negative delay = pure phase offset = seek-safe.
  var bi = (typeof beat.beat_index === 'number' ? beat.beat_index : 0);
  function negDelay(periodSec, salt) {
    var off = ((bi * 3.3) + salt) % periodSec;
    if (off < 0) off += periodSec;
    return '-' + off.toFixed(2) + 's';
  }

  scene.style.setProperty('--life-bg-delay',  negDelay(bgDur,    1.7));
  scene.style.setProperty('--life-mid-delay', negDelay(midDur,   6.1));
  scene.style.setProperty('--life-fg-delay',  negDelay(fgDur,    3.4));
  scene.style.setProperty('--haze-delay',     negDelay(hazeDur, 11.0));
  scene.style.setProperty('--settle-delay',   negDelay(settleDur, 4.2));
  scene.style.setProperty('--kw-pulse-delay', negDelay(kwDur,    1.1));

  // ── HELD-BEAT escape hatch ───────────────────────────────────────
  // A deliberately frozen dramatic beat can opt out of perpetual motion
  // (entries still play) by setting beat.life_still = true.
  if (beat.life_still === true) scene.classList.add('life-still');
})();

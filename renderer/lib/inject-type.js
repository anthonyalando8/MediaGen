/**
 * inject-type.js  --  v1 CINEMATIC KINETIC TYPOGRAPHY stager
 *
 * Runs LAST in _base.html, after inject.js + inject-life.js:
 *     <script src="../lib/inject.js"></script>
 *     <script src="../lib/inject-life.js"></script>
 *     <script src="../lib/inject-type.js"></script>
 *
 * Reads window.__BEAT__ (emotion / scene / intensity) and stages the
 * keyword + body as an EMOTIONALLY-DIRECTED performance instead of a
 * uniform reveal. Pairs with typography.css.
 *
 * WHAT IT DOES
 *   T1. Pick a reveal MODE (slam / fracture / drift / rise / hero) from
 *       emotion, with scene overrides for the strongly-typed beats.
 *   T2. Stamp data-reveal + --type-amp on .scene so CSS styles cascade to
 *       the keyword AND body (shared mood).
 *   T3. Stage each .kw-word: set inline animation (name + DURATION + ease,
 *       delay ALWAYS 0). Duration carries the RHYTHM — a clean cascade, big
 *       reflective gaps, or a held final "payoff" word. Seek-safe by design.
 *   T4. Flavour the perpetual keyword breath period (--kw-pulse-dur) by
 *       emotion (tense = nervous/fast, reflective = slow).
 *
 * SEEK-SAFETY: .kw-word animations are delay:0 + fill:both. Any "appears
 * late" effect is an opacity HOLD inside the keyframe (kwSlamPunch / kwHero),
 * never a positive delay (which the seek renderer skips on keyword spans).
 */

(function () {
  var beat = window.__BEAT__;
  if (!beat) return;
  var scene = document.querySelector('.scene');
  if (!scene) return;

  // ── T1. choose reveal mode ───────────────────────────────────────
  var EMOTION_REVEAL = {
    urgent: 'slam', angry: 'slam',
    tense: 'fracture', anxious: 'fracture',
    melancholic: 'drift', cold: 'drift', serious: 'drift',
    hopeful: 'rise', confident: 'rise', surprised: 'rise',
    playful: 'rise', amused: 'rise',
  };
  // Strongly-typed scenes pin the mood regardless of emotion.
  var SCENE_REVEAL = {
    climax: 'slam', cta: 'slam',
    tension: 'fracture',
    truth: 'drift',
  };

  // ROBUST keyword lookup: inject.js appends `kw-pulse` to the keyword, so
  // its class string no longer ends in "-kw" and [class$="-kw"] misses it.
  // The keyword element is the parent of the .kw-word spans; fall back to
  // .kw-pulse. Tag it with a stable .kw-host class for typography.css.
  var firstWord = scene.querySelector('.kw-word');
  var keyword = (firstWord && firstWord.parentElement)
             || scene.querySelector('.kw-pulse')
             || scene.querySelector('[class$="-kw"]');
  if (keyword) keyword.classList.add('kw-host');

  // ── KEYWORD FIT-SIZE (robust sz_kw application) ──────────────────
  // capture.js computes beat.sz_kw and injects
  //   [class$="-kw"] { font-size: var(--sz-kw) !important; }
  // but inject.js appends `kw-pulse` to the keyword, so its class no longer
  // ENDS in "-kw" → that rule never matches → the keyword renders at the
  // giant scene default and OVERFLOWS/clips (the "truth truncation" bug).
  // Fix it here without requiring a capture.js edit: stamp the fit-size
  // inline on the keyword host (font-size inherits to .kw-word/.kw-ink).
  // Inline beats the scene's class default; harmless if capture.js is also
  // fixed (same value). Only applies when sz_kw was provided.
  if (keyword && beat.sz_kw != null && beat.sz_kw !== '') {
    keyword.style.fontSize = (typeof beat.sz_kw === 'number')
      ? beat.sz_kw + 'px' : String(beat.sz_kw);
  }

  var words   = keyword ? keyword.querySelectorAll('.kw-word') : [];
  var nWords  = words.length;

  var mode = SCENE_REVEAL[beat.scene]
          || EMOTION_REVEAL[beat.emotion]
          || 'rise';

  // Single-word keyword → cinematic hero takeover, overrides everything.
  if (nWords === 1) mode = 'hero';

  scene.dataset.reveal = mode;

  // ── T2. intensity → magnitude ────────────────────────────────────
  var intensity = typeof beat.intensity === 'number'
    ? Math.max(0, Math.min(1, beat.intensity)) : 0.65;
  var typeAmp = (0.85 + intensity * 0.40).toFixed(3);   // 0.85 .. 1.25
  scene.style.setProperty('--type-amp', typeAmp);

  // ── T3. per-word staging (rhythm via DURATION, delay always 0) ────
  function jitter(i) { return [0, 13, 21, 34, 28][i % 5] / 1000; }  // anti-frame-lock

  // mode → { base duration, per-word increment, easing, keyframe name }
  var REVEAL = {
    slam:     { base: 0.52, inc: 0.06, ease: 'cubic-bezier(.2,.85,.25,1)', name: 'kwSlam' },
    fracture: { base: 0.50, inc: 0.05, ease: 'linear',                      name: 'kwFracture' },
    drift:    { base: 1.05, inc: 0.20, ease: 'cubic-bezier(.25,.7,.2,1)',   name: 'kwDrift' },
    rise:     { base: 0.70, inc: 0.10, ease: 'cubic-bezier(.16,1,.3,1)',    name: 'kwRise' },
    hero:     { base: 1.50, inc: 0.00, ease: 'cubic-bezier(.16,1,.3,1)',    name: 'kwHero' },
  };
  var spec = REVEAL[mode] || REVEAL.rise;

  // Should the FINAL word land late + hard (a payoff)? Only for impact
  // scenes with a multi-word slam — the anticipation gap is the spike.
  var payoffLast = (mode === 'slam')
    && nWords > 1
    && (beat.scene === 'hook' || beat.scene === 'climax' || beat.scene === 'cta');

  // Reflective drift reads better as a slow front-to-back cascade with
  // widening gaps; everything else cascades evenly.
  Array.prototype.forEach.call(words, function (w, i) {
    // Split each word: inner .kw-ink carries the REVEAL, outer .kw-word
    // carries PERPETUAL LIFE. Two transform contexts → they compose, so the
    // word keeps breathing after it lands instead of freezing.
    var ink = w.querySelector('.kw-ink');
    if (!ink) {
      ink = document.createElement('span');
      ink.className = 'kw-ink';
      while (w.firstChild) ink.appendChild(w.firstChild);
      w.appendChild(ink);
    }

    var dur, name = spec.name, ease = spec.ease;

    if (payoffLast && i === nWords - 1) {
      name = 'kwSlamPunch';            // internal 52% hold → late fast slam
      dur  = 1.20 + jitter(i);
      ease = 'cubic-bezier(.2,.9,.25,1)';
    } else {
      dur = spec.base + i * spec.inc + jitter(i);     // even / growing cascade
    }

    // REVEAL on the ink — INLINE longhands win the cascade and pin delay:0
    // (the only seek-safe way: any "late" feel is baked into the keyframe).
    ink.style.animationName           = name;
    ink.style.animationDuration       = dur.toFixed(3) + 's';
    ink.style.animationTimingFunction = ease;
    ink.style.animationFillMode       = 'both';
    ink.style.animationDelay          = '0s';
    ink.style.animationIterationCount = '1';

    // PERPETUAL LIFE on the word — infinite, per-word negative-delay desync
    // so each word floats on its own phase (shimmer, not a moving block).
    var lifeDur   = 4.6 + (i % 3) * 0.7;             // 4.6 / 5.3 / 6.0s
    var lifeDelay = -((i * 0.83) % lifeDur);          // negative phase per word
    w.style.setProperty('--wl-dir',  (i % 2) ? '-1' : '1');          // alt vertical
    w.style.setProperty('--wl-xdir', String((i % 3) - 1));           // -1/0/1 horiz
    w.style.animation = 'wordLife ' + lifeDur.toFixed(2) + 's ease-in-out '
                      + lifeDelay.toFixed(2) + 's infinite both';
  });

  // ── T3b. BODY LINE perpetual life (stop the body freezing too) ───
  // Wrap each line's content in .body-ink; the line keeps its delay-based
  // entrance (on .body-line), the inner ink carries a slow infinite float.
  // Lines SHARE direction + a small phase wave so the paragraph drifts as
  // a coherent block (not jittery independent lines). The body container's
  // own settleDrift is dead (inject.js stamps animationName:none on it), so
  // this inner-ink loop is the body's only perpetual motion — make it count.
  var bodyLines = scene.querySelectorAll('.body-line');
  var bodyDir = 1;                                  // whole paragraph leans one way
  Array.prototype.forEach.call(bodyLines, function (line, i) {
    var ink = line.querySelector('.body-ink');
    if (!ink) {
      ink = document.createElement('span');
      ink.className = 'body-ink';
      while (line.firstChild) ink.appendChild(line.firstChild);
      line.appendChild(ink);
    }
    var dur   = 7.0 + (i % 2) * 0.6;                // 7.0 / 7.6s — close, coherent
    var delay = -(i * 0.55);                         // small phase wave down the lines
    ink.style.setProperty('--bl-xdir', String(bodyDir));
    ink.style.animation = 'bodyLineLife ' + dur.toFixed(2) + 's ease-in-out '
                        + delay.toFixed(2) + 's infinite both';
  });

  // ── T4. emotion-flavoured perpetual keyword breath ───────────────
  var PULSE_DUR = {
    tense: 3.2, anxious: 3.0,
    urgent: 4.0, angry: 3.8,
    melancholic: 6.5, cold: 6.8, serious: 6.0,
    hopeful: 5.2, confident: 4.8, surprised: 4.4,
  };
  var pulseDur = PULSE_DUR[beat.emotion] != null ? PULSE_DUR[beat.emotion] : 4.6;
  // pace nudge — explosive/fast scenes breathe a touch quicker
  var PACE_PULSE = { slow: 1.15, mid: 1.0, fast: 0.9, explosive: 0.82 };
  pulseDur *= (PACE_PULSE[beat.pace] != null ? PACE_PULSE[beat.pace] : 1.0);
  scene.style.setProperty('--kw-pulse-dur', pulseDur.toFixed(2) + 's');

  // ── T5. KEYWORD AUTO-FIT — the guarantee that a word NEVER breaks/clips
  // ---------------------------------------------------------------------
  // Words must NOT fracture mid-glyph (reads as a broken video) and should
  // not clip either — the keyword is RESIZED to fit the frame. sz_kw from
  // visuals.py is a good first guess, but it can still overflow a given
  // layout/column; this measures the real laid-out word boxes against the
  // scene bounds and shrinks font-size until the whole title fits. Runs
  // once now, then again on fonts.ready (a font swap changes metrics).
  //
  // Pure style mutation (font-size) — NOT an animation, so it's seek-safe
  // and persists across every captured frame.
  function fitKeyword() {
    if (!keyword || !words.length) return;
    var sc = document.querySelector('.scene');
    if (!sc) return;
    var pad = 26;                                   // safe gutter from frame edges
    // worst overflow past either side, at current size
    function worstOverflow() {
      var r = sc.getBoundingClientRect();
      var left = r.left + pad, right = r.right - pad;
      var over = 0;
      Array.prototype.forEach.call(words, function (w) {
        var b = w.getBoundingClientRect();
        if (b.right - right > over) over = b.right - right;
        if (left - b.left  > over) over = left - b.left;
      });
      return over;                                  // >0 == overflowing
    }
    var cur = parseFloat(getComputedStyle(keyword).fontSize) || 100;
    var guard = 0;
    while (worstOverflow() > 0.5 && cur > 22 && guard < 80) {
      cur *= 0.95;
      keyword.style.fontSize = cur.toFixed(2) + 'px';
      guard++;
    }
  }
  fitKeyword();
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(fitKeyword);          // re-fit after font swap
  }
})();

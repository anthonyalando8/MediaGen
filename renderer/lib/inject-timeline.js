/**
 * inject-timeline.js  —  Render-side consumer of the timeline spine.
 *
 * Loads AFTER inject.js (and inject-type.js if present), as the LAST inline
 * script in <body>:
 *     <script src="../lib/inject.js"></script>
 *     <script src="../lib/inject-type.js"></script>
 *     <script src="../lib/inject-timeline.js"></script>
 *
 * WHAT IT DOES
 * ---------------------------------------------------------------------------
 * window.__BEAT__ now carries `emphasis_times` (and `word_times`) injected by
 * the Python timeline → scene.json → beat JSON. This script re-times the body
 * emphasis PUNCH (.em) so it lands on the ACTUAL spoken word, replacing
 * inject.js step 23's fixed "+0.42s after line entry" guess.
 *
 * This is the one clean, reliable, seek-safe use of the timeline on the render
 * side: a .em span IS a spoken word, the punch is neutral before/after, so a
 * positive (real-timed) animation delay just shifts when the punch fires —
 * fully compatible with capture.js's currentTime seeking.
 *
 * TWO CLOCK RECONCILIATIONS (see TIMELINE_WIRING.md)
 * ---------------------------------------------------------------------------
 *  1. emphasis_times are BEAT-RELATIVE to the beat's AUDIO START (timeline.py
 *     subtracts audio_start_s), which is where the scene animation clock's t=0
 *     sits — so they map directly onto the animation timeline.
 *  2. capture.js seeks currentTime = f*frame_ms + TIME_OFFSET_MS (80ms), i.e.
 *     the displayed animation runs 80ms AHEAD of the audio. So to make the
 *     punch VISUALLY land on the spoken word we add SCENE_CLOCK_OFFSET.
 *
 *  --em-delay is when the punch ANIMATION STARTS; its visible peak is ~PEAK_LEAD
 *  later. We start it PEAK_LEAD early so the peak lands on the word. Both
 *  constants are conservative — tune by eye on a real render.
 */
(function () {
  var beat = window.__BEAT__;
  if (!beat) return;
  var scene = document.querySelector('.scene');
  if (!scene) return;

  var emph = beat.emphasis_times;
  if (!emph || !emph.length) return;     // no timeline data → leave inject.js guess intact

  // ── tunables (seconds) ────────────────────────────────────────────────
  var SCENE_CLOCK_OFFSET = 0.080;  // capture.js TIME_OFFSET_MS — animation leads audio by this
  var PEAK_LEAD          = 0.150;  // emPunch reaches its visible peak ~this long after it starts
  var MIN_DELAY          = 0.0;    // never negative (would put the punch in the seek-idle phase)

  function norm(t) { return (t || '').toString().replace(/[^A-Za-z0-9']/g, '').toLowerCase(); }

  // ── gather .em spans in DOM order ─────────────────────────────────────
  var ems = Array.prototype.slice.call(scene.querySelectorAll('.body-line .em, .em'));
  if (!ems.length) return;

  // ── match each .em to an emphasis entry: text match first, then fall
  //    back to positional order (both lists come from the same *…* markers,
  //    so they normally line up 1:1). ───────────────────────────────────
  var used = new Array(emph.length).fill(false);

  function findEntry(spanText, fromIdx) {
    var n = norm(spanText);
    // exact text match on an unused entry, scanning forward from fromIdx
    for (var i = fromIdx; i < emph.length; i++) {
      if (!used[i] && norm(emph[i].text) === n) return i;
    }
    // loose: entry text contains / is contained by the span (ASR variance)
    for (var j = fromIdx; j < emph.length; j++) {
      if (used[j]) continue;
      var e = norm(emph[j].text);
      if (e && n && (e.indexOf(n) !== -1 || n.indexOf(e) !== -1)) return j;
    }
    return -1;
  }

  var cursor = 0;
  ems.forEach(function (span, k) {
    var idx = findEntry(span.textContent, cursor);
    if (idx === -1) idx = (k < emph.length && !used[k]) ? k : -1;   // positional fallback
    if (idx === -1) return;
    used[idx] = true;
    cursor = Math.max(cursor, idx + 1);

    var spoken = emph[idx].start_s;                       // beat-relative, audio-start ref
    var delay = spoken + SCENE_CLOCK_OFFSET - PEAK_LEAD;  // when the punch animation starts
    if (delay < MIN_DELAY) delay = MIN_DELAY;
    span.style.setProperty('--em-delay', delay.toFixed(3) + 's');
    span.dataset.emSynced = '1';                          // marker for debugging / verify
  });
})();

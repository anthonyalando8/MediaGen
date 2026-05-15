/**
 * timing.js  --  Animation timing utilities
 *
 * Used inside rendered HTML pages (injected as a <script> block by inject.js)
 * to pace animations based on the beat's `pace` field.
 *
 * Also used by capture.js to calculate per-frame seek offsets.
 */

/** Multipliers matching schema.js PACE_MULTIPLIER (duplicated for browser use). */
const PACE_MULT = {
  slow:      1.45,
  mid:       1.00,
  fast:      0.70,
  explosive: 0.45,
};

/**
 * Apply pace-based timing to all CSS animation elements inside `root`.
 * Scales animation-duration and animation-delay proportionally.
 * Called once after DOM is ready.
 */
export function applyPaceTiming(root, pace) {
  const mult = PACE_MULT[pace] ?? 1.0;
  if (mult === 1.0) return; // nothing to do for mid pace

  root.querySelectorAll('[style*="animation"], [class]').forEach(el => {
    const style = window.getComputedStyle(el);
    const dur   = style.animationDuration;
    const delay = style.animationDelay;

    if (dur && dur !== '0s' && dur !== 'none') {
      const scaled = parseTimes(dur).map(t => t * mult).map(t => t.toFixed(3) + 's').join(', ');
      el.style.animationDuration = scaled;
    }
    if (delay && delay !== '0s') {
      const scaled = parseTimes(delay).map(t => t * mult).map(t => t.toFixed(3) + 's').join(', ');
      el.style.animationDelay = scaled;
    }
  });
}

/** Parse a CSS time string like "0.85s, 1.2s" into an array of seconds. */
function parseTimes(str) {
  return str.split(',').map(s => {
    s = s.trim();
    if (s.endsWith('ms')) return parseFloat(s) / 1000;
    if (s.endsWith('s'))  return parseFloat(s);
    return parseFloat(s);
  });
}

/**
 * Return the time offset (ms) for a given frame number.
 * Accounts for a fixed warm-up offset so frame 0 is never a black frame.
 *
 * @param {number} frameIndex  0-based frame index
 * @param {number} fps         frames per second
 * @param {number} warmup_ms   initial offset in ms (default 80)
 */
export function frameToMs(frameIndex, fps, warmup_ms = 80) {
  return (frameIndex * (1000 / fps)) + warmup_ms;
}

/**
 * Total frame count for a beat including an optional gap.
 *
 * @param {number} duration_ms   beat audio duration in ms
 * @param {number} fps
 * @param {number} gap_ms        silence gap appended after beat (0 for last beat)
 */
export function beatFrameCount(duration_ms, fps, gap_ms = 380) {
  return Math.ceil(((duration_ms + gap_ms) / 1000) * fps);
}

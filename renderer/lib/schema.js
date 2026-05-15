/**
 * schema.js  --  Beat contract validation + defaults
 *
 * Consumed by capture.js and inject.js to guarantee every beat
 * has the fields the renderer expects, regardless of what the
 * Python pipeline emitted.
 */

/** All recognised camera movements and their CSS class names. */
export const CAMERA_CLASSES = {
  static:       'cam-static',
  push_in:      'cam-push-in',
  pull_out:     'cam-pull-out',
  handheld:     'cam-handheld',
  snap_zoom:    'cam-snap-zoom',
  micro_shake:  'cam-micro-shake',
  tilt_up:      'cam-tilt-up',
};

/** Transition types forwarded as data-transition to the scene wrapper. */
export const TRANSITIONS = new Set([
  'cut', 'slam_cut', 'blur_wipe', 'flash', 'fade', 'dip_black', 'whip_pan',
]);

/** Pace values → timing multiplier (applied to animation durations). */
export const PACE_MULTIPLIER = {
  slow:      1.45,
  mid:       1.00,
  fast:      0.70,
  explosive: 0.45,
};

/** Background variants → CSS class on .scene */
export const BG_CLASSES = {
  solid:    'bg-solid',
  gradient: 'bg-gradient',
  noise:    'bg-noise',
  grid:     'bg-grid',
  glow:     'bg-glow',
  lines:    'bg-lines',
  abstract: 'bg-abstract',
};

/** Emotion → subtle tint class on .scene */
export const EMOTION_TINT = {
  urgent:     'tint-urgent',
  tense:      'tint-tense',
  hopeful:    'tint-hopeful',
  melancholic:'tint-melancholic',
  angry:      'tint-angry',
  cold:       'tint-cold',
  confident:  'tint-confident',
  anxious:    'tint-anxious',
  serious:    'tint-serious',
};

/**
 * Normalise a raw beat from scene.json, filling in all defaults.
 * Returns a clean beat object the renderer can use unconditionally.
 */
export function normaliseBeat(raw) {
  return {
    id:              raw.id            ?? 0,
    scene:           raw.scene         ?? 'insight',
    hud_tag:         raw.hud_tag       ?? '// —',
    keyword:         raw.keyword       ?? '',
    body:            raw.body          ?? '',
    layout:          raw.layout        ?? 'left',
    duration_ms:     raw.duration_ms   ?? 5000,
    accent_override: raw.accent_override ?? null,
    // cinematic fields
    emotion:         raw.emotion       ?? '',
    pace:            raw.pace          ?? 'mid',
    visual_intent:   raw.visual_intent ?? '',
    camera:          raw.camera        ?? 'static',
    transition:      raw.transition    ?? 'cut',
    background:      raw.background    ?? 'solid',
  };
}

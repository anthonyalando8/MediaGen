import { gsap } from "gsap";

/**
 * expressionPresets.js
 * --------------------
 * Maps semantic expression names → GSAP timeline factories.
 * Each factory receives a rigRef map and returns a playable timeline.
 *
 * Conventions:
 *   - Duration is fast (0.12–0.3s) — expressions are reactions, not actions
 *   - Always tween from current state (no .from()) so blending works
 *   - brow_l rotates POSITIVE = inner corner down (angry)
 *   - brow_r rotates NEGATIVE = inner corner down (angry, mirrored)
 *   - eye scaleY < 1 = squint/narrow,  scaleY > 1 = wide/scared
 *   - mouth.el is the whole mouth group ref from useImperativeHandle
 */

// ── Shared eases ─────────────────────────────────────────────────
const SNAP  = "power3.out";
const SOFT  = "power2.inOut";
const EASE  = "power2.out";

// ── Expression reset values ────────────────────────────────────
export const NEUTRAL_STATE = {
  brow_l:  { rotation: 0,  y: 0,  scaleX: 1 },
  brow_r:  { rotation: 0,  y: 0,  scaleX: 1 },
  eye_l:   { scaleY: 1,    y: 0  },
  eye_r:   { scaleY: 1,    y: 0  },
  mouth:   { scaleX: 1,    scaleY: 1, y: 0 },
};

// ── Factory map ───────────────────────────────────────────────────
export const EXPRESSION_PRESETS = {

  neutral(rig, { dur = 0.25 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation: 0,  y: 0,  scaleX: 1, duration: dur, ease: SOFT })
      .to(rig.brow_r,  { rotation: 0,  y: 0,  scaleX: 1, duration: dur, ease: SOFT }, "<")
      .to(rig.eye_l,   { scaleY: 1,    y: 0,             duration: dur, ease: SOFT }, "<")
      .to(rig.eye_r,   { scaleY: 1,    y: 0,             duration: dur, ease: SOFT }, "<")
      .to(rig.mouth.el,{ scaleX: 1,    scaleY: 1, y: 0,  duration: dur, ease: SOFT }, "<");
  },

  happy(rig, { dur = 0.2 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation: -8, y: -3, duration: dur, ease: EASE })
      .to(rig.brow_r,  { rotation:  8, y: -3, duration: dur, ease: EASE }, "<")
      .to(rig.eye_l,   { scaleY: 0.5,  y: 2,  duration: dur, ease: EASE }, "<")
      .to(rig.eye_r,   { scaleY: 0.5,  y: 2,  duration: dur, ease: EASE }, "<")
      .to(rig.mouth.el,{ scaleX: 1.2,          duration: dur, ease: EASE }, "<");
  },

  angry(rig, { dur = 0.15 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation:  18, y: 5,  duration: dur, ease: SNAP })
      .to(rig.brow_r,  { rotation: -18, y: 5,  duration: dur, ease: SNAP }, "<")
      .to(rig.eye_l,   { scaleY: 0.65,          duration: dur, ease: SNAP }, "<")
      .to(rig.eye_r,   { scaleY: 0.65,          duration: dur, ease: SNAP }, "<")
      .to(rig.mouth.el,{ scaleX: 0.82,           duration: dur, ease: SNAP }, "<");
  },

  scared(rig, { dur = 0.15 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation: -6,  y: -5, duration: dur, ease: SNAP })
      .to(rig.brow_r,  { rotation:  6,  y: -5, duration: dur, ease: SNAP }, "<")
      .to(rig.eye_l,   { scaleY: 1.35,  y: -2, duration: dur, ease: SNAP }, "<")
      .to(rig.eye_r,   { scaleY: 1.35,  y: -2, duration: dur, ease: SNAP }, "<")
      .to(rig.mouth.el,{ scaleX: 0.85, scaleY: 1.1, duration: dur, ease: SNAP }, "<");
  },

  surprised(rig, { dur = 0.1 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation: -4,  y: -7, duration: dur, ease: SNAP })
      .to(rig.brow_r,  { rotation:  4,  y: -7, duration: dur, ease: SNAP }, "<")
      .to(rig.eye_l,   { scaleY: 1.45,  y: -3, duration: dur, ease: SNAP }, "<")
      .to(rig.eye_r,   { scaleY: 1.45,  y: -3, duration: dur, ease: SNAP }, "<")
      .to(rig.mouth.el,{ scaleY: 1.35, scaleX: 1.1, duration: dur, ease: SNAP }, "<");
  },

  sad(rig, { dur = 0.3 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation:  10, y: 3,  duration: dur, ease: SOFT })
      .to(rig.brow_r,  { rotation: -10, y: 3,  duration: dur, ease: SOFT }, "<")
      .to(rig.eye_l,   { scaleY: 0.82,  y: 1,  duration: dur, ease: SOFT }, "<")
      .to(rig.eye_r,   { scaleY: 0.82,  y: 1,  duration: dur, ease: SOFT }, "<")
      .to(rig.mouth.el,{ scaleX: 0.78, scaleY: 0.88, duration: dur, ease: SOFT }, "<");
  },

  smug(rig, { dur = 0.2 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation:  0,   y: -1, duration: dur, ease: EASE })
      .to(rig.brow_r,  { rotation: -12,  y: -4, duration: dur, ease: EASE }, "<")
      .to(rig.eye_l,   { scaleY: 0.9,    y: 1,  duration: dur, ease: EASE }, "<")
      .to(rig.eye_r,   { scaleY: 0.7,    y: 1,  duration: dur, ease: EASE }, "<")
      .to(rig.mouth.el,{ scaleX: 1.05,           duration: dur, ease: EASE }, "<");
  },

  determined(rig, { dur = 0.2 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation:  6,  y: 2,  duration: dur, ease: EASE })
      .to(rig.brow_r,  { rotation: -6,  y: 2,  duration: dur, ease: EASE }, "<")
      .to(rig.eye_l,   { scaleY: 0.88,          duration: dur, ease: EASE }, "<")
      .to(rig.eye_r,   { scaleY: 0.88,          duration: dur, ease: EASE }, "<")
      .to(rig.mouth.el,{ scaleX: 0.95, scaleY: 0.9, duration: dur, ease: EASE }, "<");
  },

  evil_grin(rig, { dur = 0.2 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation:  14, y: -2, duration: dur, ease: EASE })
      .to(rig.brow_r,  { rotation: -22, y: -5, duration: dur, ease: EASE }, "<")
      .to(rig.eye_l,   { scaleY: 0.6,   y: 1,  duration: dur, ease: EASE }, "<")
      .to(rig.eye_r,   { scaleY: 0.6,   y: 1,  duration: dur, ease: EASE }, "<")
      .to(rig.mouth.el,{ scaleX: 1.25,          duration: dur, ease: EASE }, "<");
  },

  confused(rig, { dur = 0.2 } = {}) {
    return gsap.timeline()
      .to(rig.brow_l,  { rotation: -10, y: -2, scaleX: 0.85, duration: dur, ease: EASE })
      .to(rig.brow_r,  { rotation:  4,  y: 2,  scaleX: 1,    duration: dur, ease: EASE }, "<")
      .to(rig.eye_l,   { scaleY: 1.1,   y: 0,                 duration: dur, ease: EASE }, "<")
      .to(rig.eye_r,   { scaleY: 0.85,  y: 1,                 duration: dur, ease: EASE }, "<")
      .to(rig.mouth.el,{ scaleX: 0.75, scaleY: 0.9,           duration: dur, ease: EASE }, "<");
  },
};
/* expressionPresets.js — face emotion library.
 *
 * Expressions are FAST face-only reactions (0.12–0.3s). They touch ONLY:
 *   brow_l, brow_r, eye_l, eye_r, mouth.el (group), and optionally mouth_upper / mouth_lower
 * so they compose safely with motion presets that touch body joints.
 *
 * Sign conventions (these are the SVG-rotation directions in this rig):
 *   brow_l rotation POSITIVE  →  inner corner DOWN  →  angry
 *   brow_r rotation NEGATIVE  →  inner corner DOWN  →  angry (mirrored)
 *   brow.y NEGATIVE            →  brow lifts UP
 *   eye.scaleY < 1             →  squint / narrow
 *   eye.scaleY > 1             →  wide / shocked
 *   mouth.el scaleX > 1        →  wide smile / shock open
 *   mouth.el scaleY > 1        →  agape (open vertically)
 *   mouth_lower.y positive     →  jaw drop (mouth open)
 */

import { gsap } from "gsap";

const SNAP = "power3.out";
const SOFT = "power2.inOut";
const EASE = "power2.out";

// Public: useful for callers that want to know the "rest" state.
export const NEUTRAL_STATE = {
  brow_l: { rotation: 0, y: 0, scaleX: 1 },
  brow_r: { rotation: 0, y: 0, scaleX: 1 },
  eye_l:  { scaleY: 1, y: 0 },
  eye_r:  { scaleY: 1, y: 0 },
  mouth:  { scaleX: 1, scaleY: 1, y: 0 },
};

// Helper — apply a single face-pose object. Keeps each preset tiny + symmetric.
function setFace(rig, { browL, browR, eyeL, eyeR, mouth, mouthUpper, mouthLower, dur, ease }) {
  const tl = gsap.timeline();
  tl.to(rig.brow_l, { ...browL, duration: dur, ease });
  tl.to(rig.brow_r, { ...browR, duration: dur, ease }, "<");
  tl.to(rig.eye_l,  { ...eyeL,  duration: dur, ease }, "<");
  tl.to(rig.eye_r,  { ...eyeR,  duration: dur, ease }, "<");
  tl.to(rig.mouth.el, { ...mouth, duration: dur, ease }, "<");
  if (mouthUpper && rig.mouth.upperLip) {
    tl.to(rig.mouth.upperLip, { ...mouthUpper, duration: dur, ease }, "<");
  }
  if (mouthLower && rig.mouth.lowerLip) {
    tl.to(rig.mouth.lowerLip, { ...mouthLower, duration: dur, ease }, "<");
  }
  return tl;
}

export const EXPRESSION_PRESETS = {

  neutral(rig, { dur = 0.25 } = {}) {
    return setFace(rig, {
      browL:      { rotation: 0,  y: 0, scaleX: 1 },
      browR:      { rotation: 0,  y: 0, scaleX: 1 },
      eyeL:       { scaleY: 1,    y: 0 },
      eyeR:       { scaleY: 1,    y: 0 },
      mouth:      { scaleX: 1,    scaleY: 1, y: 0 },
      mouthUpper: { y: 0, rotation: 0 },
      mouthLower: { y: 0, rotation: 0 },
      dur, ease: SOFT,
    });
  },

  happy(rig, { dur = 0.22 } = {}) {
    return setFace(rig, {
      browL: { rotation: -8, y: -3 },
      browR: { rotation:  8, y: -3 },
      eyeL:  { scaleY: 0.55, y: 2 },
      eyeR:  { scaleY: 0.55, y: 2 },
      mouth: { scaleX: 1.25, scaleY: 1.05, y: 0 },
      mouthLower: { y: 1.5 },         // small jaw drop = open smile
      dur, ease: EASE,
    });
  },

  angry(rig, { dur = 0.14 } = {}) {
    return setFace(rig, {
      browL: { rotation:  20, y: 5 },
      browR: { rotation: -20, y: 5 },
      eyeL:  { scaleY: 0.6,    y: 0 },
      eyeR:  { scaleY: 0.6,    y: 0 },
      mouth: { scaleX: 0.78,  scaleY: 0.9, y: 1 },
      mouthLower: { y: -0.8, rotation: 0 },
      dur, ease: SNAP,
    });
  },

  scared(rig, { dur = 0.14 } = {}) {
    return setFace(rig, {
      browL: { rotation: -6, y: -6 },
      browR: { rotation:  6, y: -6 },
      eyeL:  { scaleY: 1.35, y: -2 },
      eyeR:  { scaleY: 1.35, y: -2 },
      mouth: { scaleX: 0.85, scaleY: 1.15, y: 1 },
      mouthLower: { y: 2 },
      dur, ease: SNAP,
    });
  },

  surprised(rig, { dur = 0.1 } = {}) {
    return setFace(rig, {
      browL: { rotation: -3, y: -8 },
      browR: { rotation:  3, y: -8 },
      eyeL:  { scaleY: 1.5,  y: -3 },
      eyeR:  { scaleY: 1.5,  y: -3 },
      mouth: { scaleX: 1.1,  scaleY: 1.5,  y: 1 },
      mouthLower: { y: 3 },              // jaw drop wide
      dur, ease: SNAP,
    });
  },

  sad(rig, { dur = 0.32 } = {}) {
    return setFace(rig, {
      browL: { rotation:  12, y: 2 },
      browR: { rotation: -12, y: 2 },
      eyeL:  { scaleY: 0.8,    y: 1 },
      eyeR:  { scaleY: 0.8,    y: 1 },
      mouth: { scaleX: 0.75, scaleY: 0.85, y: 1 },
      mouthLower: { y: 0.8 },
      dur, ease: SOFT,
    });
  },

  smug(rig, { dur = 0.22 } = {}) {
    return setFace(rig, {
      browL: { rotation:  0,   y: -1 },
      browR: { rotation: -14,  y: -5 },
      eyeL:  { scaleY: 0.85,   y: 1 },
      eyeR:  { scaleY: 0.6,    y: 1 },
      mouth: { scaleX: 1.08,   scaleY: 0.95, y: 0 },
      mouthUpper: { rotation: -3 },         // half-smile lift one side
      dur, ease: EASE,
    });
  },

  determined(rig, { dur = 0.2 } = {}) {
    return setFace(rig, {
      browL: { rotation:  7, y: 2 },
      browR: { rotation: -7, y: 2 },
      eyeL:  { scaleY: 0.85, y: 0 },
      eyeR:  { scaleY: 0.85, y: 0 },
      mouth: { scaleX: 0.92, scaleY: 0.85, y: 0 },
      dur, ease: EASE,
    });
  },

  evil_grin(rig, { dur = 0.22 } = {}) {
    return setFace(rig, {
      browL: { rotation:  15, y: -2 },
      browR: { rotation: -24, y: -5 },
      eyeL:  { scaleY: 0.55,  y: 1 },
      eyeR:  { scaleY: 0.55,  y: 1 },
      mouth: { scaleX: 1.3,   scaleY: 1.05, y: 0 },
      mouthLower: { y: 1.5 },
      dur, ease: EASE,
    });
  },

  confused(rig, { dur = 0.22 } = {}) {
    return setFace(rig, {
      browL: { rotation: -12, y: -3, scaleX: 0.82 },
      browR: { rotation:   5, y:  3, scaleX: 1 },
      eyeL:  { scaleY: 1.15, y:  0 },
      eyeR:  { scaleY: 0.82, y:  1 },
      mouth: { scaleX: 0.72, scaleY: 0.9, y: 0 },
      dur, ease: EASE,
    });
  },

  // ─────────────────────────────────────────────────────────────
  //  NEW EXPRESSIONS
  // ─────────────────────────────────────────────────────────────

  wink(rig, { side = "r", dur = 0.18 } = {}) {
    // Asymmetric: one eye closes, the other narrows slightly, mouth half-smile.
    const tl = gsap.timeline();
    tl.to(rig.brow_l, { rotation: -4, y: -2,                 duration: dur, ease: EASE });
    tl.to(rig.brow_r, { rotation:  4, y: -2,                 duration: dur, ease: EASE }, "<");
    if (side === "r") {
      tl.to(rig.eye_l, { scaleY: 0.85,                       duration: dur, ease: EASE }, "<");
      tl.to(rig.eye_r, { scaleY: 0.05,                       duration: dur * 0.6, ease: SNAP }, "<");
    } else {
      tl.to(rig.eye_r, { scaleY: 0.85,                       duration: dur, ease: EASE }, "<");
      tl.to(rig.eye_l, { scaleY: 0.05,                       duration: dur * 0.6, ease: SNAP }, "<");
    }
    tl.to(rig.mouth.el, { scaleX: 1.15,                      duration: dur, ease: EASE }, "<");
    // Hold then release the winked eye
    tl.to(side === "r" ? rig.eye_r : rig.eye_l, { scaleY: 1, duration: 0.16, ease: EASE_OUT_OR_EASE() }, "+=0.45");
    return tl;
  },

  /** focused — narrowed eyes, calm brow, firm mouth. The "in-the-zone" look. */
  focused(rig, { dur = 0.2 } = {}) {
    return setFace(rig, {
      browL: { rotation:  3, y: 0 },
      browR: { rotation: -3, y: 0 },
      eyeL:  { scaleY: 0.7, y: 0 },
      eyeR:  { scaleY: 0.7, y: 0 },
      mouth: { scaleX: 0.95, scaleY: 0.85, y: 0 },
      dur, ease: SOFT,
    });
  },

  /** embarrassed — brows up + asymmetric eyes + small frown. */
  embarrassed(rig, { dur = 0.24 } = {}) {
    return setFace(rig, {
      browL: { rotation: -10, y: -4 },
      browR: { rotation:  10, y: -4 },
      eyeL:  { scaleY: 0.6, y: 1 },
      eyeR:  { scaleY: 0.6, y: 1 },
      mouth: { scaleX: 0.78, scaleY: 0.8, y: 1 },
      dur, ease: SOFT,
    });
  },

  /** sigh — eyes close briefly, brows relax, mouth softens. */
  sigh(rig, { dur = 0.4 } = {}) {
    const tl = gsap.timeline();
    tl.to(rig.brow_l, { rotation: 4,  y: 2,  duration: dur, ease: SOFT });
    tl.to(rig.brow_r, { rotation: -4, y: 2,  duration: dur, ease: SOFT }, "<");
    tl.to(rig.eye_l,  { scaleY: 0.15, y: 1,  duration: dur * 0.4, ease: "power2.in" }, "<");
    tl.to(rig.eye_r,  { scaleY: 0.15, y: 1,  duration: dur * 0.4, ease: "power2.in" }, "<");
    tl.to(rig.mouth.el, { scaleX: 0.85, scaleY: 0.9, y: 1, duration: dur, ease: SOFT }, "<");
    // hold then open eyes again
    tl.to([rig.eye_l, rig.eye_r], { scaleY: 0.85, y: 1, duration: 0.22, ease: EASE }, "+=0.4");
    return tl;
  },

  /** hurt — wince. Eyes squeeze, brows tighten up-and-in, mouth grimace. */
  hurt(rig, { dur = 0.14 } = {}) {
    return setFace(rig, {
      browL: { rotation: 18, y: -2 },
      browR: { rotation: -18, y: -2 },
      eyeL:  { scaleY: 0.2, y: 1 },
      eyeR:  { scaleY: 0.2, y: 1 },
      mouth: { scaleX: 0.7, scaleY: 1.1, y: 1 },
      mouthLower: { y: 1.8 },
      dur, ease: SNAP,
    });
  },

  /** joyful — bigger version of happy; closed-eye beam. */
  joyful(rig, { dur = 0.22 } = {}) {
    return setFace(rig, {
      browL: { rotation: -10, y: -5 },
      browR: { rotation:  10, y: -5 },
      eyeL:  { scaleY: 0.18, y: 3 },             // closed-eye smile arc
      eyeR:  { scaleY: 0.18, y: 3 },
      mouth: { scaleX: 1.4, scaleY: 1.1, y: 0 },
      mouthLower: { y: 2.5 },
      dur, ease: EASE,
    });
  },
};

// tiny local helper to avoid a typo above (EASE_OUT_OR_EASE used in wink). Keeps the file self-contained.
function EASE_OUT_OR_EASE() { return EASE; }
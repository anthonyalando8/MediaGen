/* motionPresets.js — production puppet motion library.
 *
 * Every preset now articulates the FULL chain:
 *    upper arm → lower arm → hand     (with phase-delayed drag)
 *    thigh    → foot                  (with heel-toe roll)
 *    hip      → torso → head          (with counter-rotations)
 *
 * Principles applied per Frank/Ollie:
 *   • Anticipation     — wind-up before every big move
 *   • Squash & stretch — torso scaleY during impacts
 *   • Follow-through   — distal joints lag with longer durations
 *   • Overshoot        — elastic/back eases on hand-stops
 *   • Settling         — end states return to neutral or hold
 */

import { gsap } from "gsap";

// ── Eases ───────────────────────────────────────────────────────
const EASE_IN  = "power2.in";
const EASE_OUT = "power2.out";
const EASE_IO  = "power2.inOut";
const SNAP     = "power3.out";
const BOUNCE   = "bounce.out";
const ELASTIC  = "elastic.out(1, 0.5)";
const ELASTIC_SOFT = "elastic.out(1, 0.7)";
const BACK     = "back.out(1.6)";
const BACK_IN  = "back.in(1.6)";

// ── Internal helpers ────────────────────────────────────────────

/**
 * Pose an arm chain (upper, lower, hand) with phase-delayed follow-through.
 * The hand lags the lower arm which lags the upper arm — creates natural drag
 * by giving each distal joint a slightly longer duration than its parent.
 */
function poseArm(tl, rig, side, { up, lo, hd, dur = 0.3, ease = EASE_OUT, pos = "<" }) {
  const u = side === "l" ? rig.upper_arm_l : rig.upper_arm_r;
  const l = side === "l" ? rig.lower_arm_l : rig.lower_arm_r;
  const h = side === "l" ? rig.hand_l       : rig.hand_r;
  tl.to(u, { rotation: up, duration: dur,        ease }, pos);
  tl.to(l, { rotation: lo, duration: dur * 1.15, ease: EASE_OUT }, `<+=${(dur * 0.05).toFixed(3)}`);
  tl.to(h, { rotation: hd, duration: dur * 1.30, ease: EASE_OUT }, `<+=${(dur * 0.04).toFixed(3)}`);
  return tl;
}

/**
 * Pose a leg chain (thigh + foot). Foot rotates relative to thigh so heel-toe
 * roll reads naturally.
 */
function poseLeg(tl, rig, side, { th, ft, dur = 0.3, ease = EASE_IO, pos = "<" }) {
  const t = side === "l" ? rig.leg_l   : rig.leg_r;
  const f = side === "l" ? rig.foot_l  : rig.foot_r;
  tl.to(t, { rotation: th, duration: dur,         ease },           pos);
  tl.to(f, { rotation: ft, duration: dur * 1.05,  ease: EASE_OUT }, "<");
  return tl;
}

/**
 * Hard reset all animatable joints to neutral. Used by walk-out / fade-out.
 */
function resetAll(tl, rig, dur = 0.3) {
  return tl.to([
    rig.leg_l, rig.leg_r, rig.foot_l, rig.foot_r,
    rig.upper_arm_l, rig.lower_arm_l, rig.hand_l,
    rig.upper_arm_r, rig.lower_arm_r, rig.hand_r,
    rig.hip, rig.torso, rig.head,
  ], { rotation: 0, x: 0, y: 0, duration: dur, ease: EASE_OUT });
}

// ── Motion preset map ───────────────────────────────────────────
export const MOTION_PRESETS = {

  // ─────────────────────────────────────────────────────────────
  //  ENTRANCES / EXITS
  // ─────────────────────────────────────────────────────────────

  /** walk_in — character walks in from off-screen with full body coordination. */
  walk_in(rig, { from = "left", steps = 6, distance = 200 } = {}) {
    const dir    = from === "left" ? 1 : -1;
    const startX = -distance * dir;
    const tl     = gsap.timeline();
    const d      = 0.26;

    tl.set(rig.root, { x: startX });

    for (let i = 0; i < steps; i++) {
      const even = i % 2 === 0;
      const sign = even ? 1 : -1;
      // Legs (front leg up, back leg planted — toes-up on swinging foot, toes-down on planted)
      poseLeg(tl, rig, "l", { th:  24 * sign, ft: even ? -10 :  18, dur: d });
      poseLeg(tl, rig, "r", { th: -24 * sign, ft: even ?  18 : -10, dur: d });
      // Arms (opposite to legs)
      poseArm(tl, rig, "l", { up: -22 * sign, lo: even ?  16 : -10, hd: even ?  18 : -10, dur: d });
      poseArm(tl, rig, "r", { up:  22 * sign, lo: even ? -10 :  16, hd: even ? -10 :  18, dur: d });
      // Hip sway + torso counter-rotation
      tl.to(rig.hip,   { rotation:  3 * sign,             duration: d, ease: "sine.inOut" }, "<")
        .to(rig.torso, { rotation: -1.5 * sign, y: even ? -3 : 0, duration: d, ease: "sine.inOut" }, "<")
        .to(rig.head,  { rotation: -1 * sign, y: even ? -1.5 : 0, duration: d, ease: "sine.inOut" }, "<")
        // Slide
        .to(rig.root,  { x: startX + (distance * (i + 1) / steps) * dir, duration: d }, "<");
    }
    resetAll(tl, rig, 0.32);
    tl.to(rig.root, { x: 0, duration: 0.18, ease: EASE_OUT }, "<");
    return tl;
  },

  /** walk_out — walk off-screen. */
  walk_out(rig, { to = "right", steps = 6, distance = 220 } = {}) {
    const dir = to === "right" ? 1 : -1;
    const tl  = gsap.timeline();
    const d   = 0.26;

    for (let i = 0; i < steps; i++) {
      const even = i % 2 === 0;
      const sign = even ? 1 : -1;
      poseLeg(tl, rig, "l", { th:  24 * sign, ft: even ? -10 :  18, dur: d });
      poseLeg(tl, rig, "r", { th: -24 * sign, ft: even ?  18 : -10, dur: d });
      poseArm(tl, rig, "l", { up: -22 * sign, lo: even ?  16 : -10, hd: even ?  18 : -10, dur: d });
      poseArm(tl, rig, "r", { up:  22 * sign, lo: even ? -10 :  16, hd: even ? -10 :  18, dur: d });
      tl.to(rig.hip,   { rotation:  3 * sign,             duration: d, ease: "sine.inOut" }, "<")
        .to(rig.torso, { rotation: -1.5 * sign, y: even ? -3 : 0, duration: d, ease: "sine.inOut" }, "<")
        .to(rig.head,  { rotation: -1 * sign, y: even ? -1.5 : 0, duration: d, ease: "sine.inOut" }, "<")
        .to(rig.root,  { x: (distance * (i + 1) / steps) * dir, duration: d }, "<");
    }
    return tl;
  },

  fade_in(rig, { dur = 0.5 } = {}) {
    return gsap.timeline()
      .set(rig.root, { opacity: 0, y: 12 })
      .to(rig.root,  { opacity: 1, y: 0, duration: dur, ease: EASE_OUT });
  },

  pop_in(rig, { dur = 0.6 } = {}) {
    return gsap.timeline()
      .set(rig.root, { scale: 0, opacity: 0 })
      .to(rig.root,  { scale: 1, opacity: 1, duration: dur, ease: ELASTIC });
  },

  // ─────────────────────────────────────────────────────────────
  //  LOCOMOTION
  // ─────────────────────────────────────────────────────────────

  /** walk_cycle — in-place walk loop with full chain articulation. */
  walk_cycle(rig, { cycles = 2, speed = 1 } = {}) {
    const d  = 0.26 / speed;
    const tl = gsap.timeline({ repeat: cycles - 1 });

    for (let i = 0; i < 2; i++) {
      const even = i % 2 === 0;
      const sign = even ? 1 : -1;
      poseLeg(tl, rig, "l", { th:  24 * sign, ft: even ? -10 :  18, dur: d });
      poseLeg(tl, rig, "r", { th: -24 * sign, ft: even ?  18 : -10, dur: d });
      poseArm(tl, rig, "l", { up: -22 * sign, lo: even ?  16 : -10, hd: even ?  18 : -10, dur: d });
      poseArm(tl, rig, "r", { up:  22 * sign, lo: even ? -10 :  16, hd: even ? -10 :  18, dur: d });
      tl.to(rig.hip,   { rotation:  3 * sign,             duration: d, ease: "sine.inOut" }, "<")
        .to(rig.torso, { rotation: -1.5 * sign, y: even ? -3 : 0, duration: d, ease: "sine.inOut" }, "<")
        .to(rig.head,  { rotation: -1 * sign, y: even ? -1.5 : 0, duration: d, ease: "sine.inOut" }, "<");
    }
    resetAll(tl, rig, 0.3);
    return tl;
  },

  /** run_cycle — faster, lower body, more extreme arm swing, forward torso lean. */
  run_cycle(rig, { cycles = 2, speed = 1 } = {}) {
    const d  = 0.16 / speed;
    const tl = gsap.timeline({ repeat: cycles - 1 });

    for (let i = 0; i < 2; i++) {
      const even = i % 2 === 0;
      const sign = even ? 1 : -1;
      // Legs: high knee lift
      poseLeg(tl, rig, "l", { th:  44 * sign, ft: even ? -18 :  22, dur: d });
      poseLeg(tl, rig, "r", { th: -44 * sign, ft: even ?  22 : -18, dur: d });
      // Arms: bent ~80° at elbow, full chain swing
      poseArm(tl, rig, "l", { up: -50 * sign, lo: even ?  60 :  30, hd: even ?  20 : -8, dur: d });
      poseArm(tl, rig, "r", { up:  50 * sign, lo: even ?  30 :  60, hd: even ?  -8 : 20, dur: d });
      // Body: hip swing, torso lean FORWARD (5°) + counter-twist, head looks ahead
      tl.to(rig.hip,   { rotation:  5 * sign,             duration: d, ease: "sine.inOut" }, "<")
        .to(rig.torso, { rotation: 5 + (-2 * sign), y: even ? -7 : -2, duration: d, ease: "sine.inOut" }, "<")
        .to(rig.head,  { rotation: -2 * sign, y: even ? -3 : 0, duration: d, ease: "sine.inOut" }, "<");
    }
    resetAll(tl, rig, 0.22);
    return tl;
  },

  // ─────────────────────────────────────────────────────────────
  //  REACTIONS
  // ─────────────────────────────────────────────────────────────

  /** jump — squash → launch → apex → fall → land squash → recover. */
  jump(rig, { height = 110, dur = 1.4 } = {}) {
    const tl = gsap.timeline();

    // 1. Anticipation crouch (0.18s)
    tl.to(rig.torso,   { scaleY: 0.85, y: 14, duration: 0.18, ease: EASE_IN })
      .to(rig.hip,     { y: 8,                duration: 0.18, ease: EASE_IN }, "<")
      .to(rig.head,    { y: 4,                duration: 0.18, ease: EASE_IN }, "<");
    poseLeg(tl, rig, "l", { th:  14, ft: -4, dur: 0.18, pos: "<" });
    poseLeg(tl, rig, "r", { th: -14, ft: -4, dur: 0.18, pos: "<" });
    poseArm(tl, rig, "l", { up:  35, lo: -10, hd: -20, dur: 0.18, pos: "<" });   // arms swung back
    poseArm(tl, rig, "r", { up: -35, lo:  10, hd:  20, dur: 0.18, pos: "<" });

    // 2. Launch (0.28s)
    tl.to(rig.root,    { y: -height, duration: 0.32, ease: "power3.out" })
      .to(rig.torso,   { scaleY: 1.12, y: -4,  duration: 0.22, ease: EASE_OUT }, "<")
      .to(rig.hip,     { y: 0,                  duration: 0.22, ease: EASE_OUT }, "<")
      .to(rig.head,    { y: -2,                 duration: 0.22, ease: EASE_OUT }, "<")
      .to(rig.shadow,  { scaleX: 0.4, opacity: 0.05, duration: 0.32 }, "<");
    poseLeg(tl, rig, "l", { th: -18, ft:  10, dur: 0.28, pos: "<" });
    poseLeg(tl, rig, "r", { th:  18, ft:  10, dur: 0.28, pos: "<" });
    poseArm(tl, rig, "l", { up: -120, lo:  15, hd:  5, dur: 0.28, pos: "<" });   // arms thrown UP
    poseArm(tl, rig, "r", { up:  120, lo: -15, hd: -5, dur: 0.28, pos: "<" });

    // 3. Fall (0.26s)
    tl.to(rig.root,    { y: 0, duration: 0.26, ease: EASE_IN })
      .to(rig.shadow,  { scaleX: 1, opacity: 1, duration: 0.26 }, "<");
    poseLeg(tl, rig, "l", { th:   6, ft: -6, dur: 0.2, pos: "<+=0.05" });
    poseLeg(tl, rig, "r", { th:  -6, ft: -6, dur: 0.2, pos: "<" });
    poseArm(tl, rig, "l", { up: -10, lo:  0, hd: 0, dur: 0.22, pos: "<" });
    poseArm(tl, rig, "r", { up:  10, lo:  0, hd: 0, dur: 0.22, pos: "<" });

    // 4. Land squash
    tl.to(rig.torso,   { scaleY: 0.8, y: 12, duration: 0.08, ease: EASE_IN })
      .to(rig.head,    { y: 6,               duration: 0.08, ease: EASE_IN }, "<");
    poseLeg(tl, rig, "l", { th:  16, ft:  4, dur: 0.08, pos: "<" });
    poseLeg(tl, rig, "r", { th: -16, ft:  4, dur: 0.08, pos: "<" });

    // 5. Recover (elastic)
    tl.to([rig.torso, rig.head], { scaleY: 1, y: 0, duration: 0.4, ease: ELASTIC });
    poseLeg(tl, rig, "l", { th: 0, ft: 0, dur: 0.34, pos: "<", ease: ELASTIC });
    poseLeg(tl, rig, "r", { th: 0, ft: 0, dur: 0.34, pos: "<", ease: ELASTIC });
    poseArm(tl, rig, "l", { up: 0, lo: 0, hd: 0, dur: 0.34, pos: "<", ease: ELASTIC_SOFT });
    poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.34, pos: "<", ease: ELASTIC_SOFT });

    return tl;
  },

  /** recoil — hit-reaction. Body slams back, head whips, arms fly out. */
  recoil(rig, { dir = -1 } = {}) {
    const tl = gsap.timeline();
    // Impact (0.08s)
    tl.to(rig.root,  { x: 22 * dir,      duration: 0.08, ease: EASE_IN })
      .to(rig.torso, { rotation: 14 * dir, duration: 0.08 }, "<")
      .to(rig.hip,   { rotation: -6 * dir, duration: 0.08 }, "<")
      .to(rig.head,  { rotation: -10 * dir, y: -8, duration: 0.08 }, "<");
    // Arms fly out behind
    poseArm(tl, rig, "l", { up: -40 - 10 * dir, lo: -30, hd: -25, dur: 0.12, pos: "<" });
    poseArm(tl, rig, "r", { up:  40 - 10 * dir, lo:  30, hd:  25, dur: 0.12, pos: "<" });
    // Legs brace
    poseLeg(tl, rig, "l", { th: -12 * dir, ft:   8, dur: 0.12, pos: "<" });
    poseLeg(tl, rig, "r", { th:  18 * dir, ft: -4, dur: 0.12, pos: "<" });

    // Recover (elastic)
    tl.to(rig.root,  { x: 0,        duration: 0.5, ease: ELASTIC })
      .to(rig.torso, { rotation: 0, duration: 0.4, ease: EASE_OUT }, "<")
      .to(rig.hip,   { rotation: 0, duration: 0.4, ease: EASE_OUT }, "<")
      .to(rig.head,  { rotation: 0, y: 0, duration: 0.35, ease: EASE_OUT }, "<");
    poseArm(tl, rig, "l", { up: 0, lo: 0, hd: 0, dur: 0.4, pos: "<" });
    poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.4, pos: "<" });
    poseLeg(tl, rig, "l", { th: 0, ft: 0, dur: 0.35, pos: "<" });
    poseLeg(tl, rig, "r", { th: 0, ft: 0, dur: 0.35, pos: "<" });
    return tl;
  },

  /** panic — frantic flail with wrist flapping. */
  panic(rig, { intensity = 1, shakes = 5 } = {}) {
    const tl = gsap.timeline();
    for (let i = 0; i < shakes; i++) {
      const s = (i % 2 === 0 ? 1 : -1) * intensity;
      tl.to(rig.torso, { rotation: 5 * s, x: 4 * s, duration: 0.1 })
        .to(rig.head,  { rotation: -8 * s,           duration: 0.1 }, "<")
        .to(rig.hip,   { rotation: -3 * s,           duration: 0.1 }, "<");
      poseArm(tl, rig, "l", { up: -75 + 20 * s, lo: -40 - 10 * s, hd: 30 * s, dur: 0.1, pos: "<" });
      poseArm(tl, rig, "r", { up:  75 - 20 * s, lo:  40 + 10 * s, hd: -30 * s, dur: 0.1, pos: "<" });
    }
    // Settle
    tl.to([rig.torso, rig.head, rig.hip], { rotation: 0, x: 0, duration: 0.35, ease: EASE_OUT });
    poseArm(tl, rig, "l", { up: 0, lo: 0, hd: 0, dur: 0.35, pos: "<" });
    poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.35, pos: "<" });
    return tl;
  },

  /** laugh — full body bounce. Head back, shoulders shake, hands relax. */
  laugh(rig, { bounces = 3 } = {}) {
    const tl = gsap.timeline();
    for (let i = 0; i < bounces; i++) {
      tl.to(rig.torso, { y: -10, scaleY: 0.9, duration: 0.16, ease: EASE_IN })
        .to(rig.head,  { rotation: -12, y: -2,  duration: 0.16, ease: EASE_IN }, "<")
        .to(rig.hip,   { y: -4,                  duration: 0.16 }, "<");
      // Shoulders shake (upper arms tiny rotation back/forth)
      tl.to(rig.upper_arm_l, { rotation: -10 + (i % 2 === 0 ? -4 : 4), duration: 0.16 }, "<")
        .to(rig.upper_arm_r, { rotation:  10 + (i % 2 === 0 ?  4 : -4), duration: 0.16 }, "<")
        .to(rig.lower_arm_l, { rotation: -22, duration: 0.16 }, "<")
        .to(rig.lower_arm_r, { rotation:  22, duration: 0.16 }, "<")
        .to(rig.hand_l,      { rotation: 0,   duration: 0.16 }, "<")
        .to(rig.hand_r,      { rotation: 0,   duration: 0.16 }, "<")
        .to(rig.torso, { y: 0,  scaleY: 1,    duration: 0.22, ease: BOUNCE })
        .to(rig.head,  { rotation: 4,         duration: 0.22, ease: EASE_OUT }, "<")
        .to(rig.hip,   { y: 0,                 duration: 0.22 }, "<");
    }
    resetAll(tl, rig, 0.25);
    return tl;
  },

  /** shake_head — "no" gesture. */
  shake_head(rig, { shakes = 3, amount = 18 } = {}) {
    const tl = gsap.timeline();
    for (let i = 0; i < shakes; i++) {
      tl.to(rig.head, { rotation:  amount, duration: 0.1, ease: EASE_IO })
        .to(rig.head, { rotation: -amount, duration: 0.1, ease: EASE_IO });
    }
    tl.to(rig.head, { rotation: 0, duration: 0.15, ease: EASE_OUT });
    return tl;
  },

  /** nod — "yes" gesture. */
  nod(rig, { nods = 2, amount = 14 } = {}) {
    const tl = gsap.timeline();
    for (let i = 0; i < nods; i++) {
      tl.to(rig.head, { rotation:  amount,       duration: 0.18, ease: EASE_IO })
        .to(rig.head, { rotation: -amount * 0.3, duration: 0.14 });
    }
    tl.to(rig.head, { rotation: 0, duration: 0.2, ease: EASE_OUT });
    return tl;
  },

  // ─────────────────────────────────────────────────────────────
  //  GESTURES
  // ─────────────────────────────────────────────────────────────

  /** point_forward — right arm extends with palm flat, index pointing. */
  point_forward(rig, { hold = false, dur = 0.32 } = {}) {
    const tl = gsap.timeline();
    // Tiny windup (anticipation pulls back)
    poseArm(tl, rig, "r", { up: 8, lo: 12, hd: -8, dur: 0.12, pos: "<" });
    // Extend
    poseArm(tl, rig, "r", { up: -78, lo: 18, hd: 6, dur, ease: BACK });
    // Slight torso lean into the point
    tl.to(rig.torso, { rotation: -3, y: -2, duration: dur, ease: BACK }, `<-=${dur * 0.9}`)
      .to(rig.head,  { rotation: -2,        duration: dur, ease: EASE_OUT }, "<");

    if (!hold) {
      poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.42, pos: "<+=0.6" });
      tl.to([rig.torso, rig.head], { rotation: 0, y: 0, duration: 0.4, ease: EASE_IO }, "<");
    }
    return tl;
  },

  /** arms_cross — fold arms across chest. Hands tuck under the opposite biceps. */
  arms_cross(rig, { hold = true, dur = 0.32 } = {}) {
    const tl = gsap.timeline();
    poseArm(tl, rig, "l", { up:  55, lo: -90, hd: -20, dur, ease: BACK });
    poseArm(tl, rig, "r", { up: -55, lo:  90, hd:  20, dur, ease: BACK, pos: "<" });
    tl.to(rig.torso, { scaleY: 1.02, y: -2, duration: dur, ease: EASE_OUT }, "<")
      .to(rig.head,  { rotation: -1,        duration: dur, ease: EASE_OUT }, "<");
    if (!hold) {
      poseArm(tl, rig, "l", { up: 0, lo: 0, hd: 0, dur: 0.42, pos: "<+=0.8" });
      poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.42, pos: "<" });
      tl.to([rig.torso, rig.head], { rotation: 0, scaleY: 1, y: 0, duration: 0.42, ease: EASE_IO }, "<");
    }
    return tl;
  },

  /** hands_up — both arms raised overhead (surrender/cheer). Hands stay relaxed. */
  hands_up(rig, { hold = false, dur = 0.4 } = {}) {
    const tl = gsap.timeline();
    // Tiny dip anticipation
    tl.to(rig.torso, { y: 3, scaleY: 0.97, duration: 0.1, ease: EASE_IN })
      .to(rig.hip,   { y: 2,               duration: 0.1, ease: EASE_IN }, "<");
    // Raise (overshoot)
    poseArm(tl, rig, "l", { up: -135, lo:  10, hd:  -8, dur, ease: BACK });
    poseArm(tl, rig, "r", { up:  135, lo: -10, hd:   8, dur, ease: BACK, pos: "<" });
    tl.to(rig.torso, { y: -4, scaleY: 1.04, duration: dur, ease: BACK }, "<")
      .to(rig.head,  { y: -2, rotation: 0,  duration: dur, ease: EASE_OUT }, "<");

    if (!hold) {
      poseArm(tl, rig, "l", { up: 0, lo: 0, hd: 0, dur: 0.5, pos: "<+=0.4", ease: ELASTIC });
      poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.5, pos: "<", ease: ELASTIC });
      tl.to([rig.torso, rig.head], { y: 0, scaleY: 1, duration: 0.45, ease: ELASTIC }, "<");
    }
    return tl;
  },

  /** wave — friendly wave with the right arm. Wrist whips, not just the forearm. */
  wave(rig, { waves = 3 } = {}) {
    const tl = gsap.timeline();
    // 1. Anticipation: small pull-back
    poseArm(tl, rig, "r", { up: -8, lo: -6, hd: -8, dur: 0.14 });
    // 2. Raise to overhead with overshoot
    poseArm(tl, rig, "r", { up: -135, lo: -30, hd: 5, dur: 0.36, ease: BACK });
    // Small torso lean toward the wave + head tilt
    tl.to(rig.torso, { rotation: -2,           duration: 0.36, ease: BACK }, "<")
      .to(rig.head,  { rotation: -3,           duration: 0.36, ease: EASE_OUT }, "<");
    // 3. WAVE — the wrist whips. Upper/lower arm stay roughly put.
    for (let i = 0; i < waves; i++) {
      tl.to(rig.hand_r,      { rotation: -38, duration: 0.14, ease: "sine.inOut" })
        .to(rig.lower_arm_r, { rotation: -18, duration: 0.14, ease: "sine.inOut" }, "<")
        .to(rig.hand_r,      { rotation:  28, duration: 0.14, ease: "sine.inOut" })
        .to(rig.lower_arm_r, { rotation: -38, duration: 0.14, ease: "sine.inOut" }, "<");
    }
    // 4. Lower
    poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.4, ease: EASE_IO, pos: "<+=0.05" });
    tl.to([rig.torso, rig.head], { rotation: 0, duration: 0.4, ease: EASE_IO }, "<");
    return tl;
  },

  /** lunge — aggressive forward lunge with full body coordination. */
  lunge(rig, { dir = 1, hold = false } = {}) {
    const tl = gsap.timeline();
    // Anticipation: small wind-back
    tl.to(rig.torso, { rotation: -6 * dir, y: 2, duration: 0.12, ease: EASE_IN })
      .to(rig.hip,   { x: -8 * dir,              duration: 0.12, ease: EASE_IN }, "<");
    poseArm(tl, rig, "r", { up: 30 * dir, lo: -20, hd: -10, dur: 0.12, pos: "<" });

    // Launch into lunge
    tl.to(rig.torso, { rotation: 18 * dir, y: -4, duration: 0.18, ease: SNAP }, ">")
      .to(rig.hip,   { x: 12 * dir, rotation: -4 * dir, duration: 0.18, ease: SNAP }, "<")
      .to(rig.head,  { rotation: -6 * dir,             duration: 0.18, ease: EASE_OUT }, "<");
    poseArm(tl, rig, "r", { up: -100 * dir, lo: 35,  hd:  20, dur: 0.18, pos: "<" });
    poseArm(tl, rig, "l", { up:   30 * dir, lo: -25, hd: -10, dur: 0.18, pos: "<" });
    // Front leg planted forward, back leg trailing
    poseLeg(tl, rig, "l", { th: -28 * dir, ft: -10, dur: 0.18, pos: "<" });
    poseLeg(tl, rig, "r", { th:  18 * dir, ft:  14, dur: 0.18, pos: "<" });
    tl.to(rig.root,  { x: 30 * dir, duration: 0.22, ease: EASE_OUT }, "<");

    if (!hold) {
      // Recover
      tl.to(rig.root,  { x: 0,        duration: 0.45, ease: EASE_IO, delay: 0.2 })
        .to([rig.torso, rig.hip, rig.head], { rotation: 0, x: 0, y: 0, duration: 0.45, ease: EASE_IO }, "<");
      poseArm(tl, rig, "l", { up: 0, lo: 0, hd: 0, dur: 0.4, pos: "<" });
      poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.4, pos: "<" });
      poseLeg(tl, rig, "l", { th: 0, ft: 0, dur: 0.4, pos: "<" });
      poseLeg(tl, rig, "r", { th: 0, ft: 0, dur: 0.4, pos: "<" });
    }
    return tl;
  },

  /** stand_firm — planted feet, chest out. Confident hero stance. */
  stand_firm(rig, { hold = false } = {}) {
    const tl = gsap.timeline()
      .to(rig.torso, { rotation: 0, scaleY: 1.04, y: -4, duration: 0.25, ease: EASE_OUT })
      .to(rig.head,  { rotation: 0, y: -1,               duration: 0.25, ease: EASE_OUT }, "<")
      .to(rig.hip,   { rotation: 0,                       duration: 0.25 }, "<");
    poseArm(tl, rig, "l", { up: -10, lo:  4, hd: -6, dur: 0.25, pos: "<" });
    poseArm(tl, rig, "r", { up:  10, lo: -4, hd:  6, dur: 0.25, pos: "<" });
    poseLeg(tl, rig, "l", { th: -8, ft: 0, dur: 0.25, pos: "<" });
    poseLeg(tl, rig, "r", { th:  8, ft: 0, dur: 0.25, pos: "<" });

    if (!hold) {
      resetAll(tl, rig, 0.4);
    }
    return tl;
  },

  // ─────────────────────────────────────────────────────────────
  //  NEW PRESETS
  // ─────────────────────────────────────────────────────────────

  /** bow — formal bow from the waist. */
  bow(rig, { depth = 38, hold = false } = {}) {
    const tl = gsap.timeline()
      .to(rig.torso, { rotation: depth, y: 4,  duration: 0.4, ease: EASE_OUT })
      .to(rig.hip,   { rotation: -depth * 0.2, duration: 0.4, ease: EASE_OUT }, "<")
      .to(rig.head,  { rotation: -depth * 0.4, y: 2, duration: 0.4, ease: EASE_OUT }, "<");
    poseArm(tl, rig, "l", { up: 14, lo:  4, hd: 0, dur: 0.4, pos: "<" });
    poseArm(tl, rig, "r", { up: -14, lo: -4, hd: 0, dur: 0.4, pos: "<" });

    if (!hold) {
      tl.to([rig.torso, rig.hip, rig.head], { rotation: 0, y: 0, duration: 0.5, ease: EASE_IO, delay: 0.4 });
      poseArm(tl, rig, "l", { up: 0, lo: 0, hd: 0, dur: 0.45, pos: "<" });
      poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.45, pos: "<" });
    }
    return tl;
  },

  /** crouch — squat down with knees and hips bent. */
  crouch(rig, { hold = false } = {}) {
    const tl = gsap.timeline()
      .to(rig.root,  { y: 30,                duration: 0.3, ease: EASE_OUT })
      .to(rig.torso, { rotation: 8, y: 6,   duration: 0.3, ease: EASE_OUT }, "<")
      .to(rig.hip,   { y: 4,                  duration: 0.3, ease: EASE_OUT }, "<")
      .to(rig.head,  { rotation: -4, y: 2,   duration: 0.3, ease: EASE_OUT }, "<");
    poseLeg(tl, rig, "l", { th:  18, ft: -12, dur: 0.3, pos: "<" });
    poseLeg(tl, rig, "r", { th: -18, ft: -12, dur: 0.3, pos: "<" });
    poseArm(tl, rig, "l", { up:  20, lo: -50, hd:  10, dur: 0.3, pos: "<" });
    poseArm(tl, rig, "r", { up: -20, lo:  50, hd: -10, dur: 0.3, pos: "<" });

    if (!hold) {
      tl.to(rig.root, { y: 0, duration: 0.4, ease: ELASTIC, delay: 0.4 });
      resetAll(tl, rig, 0.4);
    }
    return tl;
  },

  /** kick — high front kick with right leg. */
  kick(rig, { side = "r", dir = 1, hold = false } = {}) {
    const tl = gsap.timeline();
    const kickThigh = side === "r" ? -65 : 65;
    const kickFoot  = -25;
    const supportThigh = side === "r" ? 10 : -10;

    // Anticipation: lean back, raise opposite arm
    tl.to(rig.torso, { rotation: 10 * dir, y: 2, duration: 0.14, ease: EASE_IN })
      .to(rig.hip,   { rotation: -8 * dir,        duration: 0.14, ease: EASE_IN }, "<");
    poseLeg(tl, rig, side, { th: 14, ft: 4, dur: 0.14, pos: "<" });

    // Kick (snap)
    poseLeg(tl, rig, side, { th: kickThigh, ft: kickFoot, dur: 0.16, ease: SNAP });
    poseLeg(tl, rig, side === "r" ? "l" : "r", { th: supportThigh, ft: 6, dur: 0.16, pos: "<" });
    tl.to(rig.torso, { rotation: -10 * dir, y: -2, duration: 0.16, ease: SNAP }, "<")
      .to(rig.hip,   { rotation:   6 * dir,       duration: 0.16, ease: SNAP }, "<")
      .to(rig.head,  { rotation:  -4 * dir,       duration: 0.16, ease: EASE_OUT }, "<");
    // Arms swing for balance
    poseArm(tl, rig, side === "r" ? "l" : "r", { up: -50 * dir, lo: -30, hd: -10, dur: 0.16, pos: "<" });
    poseArm(tl, rig, side, { up: 30 * dir, lo: 20, hd: 10, dur: 0.16, pos: "<" });

    if (!hold) {
      resetAll(tl, rig, 0.4);
    }
    return tl;
  },

  /** think — hand to chin, head tilted, weight on one foot. */
  think(rig, { side = "r", hold = false } = {}) {
    const tl = gsap.timeline();
    const handX = side === "r" ? -6 : 6;
    poseArm(tl, rig, side, { up: side === "r" ? -50 : 50, lo: side === "r" ? -120 : 120, hd: side === "r" ? -10 : 10, dur: 0.4, ease: BACK });
    tl.to(rig.torso, { rotation: side === "r" ? -2 : 2, y: -1, duration: 0.4, ease: EASE_OUT }, "<")
      .to(rig.head,  { rotation: side === "r" ?  4 : -4, y: -1, duration: 0.4, ease: EASE_OUT }, "<")
      .to(rig.hip,   { rotation: side === "r" ?  2 : -2,        duration: 0.4 }, "<");
    poseArm(tl, rig, side === "r" ? "l" : "r", { up: side === "r" ? 8 : -8, lo: 0, hd: 0, dur: 0.4, pos: "<" });

    if (!hold) {
      resetAll(tl, rig, 0.5);
    }
    return tl;
  },

  /** shrug — shoulders up, palms out, brief hold. */
  shrug(rig, { hold = false } = {}) {
    const tl = gsap.timeline();
    poseArm(tl, rig, "l", { up:  30, lo: -50, hd: -40, dur: 0.25, ease: BACK });
    poseArm(tl, rig, "r", { up: -30, lo:  50, hd:  40, dur: 0.25, ease: BACK, pos: "<" });
    tl.to(rig.torso, { y: -3, scaleY: 1.03, duration: 0.25, ease: BACK }, "<")
      .to(rig.head,  { rotation: 0, y: -2,   duration: 0.25, ease: EASE_OUT }, "<");

    if (!hold) {
      poseArm(tl, rig, "l", { up: 0, lo: 0, hd: 0, dur: 0.4, pos: "<+=0.4" });
      poseArm(tl, rig, "r", { up: 0, lo: 0, hd: 0, dur: 0.4, pos: "<" });
      tl.to([rig.torso, rig.head], { y: 0, scaleY: 1, duration: 0.4, ease: EASE_IO }, "<");
    }
    return tl;
  },

  /** celebrate — small jump with hands up + a happy spin. */
  celebrate(rig, { hops = 2 } = {}) {
    const tl = gsap.timeline();
    for (let i = 0; i < hops; i++) {
      // mini hop
      tl.to(rig.root,    { y: -28, duration: 0.18, ease: EASE_OUT })
        .to(rig.shadow,  { scaleX: 0.7, opacity: 0.15, duration: 0.18 }, "<")
        .to(rig.torso,   { scaleY: 1.08, duration: 0.18, ease: EASE_OUT }, "<");
      poseArm(tl, rig, "l", { up: -130, lo: 15, hd: -5, dur: 0.18, pos: "<" });
      poseArm(tl, rig, "r", { up:  130, lo: -15, hd: 5, dur: 0.18, pos: "<" });
      poseLeg(tl, rig, "l", { th: -10, ft: -6, dur: 0.18, pos: "<" });
      poseLeg(tl, rig, "r", { th:  10, ft: -6, dur: 0.18, pos: "<" });
      // Land
      tl.to(rig.root,    { y: 0, duration: 0.2, ease: BOUNCE })
        .to(rig.shadow,  { scaleX: 1, opacity: 1, duration: 0.2 }, "<")
        .to(rig.torso,   { scaleY: 0.94, duration: 0.08 }, "<")
        .to(rig.torso,   { scaleY: 1,    duration: 0.18, ease: ELASTIC });
      poseLeg(tl, rig, "l", { th: 0, ft: 0, dur: 0.16, pos: "<" });
      poseLeg(tl, rig, "r", { th: 0, ft: 0, dur: 0.16, pos: "<" });
    }
    resetAll(tl, rig, 0.3);
    return tl;
  },

  /** taunt — hand-flick "come at me" gesture. */
  taunt(rig, { side = "r", flicks = 3 } = {}) {
    const tl = gsap.timeline();
    const upper = side === "r" ? -55 : 55;
    const lower = side === "r" ?  -65 : 65;
    poseArm(tl, rig, side, { up: upper, lo: lower, hd: 0, dur: 0.3, ease: BACK });
    tl.to(rig.torso, { rotation: side === "r" ? 3 : -3, y: -2, duration: 0.3, ease: EASE_OUT }, "<")
      .to(rig.head,  { rotation: side === "r" ? 4 : -4,        duration: 0.3, ease: EASE_OUT }, "<");

    // Flick fingers
    for (let i = 0; i < flicks; i++) {
      const handPart = side === "r" ? rig.hand_r : rig.hand_l;
      tl.to(handPart, { rotation:  20, duration: 0.12, ease: "sine.inOut" })
        .to(handPart, { rotation: -10, duration: 0.12, ease: "sine.inOut" });
    }

    poseArm(tl, rig, side, { up: 0, lo: 0, hd: 0, dur: 0.4, pos: "<+=0.05" });
    tl.to([rig.torso, rig.head], { rotation: 0, y: 0, duration: 0.4, ease: EASE_IO }, "<");
    return tl;
  },

  /** turn_around — character turns to face the other direction. */
  turn_around(rig, { dur = 0.5 } = {}) {
    return gsap.timeline()
      .to(rig.root, { scaleX: -rig.root.style.transform.includes("scale(-1") ? 1 : -1,
                       duration: dur, ease: EASE_IO });
  },
};

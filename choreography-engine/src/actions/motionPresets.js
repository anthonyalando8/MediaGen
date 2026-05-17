import { gsap } from "gsap";

/**
 * motionPresets.js
 * ----------------
 * Body action GSAP timeline factories.
 * Each preset receives (rig, opts) and returns a finite GSAP timeline.
 *
 * Design rules:
 *   - Presets are FINITE (no repeat: -1). The idle layer handles loops.
 *   - Every preset leaves the rig in a clean resting state when it ends
 *     OR accepts a `hold = true` opt to freeze at peak pose.
 *   - Opts always have sensible defaults — callers can override anything.
 *   - Expression changes are NOT inside motion presets — the ActionRegistry
 *     layers them separately so they compose independently.
 */

// ── Shared eases ─────────────────────────────────────────────────
const EASE_IN  = "power2.in";
const EASE_OUT = "power2.out";
const EASE_IO  = "power2.inOut";
const BOUNCE   = "bounce.out";
const ELASTIC  = "elastic.out(1, 0.5)";

// ── Helpers ───────────────────────────────────────────────────────
// Reset all limbs to neutral pose
function resetLimbs(rig, dur = 0.3) {
  return gsap.timeline()
    .to([
      rig.leg_l, rig.leg_r,
      rig.upper_arm_l, rig.lower_arm_l,
      rig.upper_arm_r, rig.lower_arm_r,
      rig.hip, rig.torso, rig.head,
    ], { rotation: 0, x: 0, y: 0, duration: dur, ease: EASE_OUT });
}

// ── Motion preset map ─────────────────────────────────────────────
export const MOTION_PRESETS = {

  // ── Entrances / Exits ─────────────────────────────────────────

  /**
   * walk_in — character walks in from off-screen
   * opts: { from: "left"|"right", steps: 6, distance: 160 }
   */
  walk_in(rig, { from = "left", steps = 6, distance = 160 } = {}) {
    const dir    = from === "left" ? 1 : -1;
    const startX = -distance * dir;
    const tl     = gsap.timeline();

    // Use tl.set() so this fires when the timeline plays, NOT at build time
    tl.set(rig.root, { x: startX });

    // Walk cycle while sliding in
    const stepDur = 0.22;
    for (let i = 0; i < steps; i++) {
      const even = i % 2 === 0;
      tl.to(rig.leg_l,       { rotation: even ?  24 : -24, duration: stepDur, ease: EASE_IO })
        .to(rig.leg_r,       { rotation: even ? -24 :  24, duration: stepDur, ease: EASE_IO }, "<")
        .to(rig.upper_arm_r, { rotation: even ?  28 : -28, duration: stepDur }, "<")
        .to(rig.upper_arm_l, { rotation: even ? -28 :  28, duration: stepDur }, "<")
        .to(rig.hip,         { rotation: even ?   3 :  -3, duration: stepDur, ease: "sine.inOut" }, "<")
        .to(rig.torso,       { y: even ? -3 : 0,            duration: stepDur / 2 }, "<")
        .to(rig.root,        { x: startX + (distance * (i + 1) / steps) * dir, duration: stepDur }, "<");
    }

    // Settle at x=0
    tl.to([rig.leg_l, rig.leg_r, rig.upper_arm_l, rig.upper_arm_r, rig.hip], {
      rotation: 0, duration: 0.3, ease: EASE_OUT,
    })
    .to(rig.root, { x: 0, duration: 0.15, ease: EASE_OUT }, "<");

    return tl;
  },

  /**
   * walk_out — walk off-screen
   * opts: { to: "left"|"right", steps: 6, distance: 160 }
   */
  walk_out(rig, { to = "right", steps = 6, distance = 160 } = {}) {
    const dir = to === "right" ? 1 : -1;
    const tl  = gsap.timeline();
    const stepDur = 0.22;

    for (let i = 0; i < steps; i++) {
      const even = i % 2 === 0;
      tl.to(rig.leg_l,       { rotation: even ?  24 : -24, duration: stepDur, ease: EASE_IO })
        .to(rig.leg_r,       { rotation: even ? -24 :  24, duration: stepDur, ease: EASE_IO }, "<")
        .to(rig.upper_arm_r, { rotation: even ?  28 : -28, duration: stepDur }, "<")
        .to(rig.upper_arm_l, { rotation: even ? -28 :  28, duration: stepDur }, "<")
        .to(rig.hip,         { rotation: even ?   3 :  -3, duration: stepDur, ease: "sine.inOut" }, "<")
        .to(rig.root,        { x: (distance * (i + 1) / steps) * dir, duration: stepDur }, "<");
    }

    return tl;
  },

  /**
   * fade_in — character fades in from invisible.
   * IMPORTANT: uses tl.set() not fromTo() — fromTo() applies "from" values
   * immediately at tween creation (GSAP 3 behavior), making the character
   * invisible at build time. tl.set() defers until the timeline plays.
   */
  fade_in(rig, { dur = 0.5 } = {}) {
    return gsap.timeline()
      .set(rig.root, { opacity: 0 })
      .to(rig.root,  { opacity: 1, duration: dur, ease: EASE_OUT });
  },

  /**
   * pop_in — elastic scale-in entrance
   * Same tl.set() pattern — never fromTo().
   */
  pop_in(rig, { dur = 0.5 } = {}) {
    return gsap.timeline()
      .set(rig.root, { scale: 0, opacity: 0 })
      .to(rig.root,  { scale: 1, opacity: 1, duration: dur, ease: ELASTIC });
  },

  // ── Locomotion ────────────────────────────────────────────────

  /**
   * walk_cycle — in-place walk loop
   * opts: { cycles: 2, speed: 1 }
   */
  walk_cycle(rig, { cycles = 2, speed = 1 } = {}) {
    const d   = 0.22 / speed;
    const tl  = gsap.timeline({ repeat: cycles - 1 });

    for (let i = 0; i < 2; i++) {
      const even = i % 2 === 0;
      tl.to(rig.leg_l,       { rotation: even ?  24 : -24, duration: d, ease: EASE_IO })
        .to(rig.leg_r,       { rotation: even ? -24 :  24, duration: d, ease: EASE_IO }, "<")
        .to(rig.upper_arm_r, { rotation: even ?  28 : -28, duration: d }, "<")
        .to(rig.upper_arm_l, { rotation: even ? -28 :  28, duration: d }, "<")
        .to(rig.hip,         { rotation: even ?   3 :  -3, duration: d, ease: "sine.inOut" }, "<")
        .to(rig.torso,       { y: even ? -3 : 0,           duration: d / 2 }, "<");
    }

    // Settle
    tl.to([rig.leg_l, rig.leg_r, rig.upper_arm_l, rig.upper_arm_r, rig.hip, rig.torso], {
      rotation: 0, y: 0, duration: 0.25, ease: EASE_OUT,
    });

    return tl;
  },

  /**
   * run_cycle — faster, more exaggerated than walk
   */
  run_cycle(rig, { cycles = 2, speed = 1 } = {}) {
    const d  = 0.14 / speed;
    const tl = gsap.timeline({ repeat: cycles - 1 });

    for (let i = 0; i < 2; i++) {
      const even = i % 2 === 0;
      tl.to(rig.leg_l,       { rotation: even ?  40 : -40, duration: d, ease: EASE_IO })
        .to(rig.leg_r,       { rotation: even ? -40 :  40, duration: d, ease: EASE_IO }, "<")
        .to(rig.upper_arm_r, { rotation: even ?  50 : -50, duration: d }, "<")
        .to(rig.upper_arm_l, { rotation: even ? -50 :  50, duration: d }, "<")
        .to(rig.lower_arm_r, { rotation: even ?  30 : -20, duration: d }, "<")
        .to(rig.lower_arm_l, { rotation: even ? -20 :  30, duration: d }, "<")
        .to(rig.hip,         { rotation: even ?   5 :  -5, duration: d, ease: "sine.inOut" }, "<")
        .to(rig.torso,       { rotation: even ?  -3 :   3, duration: d }, "<")
        .to(rig.torso,       { y: even ? -6 : 0,           duration: d / 2 }, "<");
    }

    tl.to([rig.leg_l, rig.leg_r, rig.upper_arm_l, rig.lower_arm_l,
           rig.upper_arm_r, rig.lower_arm_r, rig.hip, rig.torso], {
      rotation: 0, y: 0, duration: 0.2, ease: EASE_OUT,
    });

    return tl;
  },

  // ── Reactions ─────────────────────────────────────────────────

  /**
   * jump — full squash/stretch jump with shadow
   */
  jump(rig, { height = 90, dur = 1.2 } = {}) {
    return gsap.timeline()
      // Crouch
      .to(rig.torso,              { scaleY: 0.86, y: 12,   duration: 0.13, ease: EASE_IN })
      .to([rig.leg_l, rig.leg_r], { rotation: 12,          duration: 0.13 }, "<")
      // Launch
      .to(rig.root,               { y: -height,            duration: 0.32, ease: "power3.out" })
      .to(rig.torso,              { scaleY: 1.1,  y: 0,    duration: 0.18 }, "<")
      .to([rig.leg_l, rig.leg_r], { rotation: -20,         duration: 0.2  }, "<")
      .to(rig.shadow,             { scaleX: 0.4, opacity: 0.05, duration: 0.32 }, "<")
      // Peak arm raise
      .to(rig.upper_arm_l,        { rotation: -60,         duration: 0.2 }, "<")
      .to(rig.upper_arm_r,        { rotation:  60,         duration: 0.2 }, "<")
      // Fall
      .to(rig.root,               { y: 0,                  duration: 0.28, ease: BOUNCE })
      .to(rig.shadow,             { scaleX: 1, opacity: 1, duration: 0.28 }, "<")
      // Land squash
      .to(rig.torso,              { scaleY: 0.82, y: 10,   duration: 0.07 })
      .to([rig.leg_l, rig.leg_r], { rotation: 10,          duration: 0.07 }, "<")
      .to(rig.upper_arm_l,        { rotation: 0,           duration: 0.07 }, "<")
      .to(rig.upper_arm_r,        { rotation: 0,           duration: 0.07 }, "<")
      // Recover
      .to(rig.torso,              { scaleY: 1, y: 0,       duration: 0.35, ease: ELASTIC })
      .to([rig.leg_l, rig.leg_r], { rotation: 0,           duration: 0.28, ease: EASE_OUT }, "<");
  },

  /**
   * recoil — hit reaction, stumbles backward
   */
  recoil(rig, { dir = -1 } = {}) {
    return gsap.timeline()
      .to(rig.root,               { x: 18 * dir,           duration: 0.08, ease: EASE_IN })
      .to(rig.torso,              { rotation: 12 * dir,    duration: 0.08 }, "<")
      .to(rig.head,               { rotation: -8 * dir, y: -6, duration: 0.08 }, "<")
      .to(rig.upper_arm_l,        { rotation: -35,         duration: 0.1  }, "<")
      .to(rig.upper_arm_r,        { rotation:  35,         duration: 0.1  }, "<")
      .to(rig.root,               { x: 0,                  duration: 0.5, ease: ELASTIC })
      .to(rig.torso,              { rotation: 0,           duration: 0.4, ease: EASE_OUT }, "<")
      .to(rig.head,               { rotation: 0, y: 0,     duration: 0.3, ease: EASE_OUT }, "<")
      .to([rig.upper_arm_l, rig.upper_arm_r], { rotation: 0, duration: 0.3, ease: EASE_OUT }, "<");
  },

  /**
   * panic — frantic arm flail + torso shake
   */
  panic(rig, { intensity = 1 } = {}) {
    const tl = gsap.timeline();
    const shakes = [
      [  5, -70,  70],
      [ -5, -50,  50],
      [  6, -75,  75],
      [ -4, -55,  55],
      [  3, -60,  60],
    ];
    shakes.forEach(([torsoR, armL, armR]) => {
      tl.to(rig.torso,       { rotation: torsoR * intensity, duration: 0.1 })
        .to(rig.upper_arm_l, { rotation: armL   * intensity, duration: 0.1 }, "<")
        .to(rig.upper_arm_r, { rotation: armR   * intensity, duration: 0.1 }, "<")
        .to(rig.head,        { rotation: -torsoR * 0.5,      duration: 0.1 }, "<");
    });
    // Settle
    tl.to([rig.torso, rig.upper_arm_l, rig.upper_arm_r, rig.head], {
      rotation: 0, duration: 0.35, ease: EASE_OUT,
    });
    return tl;
  },

  /**
   * laugh — body bounce with head thrown back
   */
  laugh(rig, { bounces = 3 } = {}) {
    const tl = gsap.timeline();
    for (let i = 0; i < bounces; i++) {
      tl.to(rig.torso, { y: -8,  scaleY: 0.9,  duration: 0.15, ease: EASE_IN  })
        .to(rig.head,  { rotation: -10,         duration: 0.15, ease: EASE_IN  }, "<")
        .to(rig.torso, { y: 0,   scaleY: 1,     duration: 0.2,  ease: BOUNCE   })
        .to(rig.head,  { rotation: 5,            duration: 0.2,  ease: EASE_OUT }, "<");
    }
    tl.to([rig.torso, rig.head], { y: 0, rotation: 0, scaleY: 1, duration: 0.2, ease: EASE_OUT });
    return tl;
  },

  /**
   * shake_head — horizontal head shake (no / disagreement)
   */
  shake_head(rig, { shakes = 3, amount = 18 } = {}) {
    const tl = gsap.timeline();
    for (let i = 0; i < shakes; i++) {
      tl.to(rig.head, { rotation:  amount, duration: 0.1, ease: EASE_IO })
        .to(rig.head, { rotation: -amount, duration: 0.1, ease: EASE_IO });
    }
    tl.to(rig.head, { rotation: 0, duration: 0.15, ease: EASE_OUT });
    return tl;
  },

  /**
   * nod — vertical head nod (yes / agreement)
   */
  nod(rig, { nods = 2, amount = 14 } = {}) {
    const tl = gsap.timeline();
    for (let i = 0; i < nods; i++) {
      tl.to(rig.head, { rotation:  amount, duration: 0.18, ease: EASE_IO })
        .to(rig.head, { rotation: -amount * 0.3, duration: 0.14 });
    }
    tl.to(rig.head, { rotation: 0, duration: 0.2, ease: EASE_OUT });
    return tl;
  },

  // ── Gestures ──────────────────────────────────────────────────

  /**
   * point_forward — extend right arm pointing ahead
   * opts: { hold: false } — if true, stays extended
   */
  point_forward(rig, { hold = false } = {}) {
    const tl = gsap.timeline()
      .to(rig.upper_arm_r, { rotation: -72, duration: 0.28, ease: EASE_OUT })
      .to(rig.lower_arm_r, { rotation:  22, duration: 0.2,  ease: EASE_OUT }, "<0.05");

    if (!hold) {
      tl.to(rig.upper_arm_r, { rotation: 0, duration: 0.4, ease: EASE_IO, delay: 0.9 })
        .to(rig.lower_arm_r, { rotation: 0, duration: 0.3, ease: EASE_IO }, "<");
    }

    return tl;
  },

  /**
   * arms_cross — fold arms across chest
   */
  arms_cross(rig, { hold = true } = {}) {
    const tl = gsap.timeline()
      .to(rig.upper_arm_l, { rotation:  50, duration: 0.3, ease: EASE_IO })
      .to(rig.upper_arm_r, { rotation: -50, duration: 0.3, ease: EASE_IO }, "<")
      .to(rig.lower_arm_l, { rotation: -80, duration: 0.25, ease: EASE_IO }, "<0.05")
      .to(rig.lower_arm_r, { rotation:  80, duration: 0.25, ease: EASE_IO }, "<");

    if (!hold) {
      tl.to([rig.upper_arm_l, rig.upper_arm_r, rig.lower_arm_l, rig.lower_arm_r], {
        rotation: 0, duration: 0.4, ease: EASE_IO, delay: 0.8,
      });
    }

    return tl;
  },

  /**
   * hands_up — raise both arms (surrender / excitement)
   */
  hands_up(rig, { hold = false } = {}) {
    const tl = gsap.timeline()
      .to(rig.upper_arm_l, { rotation: -130, duration: 0.35, ease: EASE_OUT })
      .to(rig.upper_arm_r, { rotation:  130, duration: 0.35, ease: EASE_OUT }, "<")
      .to(rig.lower_arm_l, { rotation:   15, duration: 0.25 }, "<0.05")
      .to(rig.lower_arm_r, { rotation:  -15, duration: 0.25 }, "<");

    if (!hold) {
      tl.to([rig.upper_arm_l, rig.upper_arm_r, rig.lower_arm_l, rig.lower_arm_r], {
        rotation: 0, duration: 0.5, ease: ELASTIC, delay: 0.5,
      });
    }

    return tl;
  },

  /**
   * wave — friendly wave gesture with right hand
   * opts: { waves: 3 }
   */
  wave(rig, { waves = 3 } = {}) {
    const tl = gsap.timeline()
      // Raise arm
      .to(rig.upper_arm_r, { rotation: 110, duration: 0.3, ease: EASE_OUT })
      .to(rig.lower_arm_r, { rotation:  20, duration: 0.2 }, "<0.05");

    // Wrist wag
    for (let i = 0; i < waves; i++) {
      tl.to(rig.lower_arm_r, { rotation:  40, duration: 0.12, ease: EASE_IO })
        .to(rig.lower_arm_r, { rotation:   5, duration: 0.12, ease: EASE_IO });
    }

    // Lower arm
    tl.to(rig.upper_arm_r, { rotation: 0, duration: 0.35, ease: EASE_IO })
      .to(rig.lower_arm_r, { rotation: 0, duration: 0.3, ease: EASE_IO }, "<");

    return tl;
  },

  /**
   * lunge — aggressive forward lunge
   * opts: { dir: 1 (right) | -1 (left) }
   */
  lunge(rig, { dir = 1 } = {}) {
    return gsap.timeline()
      .to(rig.torso,       { rotation: 20 * dir, y: -5,  duration: 0.15, ease: EASE_IN })
      .to(rig.upper_arm_r, { rotation: -80 * dir,        duration: 0.15 }, "<")
      .to(rig.lower_arm_r, { rotation:  30 * dir,        duration: 0.15 }, "<")
      .to(rig.leg_l,       { rotation: -25 * dir,        duration: 0.15 }, "<")
      .to(rig.leg_r,       { rotation:  15 * dir,        duration: 0.15 }, "<")
      .to(rig.root,        { x: 30 * dir,                duration: 0.2,  ease: EASE_OUT })
      // Hold at peak for 0.3s then recover
      .to(rig.torso,       { rotation: 0, y: 0,          duration: 0.4,  ease: EASE_IO, delay: 0.3 })
      .to(rig.root,        { x: 0,                       duration: 0.4,  ease: EASE_IO }, "<")
      .to([rig.upper_arm_r, rig.lower_arm_r, rig.leg_l, rig.leg_r], {
        rotation: 0, duration: 0.35, ease: EASE_IO,
      }, "<");
  },

  /**
   * stand_firm — plant feet, chest out, resolute pose
   */
  stand_firm(rig, { hold = false } = {}) {
    const tl = gsap.timeline()
      .to(rig.torso,       { rotation: 0, scaleY: 1.04, y: -4, duration: 0.2, ease: EASE_OUT })
      .to(rig.upper_arm_l, { rotation: -15,             duration: 0.2, ease: EASE_OUT }, "<")
      .to(rig.upper_arm_r, { rotation:  15,             duration: 0.2, ease: EASE_OUT }, "<")
      .to(rig.leg_l,       { rotation: -8,              duration: 0.2, ease: EASE_OUT }, "<")
      .to(rig.leg_r,       { rotation:  8,              duration: 0.2, ease: EASE_OUT }, "<");

    if (!hold) {
      tl.to([rig.torso, rig.upper_arm_l, rig.upper_arm_r, rig.leg_l, rig.leg_r], {
        rotation: 0, scaleY: 1, y: 0, duration: 0.4, ease: EASE_IO, delay: 0.6,
      });
    }

    return tl;
  },
};
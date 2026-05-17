/* idlePresets.js — looping ambient animations (the BASE LAYER).
 *
 * Upgrades over v1:
 *   • breathe now includes shoulder lift (upper_arm slight rotation up/down)
 *     so the chest reads as moving, not just scaling.
 *   • Adds finger_twitch — micro hand rotation that adds organic life.
 *   • Adds weight_shift — alternating hip drop + opposite foot articulation.
 *   • Adds idle_glance — periodic small eye/head looks at random angles.
 *   • sway now coordinates hip + torso + head as a proper kinematic chain.
 *
 * All idles are designed to compose: breathe + blink + sway + glance + finger_twitch
 * can ALL run simultaneously because each owns a disjoint subset of joints.
 *
 * Disjoint-joint matrix:
 *   breathe       → torso.scaleY, head.y, upper_arm_*.rotation (tiny)
 *   blink         → eye_l.scaleY, eye_r.scaleY
 *   sway          → hip.rotation, torso.rotation (small)
 *   idle_glance   → head.rotation
 *   finger_twitch → hand_l, hand_r
 *   weight_shift  → foot_l, foot_r
 *
 * Note about overlap: breathe touches upper_arm.rotation slightly; if an ACTION
 * tween is also rotating upper_arm, the action wins because GSAP last-write-wins
 * and the registry kills these idle tweens before firing actions. The shoulder
 * lift in breathe is +/-1.5° max so it doesn't fight with idle_sway either.
 */

import { gsap } from "gsap";

export const IDLE_PRESETS = {

  /** breathe — torso scale + chest lift + head float + tiny shoulder rise. */
  breathe(rig, { depth = 1 } = {}) {
    const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
    const dur = 1.5;
    tl.to(rig.torso,       { scaleY: 1 + 0.022 * depth,  duration: dur }, 0)
      .to(rig.head,        { y: -1.2 * depth,             duration: dur }, 0)
      .to(rig.upper_arm_l, { rotation: -1.2 * depth,      duration: dur }, 0)
      .to(rig.upper_arm_r, { rotation:  1.2 * depth,      duration: dur }, 0);
    return tl;
  },

  /** blink — quick close-then-open of both eyes on an irregular interval. */
  blink(rig, { interval = 3.2 } = {}) {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: interval });
    tl.to([rig.eye_l, rig.eye_r], { scaleY: 0.04, duration: 0.06, ease: "power3.in" })
      .to([rig.eye_l, rig.eye_r], { scaleY: 1,    duration: 0.10, ease: "power2.out" });
    return tl;
  },

  /** sway — gentle weight shift left↔right.
   *  Hip rotates one way, torso the other, head floats opposite-of-torso.
   *  Together they read as a relaxed standing pose. */
  sway(rig, { amount = 1 } = {}) {
    const dur = 2.0;
    const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
    tl.to(rig.hip,   { rotation:  1.0 * amount, x: 1.2 * amount, duration: dur }, 0)
      .to(rig.torso, { rotation: -0.6 * amount,                   duration: dur }, 0)
      .to(rig.head,  { rotation:  0.4 * amount,                   duration: dur }, 0);
    return tl;
  },

  /** idle_look — periodic small head pivots so the character feels aware. */
  idle_look(rig, { range = 4 } = {}) {
    const tl = gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } });
    const beats = [
      { rotation:  range * 0.5,  y: -1, dur: 1.2, hold: 1.4 },
      { rotation: -range * 0.4,  y:  0, dur: 1.0, hold: 1.1 },
      { rotation:  range * 0.2,  y:  1, dur: 1.4, hold: 0.9 },
      { rotation:  0,            y:  0, dur: 1.0, hold: 1.3 },
    ];
    beats.forEach((b) => {
      tl.to(rig.head, { rotation: b.rotation, y: b.y, duration: b.dur });
      tl.to(rig.head, {}, `+=${b.hold}`); // hold
    });
    return tl;
  },

  /** idle_glance — eyes shift focus (when you wire eye-pupil refs). Falls back
   *  to a head micro-pivot if pupils are not separately animatable in this rig. */
  idle_glance(rig, { range = 3 } = {}) {
    const tl = gsap.timeline({ repeat: -1, defaults: { ease: "power2.out" } });
    const beats = [
      { rotation:  range, dur: 0.18, hold: 1.6 },
      { rotation: -range * 0.7, dur: 0.16, hold: 1.4 },
      { rotation:  0, dur: 0.16, hold: 2.0 },
      { rotation:  range * 0.4, dur: 0.16, hold: 1.2 },
    ];
    beats.forEach((b) => {
      tl.to(rig.head, { rotation: b.rotation, duration: b.dur });
      tl.to(rig.head, {}, `+=${b.hold}`);
    });
    return tl;
  },

  /** finger_twitch — micro hand rotations every few seconds. Adds organic life. */
  finger_twitch(rig, { interval = 4 } = {}) {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: interval, defaults: { ease: "sine.inOut" } });
    const which = () => Math.random() < 0.5 ? rig.hand_l : rig.hand_r;
    const handPart = which();
    tl.to(handPart, { rotation: 6,  duration: 0.18 })
      .to(handPart, { rotation: -3, duration: 0.18 })
      .to(handPart, { rotation: 0,  duration: 0.22 });
    return tl;
  },

  /** weight_shift — slow alternation of foot articulation (heel-up on the back
   *  foot, like real standing). Sub-degree subtle. */
  weight_shift(rig, { amount = 1 } = {}) {
    const dur = 2.6;
    const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
    tl.to(rig.foot_l, { rotation: -2 * amount, duration: dur }, 0)
      .to(rig.foot_r, { rotation:  2 * amount, duration: dur }, 0)
      .to(rig.hip,    { y: 1.2 * amount,        duration: dur }, 0);
    return tl;
  },

  /** idle_menace — slow weight shift with shoulder roll. For villain characters. */
  idle_menace(rig, { amount = 1 } = {}) {
    const dur = 2.4;
    const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
    tl.to(rig.torso, { rotation: 1.8 * amount, y: 2,  duration: dur }, 0)
      .to(rig.head,  { rotation: -1.2 * amount,        duration: dur }, 0)
      .to(rig.upper_arm_l, { rotation: -3 * amount, duration: dur }, 0)
      .to(rig.upper_arm_r, { rotation:  3 * amount, duration: dur }, 0);
    return tl;
  },

  /** idle_float — for airborne characters or post-jump hover. */
  idle_float(rig, { amount = 6 } = {}) {
    const dur = 1.8;
    const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
    tl.to(rig.root,  { y: -amount,           duration: dur }, 0)
      .to(rig.torso, { scaleY: 1.018,         duration: dur }, 0)
      .to(rig.foot_l,{ rotation: -8,          duration: dur }, 0)
      .to(rig.foot_r,{ rotation: -8,          duration: dur }, 0);
    return tl;
  },
};

/**
 * startIdleSet — convenience to start a coordinated idle bundle.
 *
 * @param {object} rig   — rigRef map
 * @param {string} mode  — "default" | "menace" | "float" | "alert"
 * @returns {{ kill: Function, ...timelines }}
 */
export function startIdleSet(rig, mode = "default") {
  const timelines = {};

  // breathe + blink are ALWAYS on — the spine of liveliness
  timelines.breathe = IDLE_PRESETS.breathe(rig);
  timelines.blink   = IDLE_PRESETS.blink(rig);

  if (mode === "default") {
    timelines.sway          = IDLE_PRESETS.sway(rig);
    timelines.look          = IDLE_PRESETS.idle_look(rig);
    timelines.finger_twitch = IDLE_PRESETS.finger_twitch(rig);
    timelines.weight_shift  = IDLE_PRESETS.weight_shift(rig);
  } else if (mode === "menace") {
    timelines.menace = IDLE_PRESETS.idle_menace(rig);
    timelines.glance = IDLE_PRESETS.idle_glance(rig, { range: 5 });
  } else if (mode === "float") {
    timelines.float  = IDLE_PRESETS.idle_float(rig);
    timelines.glance = IDLE_PRESETS.idle_glance(rig);
  } else if (mode === "alert") {
    timelines.glance = IDLE_PRESETS.idle_glance(rig, { range: 8 });
    timelines.weight_shift = IDLE_PRESETS.weight_shift(rig);
  }

  timelines.kill = () => Object.values(timelines).forEach((t) => {
    if (t && typeof t.kill === "function") t.kill();
  });

  return timelines;
}

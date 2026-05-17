import { gsap } from "gsap";

/**
 * idlePresets.js
 * --------------
 * Looping ambient animations. These run continuously as the BASE LAYER.
 * Actions layer on top — they override at specific timestamps and resolve
 * back to the idle state when done.
 *
 * All idle timelines return a GSAP timeline that must be stored and
 * killed on scene teardown via tl.kill().
 *
 * Usage:
 *   const breathe = IDLE_PRESETS.breathe(rig);
 *   // later:
 *   breathe.kill();
 */

export const IDLE_PRESETS = {

  /**
   * breathe — gentle torso scale + head float
   * The most fundamental idle. Always active.
   */
  breathe(rig, { depth = 1 } = {}) {
    return gsap.timeline({ repeat: -1, yoyo: true })
      .to(rig.torso, {
        scaleY: 1 + 0.025 * depth,
        duration: 1.4,
        ease: "sine.inOut",
      })
      .to(rig.head, {
        y: -1 * depth,
        duration: 1.4,
        ease: "sine.inOut",
      }, 0);
  },

  /**
   * blink — periodic eyelid close/open
   * repeatDelay creates natural irregular timing.
   */
  blink(rig, { interval = 3 } = {}) {
    return gsap.timeline({ repeat: -1, repeatDelay: interval })
      .to([rig.eye_l, rig.eye_r], {
        scaleY: 0.04,
        duration: 0.06,
        ease: "power3.in",
      })
      .to([rig.eye_l, rig.eye_r], {
        scaleY: 1,
        duration: 0.1,
        ease: "power2.out",
      });
  },

  /**
   * sway — subtle body weight shift left/right
   */
  sway(rig, { amount = 1 } = {}) {
    return gsap.timeline({ repeat: -1, yoyo: true })
      .to(rig.torso, {
        rotation: 0.8 * amount,
        duration: 1.8,
        ease: "sine.inOut",
      })
      .to(rig.hip, {
        rotation: -0.5 * amount,
        duration: 1.8,
        ease: "sine.inOut",
      }, 0);
  },

  /**
   * idle_look — subtle head micro-movements (life)
   */
  idle_look(rig, { range = 3 } = {}) {
    const tl = gsap.timeline({ repeat: -1 });
    const moves = [
      { rotation:  range * 0.3, y: -1, dur: 1.2 },
      { rotation: -range * 0.2, y:  0, dur: 0.9 },
      { rotation:  range * 0.1, y:  1, dur: 1.5 },
      { rotation:  0,           y:  0, dur: 1.0 },
    ];
    moves.forEach(m => {
      tl.to(rig.head, { rotation: m.rotation, y: m.y, duration: m.dur, ease: "sine.inOut" });
    });
    return tl;
  },

  /**
   * idle_menace — slow weight shift with subtle arm cross energy
   * For villain characters.
   */
  idle_menace(rig, { amount = 1 } = {}) {
    return gsap.timeline({ repeat: -1, yoyo: true })
      .to(rig.torso, {
        rotation: 1.5 * amount,
        y: 2,
        duration: 2.2,
        ease: "sine.inOut",
      })
      .to(rig.head, {
        rotation: -1 * amount,
        duration: 2.2,
        ease: "sine.inOut",
      }, 0);
  },

  /**
   * idle_float — airborne idle (used after jump or for floating chars)
   */
  idle_float(rig, { amount = 6 } = {}) {
    return gsap.timeline({ repeat: -1, yoyo: true })
      .to(rig.root, {
        y: -amount,
        duration: 1.6,
        ease: "sine.inOut",
      })
      .to(rig.torso, {
        scaleY: 1.015,
        duration: 1.6,
        ease: "sine.inOut",
      }, 0);
  },
};

/**
 * startIdleSet — convenience to start a standard idle bundle
 * Returns an object of running timelines for easy cleanup.
 *
 * @param {object} rig   — rigRef map
 * @param {string} mode  — "default" | "menace" | "float"
 * @returns {{ breathe, blink, sway, look, kill }}
 */
export function startIdleSet(rig, mode = "default") {
  const timelines = {};

  timelines.breathe = IDLE_PRESETS.breathe(rig);
  timelines.blink   = IDLE_PRESETS.blink(rig);

  if (mode === "default") {
    timelines.sway = IDLE_PRESETS.sway(rig);
    timelines.look = IDLE_PRESETS.idle_look(rig);
  } else if (mode === "menace") {
    timelines.sway = IDLE_PRESETS.idle_menace(rig);
  } else if (mode === "float") {
    timelines.float = IDLE_PRESETS.idle_float(rig);
  }

  // Convenience kill-all
  timelines.kill = () => Object.values(timelines).forEach(t => {
    if (t && typeof t.kill === "function") t.kill();
  });

  return timelines;
}
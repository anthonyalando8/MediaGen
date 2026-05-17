import { gsap } from "gsap";
import { ActionRegistry } from "../actions/ActionRegistry.js";
import { startIdleSet }   from "../actions/idlePresets.js";
import EventBus           from "./EventBus.js";

/**
 * CharacterTimeline.js
 * --------------------
 * Builds the complete GSAP timeline for ONE character from their
 * scene definition. Handles:
 *
 *   - Idle base layer (looping breathe/blink)
 *   - Sequential action directives at precise timestamps
 *   - Simultaneous expression changes
 *   - Entry/exit transitions
 *
 * The returned timeline is a paused GSAP timeline ready to be
 * added into the MasterTimeline at the character's startAt offset.
 *
 * Scene character definition shape:
 * {
 *   id: "hero",
 *   startAt: 0,
 *   idleMode: "default",
 *   actions: [
 *     { at: 0.5, name: "walk_in", opts: { from: "left" }, expression: "determined" },
 *     { at: 3.2, name: "point_forward", expression: "angry" },
 *     { at: 5.0, name: "recoil", expression: "scared" },
 *   ]
 * }
 */
export class CharacterTimeline {
  /**
   * @param {object} charDef   — character definition from scene JSON
   * @param {object} rig       — rigRef map from SVGPuppet
   */
  constructor(charDef, rig) {
    this.charDef  = charDef;
    this.rig      = rig;
    this.timeline = null;
    this.idle     = null;
  }

  /**
   * Build the full character timeline.
   * @returns {gsap.core.Timeline} paused, ready to add to master
   */
  build() {
    const { id, actions = [], idleMode = "default", startAt = 0 } = this.charDef;
    const rig = this.rig;

    // Character timeline — NOT paused here; parent master controls it.
    // A paused child inside a playing parent will NOT play in GSAP 3.
    const tl = gsap.timeline({ id: `char_${id}` });

    // ── Idle base layer ─────────────────────────────────────────
    // Idle is NOT started at build time — it starts when the scene plays.
    // MasterTimeline.play() calls charTL.startIdle() for each character.
    // This prevents idle animations running on a frozen pre-play stage.
    this._idleMode = idleMode;

    // ── Action directives ────────────────────────────────────────
    actions.forEach((directive) => {
      const { at, name, opts = {}, expression } = directive;

      // Motion action
      if (name) {
        // Build timeline without killing tweens here — MasterTimeline
        // owns sequencing so conflicts don't arise the same way as
        // in interactive mode. We use the factory directly.
        const factory = ActionRegistry._actions[name];
        if (factory) {
          const actionTL = factory(rig, opts);
          tl.add(actionTL, at);

          // Emit event for debugging / Python frame capture hooks
          tl.call(() => {
            EventBus.emit("character:action", { characterId: id, action: name, at });
          }, [], at);
        } else {
          console.warn(`[CharacterTimeline:${id}] Unknown action: "${name}"`);
        }
      }

      // Expression change — runs simultaneously with the action
      if (expression) {
        const exprFactory = ActionRegistry._expressions[expression];
        if (exprFactory) {
          const exprTL = exprFactory(rig, opts);
          tl.add(exprTL, at);

          tl.call(() => {
            EventBus.emit("character:expression", { characterId: id, expression, at });
          }, [], at);
        } else {
          console.warn(`[CharacterTimeline:${id}] Unknown expression: "${expression}"`);
        }
      }
    });

    this.timeline = tl;
    return tl;
  }

  /** Start idle animations (called by MasterTimeline on play/restart) */
  startIdle() {
    this.idle?.kill();
    this.idle = startIdleSet(this.rig, this._idleMode ?? "default");
  }

  /** Pause this character's timeline and idle */
  pause() {
    this.timeline?.pause();
  }

  /** Resume */
  resume() {
    this.timeline?.resume();
  }

  /** Seek to a time position */
  seek(t) {
    this.timeline?.seek(t);
  }

  /** Fully tear down — kill timeline and idle loops */
  destroy() {
    this.timeline?.kill();
    this.idle?.kill();
    this.timeline = null;
    this.idle     = null;
  }
}
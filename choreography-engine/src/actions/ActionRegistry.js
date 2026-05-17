import { MOTION_PRESETS }     from "./motionPresets.js";
import { EXPRESSION_PRESETS } from "./expressionPresets.js";
import { IDLE_PRESETS, startIdleSet } from "./idlePresets.js";

/**
 * ActionRegistry.js
 * -----------------
 * THE SEMANTIC FIREWALL.
 *
 * AI directors output only string names like "walk_in", "angry", "jump".
 * This registry maps those names to deterministic GSAP timeline factories.
 *
 * No raw CSS/SVG values ever cross this boundary.
 *
 * ── Usage ────────────────────────────────────────────────────────
 *
 *   // Resolve and play a motion action:
 *   const tl = ActionRegistry.resolveAction("walk_in", rig, { from: "left" });
 *   tl.play();
 *
 *   // Resolve and play an expression:
 *   const tl = ActionRegistry.resolveExpression("angry", rig);
 *   tl.play();
 *
 *   // Start idle animations:
 *   const idle = ActionRegistry.startIdle(rig, "default");
 *   idle.kill(); // on cleanup
 *
 *   // Register a custom action (plugin system):
 *   ActionRegistry.registerAction("moonwalk", (rig, opts) => gsap.timeline()...);
 *
 * ── Scene JSON integration ────────────────────────────────────────
 *
 *   Given a scene action directive:
 *   { "at": 1.5, "name": "point_forward", "opts": { "hold": true }, "expression": "determined" }
 *
 *   The CharacterTimeline does:
 *   const motionTL    = ActionRegistry.resolveAction("point_forward", rig, { hold: true });
 *   const expressionTL = ActionRegistry.resolveExpression("determined", rig);
 *   masterTL.add(motionTL, 1.5);
 *   masterTL.add(expressionTL, 1.5);  // plays simultaneously
 */

class ActionRegistryClass {
  constructor() {
    this._actions     = { ...MOTION_PRESETS };
    this._expressions = { ...EXPRESSION_PRESETS };
    this._idles       = { ...IDLE_PRESETS };
  }

  // ── Tween conflict resolution ────────────────────────────────────

  /**
   * Kill all active non-idle tweens on every animatable rig part.
   * Called before firing a new action so previous in-progress tweens
   * don't fight the incoming ones — the root cause of "needs multiple clicks".
   *
   * We preserve idle tweens (breathe, blink) by NOT killing the root.
   * Instead we kill tweens on individual parts that actions touch.
   */
  _killActionTweens(rig) {
    const { gsap } = window;
    if (!gsap) return;

    // All parts that motion presets animate
    const parts = [
      rig.root,
      rig.torso, rig.hip, rig.head,
      rig.leg_l, rig.leg_r, rig.foot_l, rig.foot_r,
      rig.upper_arm_l, rig.lower_arm_l, rig.hand_l,
      rig.upper_arm_r, rig.lower_arm_r, rig.hand_r,
      rig.shadow,
    ].filter(Boolean);

    parts.forEach(part => gsap.killTweensOf(part));
  }

  /**
   * Kill all active expression tweens on face parts.
   */
  _killExpressionTweens(rig) {
    const { gsap } = window;
    if (!gsap) return;

    const parts = [
      rig.brow_l, rig.brow_r,
      rig.eye_l,  rig.eye_r,
      rig.mouth?.el,
    ].filter(Boolean);

    parts.forEach(part => gsap.killTweensOf(part));
  }

  // ── Action resolution ───────────────────────────────────────────

  /**
   * Resolve a semantic motion action name → GSAP timeline.
   * Kills any in-progress action tweens first so replay is instant.
   *
   * @param {string} name   — e.g. "walk_in", "jump", "panic"
   * @param {object} rig    — rigRef map from SVGPuppet
   * @param {object} opts   — optional overrides
   * @returns {gsap.core.Timeline}
   */
  resolveAction(name, rig, opts = {}) {
    const factory = this._actions[name];
    if (!factory) {
      console.warn(`[ActionRegistry] Unknown action: "${name}". Available: ${this.listActions().join(", ")}`);
      return this._noop();
    }
    this._killActionTweens(rig);
    return factory(rig, opts);
  }

  /**
   * Resolve a semantic expression name → GSAP timeline.
   * Kills in-progress expression tweens first for instant snap.
   *
   * @param {string} name   — e.g. "angry", "happy", "surprised"
   * @param {object} rig    — rigRef map from SVGPuppet
   * @param {object} opts   — e.g. { dur: 0.1 } for faster snap
   * @returns {gsap.core.Timeline}
   */
  resolveExpression(name, rig, opts = {}) {
    const factory = this._expressions[name];
    if (!factory) {
      console.warn(`[ActionRegistry] Unknown expression: "${name}". Available: ${this.listExpressions().join(", ")}`);
      return this._noop();
    }
    this._killExpressionTweens(rig);
    return factory(rig, opts);
  }

  /**
   * Start an idle animation set
   * @param {object} rig    — rigRef map
   * @param {string} mode   — "default" | "menace" | "float"
   * @returns {{ kill: Function, ...timelines }}
   */
  startIdle(rig, mode = "default") {
    return startIdleSet(rig, mode);
  }

  /**
   * Resolve and execute a full scene action directive
   * (motion + optional expression, starting simultaneously)
   *
   * @param {{ name, expression, opts }} directive
   * @param {object} rig
   * @param {gsap.core.Timeline} masterTL   — timeline to add into
   * @param {number} at                     — position in masterTL
   */
  executeDirective(directive, rig, masterTL, at = 0) {
    const { name, expression, opts = {} } = directive;

    if (name) {
      const motionTL = this.resolveAction(name, rig, opts);
      masterTL.add(motionTL, at);
    }

    if (expression) {
      const exprTL = this.resolveExpression(expression, rig, opts);
      masterTL.add(exprTL, at);
    }

    return masterTL;
  }

  // ── Plugin registration ─────────────────────────────────────────

  /**
   * Register a custom action preset (plugin system)
   * @param {string}   name     — semantic action name
   * @param {Function} factory  — (rig, opts) => gsap.Timeline
   */
  registerAction(name, factory) {
    if (this._actions[name]) {
      console.warn(`[ActionRegistry] Overriding existing action: "${name}"`);
    }
    this._actions[name] = factory;
    return this; // chainable
  }

  /**
   * Register a custom expression preset
   */
  registerExpression(name, factory) {
    if (this._expressions[name]) {
      console.warn(`[ActionRegistry] Overriding existing expression: "${name}"`);
    }
    this._expressions[name] = factory;
    return this;
  }

  // ── Introspection ───────────────────────────────────────────────

  listActions()     { return Object.keys(this._actions); }
  listExpressions() { return Object.keys(this._expressions); }
  listIdles()       { return Object.keys(this._idles); }

  hasAction(name)     { return name in this._actions; }
  hasExpression(name) { return name in this._expressions; }

  // ── Internals ───────────────────────────────────────────────────

  _noop() {
    // Safe no-op timeline — returns something with .play() and .kill()
    try {
      const { gsap } = window;
      return gsap ? gsap.timeline() : { play() {}, kill() {} };
    } catch {
      return { play() {}, kill() {} };
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────
export const ActionRegistry = new ActionRegistryClass();
export default ActionRegistry;
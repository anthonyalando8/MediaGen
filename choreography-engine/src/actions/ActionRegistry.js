import { gsap }             from "gsap";
import { MOTION_PRESETS }     from "./motionPresets.js";
import { EXPRESSION_PRESETS } from "./expressionPresets.js";
import { IDLE_PRESETS, startIdleSet } from "./idlePresets.js";

/**
 * ActionRegistry.js — THE SEMANTIC FIREWALL
 *
 * Maps semantic names ("walk_in", "angry") to GSAP timeline factories.
 * No raw CSS/SVG values ever cross this boundary.
 *
 * FIX: gsap is now a proper ES module import, NOT window.gsap.
 * window.gsap is only set in RenderApp for the Python pipeline.
 * Using window.gsap in the normal app meant killTweensOf() was a no-op,
 * causing the "must click twice" double-click bug on all expressions/actions.
 */

class ActionRegistryClass {
  constructor() {
    this._actions     = { ...MOTION_PRESETS };
    this._expressions = { ...EXPRESSION_PRESETS };
    this._idles       = { ...IDLE_PRESETS };
  }

  // ── Tween conflict resolution ──────────────────────────────────

  /**
   * Kill all active tweens on body parts before a new action starts.
   * This is what prevents the "needs two clicks" bug — without this,
   * a still-running tween from the previous action fights the new one.
   */
  _killActionTweens(rig) {
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

  _killExpressionTweens(rig) {
    const parts = [
      rig.brow_l, rig.brow_r,
      rig.eye_l,  rig.eye_r,
      rig.mouth?.el,
      rig.mouth?.upperLip,
      rig.mouth?.lowerLip,
    ].filter(Boolean);
    parts.forEach(part => gsap.killTweensOf(part));
  }

  // ── Action resolution ──────────────────────────────────────────

  resolveAction(name, rig, opts = {}) {
    const factory = this._actions[name];
    if (!factory) {
      console.warn(`[ActionRegistry] Unknown action: "${name}"`);
      return this._noop();
    }
    this._killActionTweens(rig);
    return factory(rig, opts);
  }

  resolveExpression(name, rig, opts = {}) {
    const factory = this._expressions[name];
    if (!factory) {
      console.warn(`[ActionRegistry] Unknown expression: "${name}"`);
      return this._noop();
    }
    this._killExpressionTweens(rig);
    return factory(rig, opts);
  }

  startIdle(rig, mode = "default") {
    return startIdleSet(rig, mode);
  }

  executeDirective(directive, rig, masterTL, at = 0) {
    const { name, expression, opts = {} } = directive;
    if (name)       masterTL.add(this.resolveAction(name, rig, opts), at);
    if (expression) masterTL.add(this.resolveExpression(expression, rig, opts), at);
    return masterTL;
  }

  // ── Plugin registration ────────────────────────────────────────

  registerAction(name, factory) {
    this._actions[name] = factory;
    return this;
  }

  registerExpression(name, factory) {
    this._expressions[name] = factory;
    return this;
  }

  // ── Introspection ──────────────────────────────────────────────

  listActions()       { return Object.keys(this._actions); }
  listExpressions()   { return Object.keys(this._expressions); }
  listIdles()         { return Object.keys(this._idles); }
  hasAction(name)     { return name in this._actions; }
  hasExpression(name) { return name in this._expressions; }

  _noop() {
    return gsap.timeline();
  }
}

export const ActionRegistry = new ActionRegistryClass();
export default ActionRegistry;
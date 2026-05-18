import { ActionRegistry } from "../actions/ActionRegistry.js";

/**
 * PluginRegistry.js
 * -----------------
 * Extensibility layer. Third-party code, studio-specific presets,
 * and platform adapters register here without touching core files.
 *
 * ── Plugin types ─────────────────────────────────────────────────
 *
 *   action      — new motion preset (rig, opts) => gsap.Timeline
 *   expression  — new facial expression (rig, opts) => gsap.Timeline
 *   camera      — new camera preset registered to CameraRig
 *   effect      — stage-level visual effect (stageEl, opts) => gsap.Timeline
 *   middleware  — intercepts resolveAction/resolveExpression calls
 *   lifecycle   — hooks into scene lifecycle events
 *
 * ── Usage ────────────────────────────────────────────────────────
 *
 *   // Register a custom action:
 *   PluginRegistry.registerAction("moonwalk", (rig, opts) =>
 *     gsap.timeline()
 *       .to(rig.torso, { rotation: -5, duration: 0.2 })
 *       ...
 *   );
 *
 *   // Register a platform-specific subtitle effect:
 *   PluginRegistry.registerEffect("tiktok_caption", (stageEl, opts) =>
 *     gsap.timeline()...
 *   );
 *
 *   // Use in scene JSON:
 *   { "at": 2.0, "name": "moonwalk" }
 *
 * ── Built-in plugin packs ────────────────────────────────────────
 *   PluginRegistry.loadPack("comedy")   — bounce, double_take, spit_take
 *   PluginRegistry.loadPack("action")   — backflip, spin_kick, dodge
 *   PluginRegistry.loadPack("social")   — thumbs_up, clap, dance_basic
 */

class PluginRegistryClass {
  constructor() {
    this._actions     = {};
    this._expressions = {};
    this._cameras     = {};
    this._effects     = {};
    this._middleware  = [];
    this._lifecycles  = {};
    this._packs       = {};
    this._installed   = new Set();
  }

  // ── Action registration ─────────────────────────────────────────

  /**
   * Register a custom motion action.
   * Immediately available via ActionRegistry.resolveAction().
   * @param {string}   name
   * @param {Function} factory  — (rig, opts) => gsap.Timeline
   * @returns {this}
   */
  registerAction(name, factory) {
    this._actions[name] = factory;
    ActionRegistry.registerAction(name, factory);
    return this;
  }

  /**
   * Register a custom expression.
   * @param {string}   name
   * @param {Function} factory  — (rig, opts) => gsap.Timeline
   * @returns {this}
   */
  registerExpression(name, factory) {
    this._expressions[name] = factory;
    ActionRegistry.registerExpression(name, factory);
    return this;
  }

  /**
   * Register a camera preset.
   * Inject into CameraRig via monkey-patching the preset map.
   * @param {string}   name
   * @param {Function} factory  — (stageEl, opts) => gsap.Timeline
   * @returns {this}
   */
  registerCamera(name, factory) {
    this._cameras[name] = factory;
    return this;
  }

  /**
   * Register a stage effect (particles, glitch, flash, etc.)
   * @param {string}   name
   * @param {Function} factory  — (stageEl, opts) => gsap.Timeline
   * @returns {this}
   */
  registerEffect(name, factory) {
    this._effects[name] = factory;
    return this;
  }

  // ── Middleware ──────────────────────────────────────────────────

  /**
   * Add middleware that intercepts action resolution.
   * Runs before every resolveAction() call.
   * Return { name, rig, opts } to modify, or nothing to pass through.
   *
   * Example: log all actions to analytics
   *   PluginRegistry.use((name, rig, opts) => {
   *     analytics.track("action", { name });
   *   });
   */
  use(fn) {
    this._middleware.push(fn);
    return this;
  }

  // ── Lifecycle hooks ─────────────────────────────────────────────

  /**
   * Register a lifecycle hook.
   * @param {"scene:start"|"scene:complete"|"scene:built"|"character:action"} event
   * @param {Function} handler
   */
  onLifecycle(event, handler) {
    if (!this._lifecycles[event]) this._lifecycles[event] = [];
    this._lifecycles[event].push(handler);
    return this;
  }

  // ── Plugin pack system ──────────────────────────────────────────

  /**
   * Register a named plugin pack.
   * Packs are collections of related actions/expressions.
   *
   * @param {string} name   — pack identifier
   * @param {object} pack   — { actions, expressions, cameras, effects }
   */
  registerPack(name, pack) {
    this._packs[name] = pack;
    return this;
  }

  /**
   * Load and install a plugin pack.
   * @param {string} name
   */
  loadPack(name) {
    if (this._installed.has(name)) return this;

    const pack = this._packs[name] ?? BUILTIN_PACKS[name];
    if (!pack) {
      console.warn(`[PluginRegistry] Unknown pack: "${name}"`);
      return this;
    }

    Object.entries(pack.actions     ?? {}).forEach(([n, f]) => this.registerAction(n, f));
    Object.entries(pack.expressions ?? {}).forEach(([n, f]) => this.registerExpression(n, f));
    Object.entries(pack.cameras     ?? {}).forEach(([n, f]) => this.registerCamera(n, f));
    Object.entries(pack.effects     ?? {}).forEach(([n, f]) => this.registerEffect(n, f));

    this._installed.add(name);
    console.info(`[PluginRegistry] Loaded pack: "${name}"`);
    return this;
  }

  // ── Effect execution ────────────────────────────────────────────

  /**
   * Run a registered stage effect.
   * @param {string}      name
   * @param {HTMLElement} stageEl
   * @param {object}      opts
   * @returns {gsap.core.Timeline | null}
   */
  runEffect(name, stageEl, opts = {}) {
    const factory = this._effects[name];
    if (!factory) {
      console.warn(`[PluginRegistry] Unknown effect: "${name}"`);
      return null;
    }
    return factory(stageEl, opts);
  }

  // ── Introspection ───────────────────────────────────────────────

  listActions()     { return Object.keys(this._actions); }
  listExpressions() { return Object.keys(this._expressions); }
  listCameras()     { return Object.keys(this._cameras); }
  listEffects()     { return Object.keys(this._effects); }
  listPacks()       { return Object.keys({ ...this._packs, ...BUILTIN_PACKS }); }
  isInstalled(name) { return this._installed.has(name); }
}

export const PluginRegistry = new PluginRegistryClass();
export default PluginRegistry;

// ── Built-in plugin packs ────────────────────────────────────────

const { gsap } = window ?? {};

const BUILTIN_PACKS = {

  comedy: {
    actions: {
      double_take: (rig) => {
        const { gsap: g } = window;
        return g.timeline()
          .to(rig.head, { rotation: -8, duration: 0.12 })
          .to(rig.head, { rotation: 0,  duration: 0.08 })
          .to(rig.head, { rotation: -20, y: -8, duration: 0.18, ease: "power3.out" })
          .to([rig.eye_l, rig.eye_r], { scaleY: 1.5, duration: 0.1 }, "<0.05")
          .to(rig.head, { rotation: 0, y: 0, duration: 0.3, ease: "power2.inOut", delay: 0.3 })
          .to([rig.eye_l, rig.eye_r], { scaleY: 1, duration: 0.2 }, "<");
      },
      bounce: (rig) => {
        const { gsap: g } = window;
        return g.timeline({ repeat: 2 })
          .to(rig.root,  { y: -40, duration: 0.2, ease: "power2.out" })
          .to(rig.torso, { scaleY: 1.12, duration: 0.2 }, "<")
          .to(rig.root,  { y: 0,  duration: 0.18, ease: "bounce.out" })
          .to(rig.torso, { scaleY: 0.88, duration: 0.08 }, "<")
          .to(rig.torso, { scaleY: 1,    duration: 0.15, ease: "elastic.out(1,0.5)" });
      },
    },
    expressions: {
      dizzy: (rig) => {
        const { gsap: g } = window;
        return g.timeline()
          .to(rig.brow_l, { rotation: 10, y: -2, duration: 0.15 })
          .to(rig.brow_r, { rotation: -10, y: 3, duration: 0.15 }, "<")
          .to(rig.eye_l,  { scaleY: 0.4,  y: 1, duration: 0.15 }, "<")
          .to(rig.eye_r,  { scaleY: 1.3,  y: -1, duration: 0.15 }, "<");
      },
    },
  },

  action: {
    actions: {
      spin_kick: (rig) => {
        const { gsap: g } = window;
        return g.timeline()
          .to(rig.root,  { rotation: 360, duration: 0.5, ease: "power2.in" })
          .to(rig.leg_r, { rotation: -90, duration: 0.3 }, 0.3)
          .set(rig.root,  { rotation: 0 })
          .to(rig.leg_r, { rotation: 0,   duration: 0.3, ease: "power2.out" });
      },
      backflip: (rig) => {
        const { gsap: g } = window;
        return g.timeline()
          .to(rig.root,  { y: -120, rotation: -180, duration: 0.5, ease: "power2.out" })
          .to(rig.root,  { y: 0,   rotation: -360, duration: 0.4, ease: "bounce.out" })
          .set(rig.root,  { rotation: 0 });
      },
    },
  },

  social: {
    actions: {
      clap: (rig) => {
        const { gsap: g } = window;
        const tl = g.timeline();
        for (let i = 0; i < 3; i++) {
          tl.to(rig.upper_arm_l, { rotation:  50, duration: 0.1 })
            .to(rig.upper_arm_r, { rotation: -50, duration: 0.1 }, "<")
            .to(rig.upper_arm_l, { rotation:  20, duration: 0.1 })
            .to(rig.upper_arm_r, { rotation: -20, duration: 0.1 }, "<");
        }
        tl.to([rig.upper_arm_l, rig.upper_arm_r], { rotation: 0, duration: 0.2 });
        return tl;
      },
      thumbs_up: (rig) => {
        const { gsap: g } = window;
        return g.timeline()
          .to(rig.upper_arm_r, { rotation: 120, duration: 0.25, ease: "power2.out" })
          .to(rig.lower_arm_r, { rotation: -30, duration: 0.2 }, "<0.05")
          .to(rig.upper_arm_r, { rotation: 0,   duration: 0.35, ease: "power2.inOut", delay: 0.8 })
          .to(rig.lower_arm_r, { rotation: 0,   duration: 0.3 }, "<");
      },
    },
    expressions: {
      wink: (rig) => {
        const { gsap: g } = window;
        return g.timeline()
          .to(rig.eye_r, { scaleY: 0.04, duration: 0.07 })
          .to(rig.brow_r, { y: 3, duration: 0.07 }, "<")
          .to(rig.eye_r, { scaleY: 1, duration: 0.12, delay: 0.2 })
          .to(rig.brow_r, { y: 0, duration: 0.12 }, "<");
      },
    },
  },
};
import { gsap } from "gsap";

/**
 * CameraRig.js
 * ------------
 * Dedicated camera system. Wraps the stage DOM element and applies
 * all camera transforms via GSAP CSS transforms.
 *
 * The "camera" in this engine is an illusion — we scale/translate the
 * entire stage container, which produces the visual effect of a moving
 * camera against a stationary scene.
 *
 * ── Coordinate model ─────────────────────────────────────────────
 * All camera values are in NORMALIZED units relative to the stage:
 *   zoom  1.0  = 100% (wide shot, full frame)
 *   zoom  1.5  = 150% (push in, subject fills frame)
 *   zoom  0.8  = 80%  (dolly out, environmental)
 *   x/y offsets in stage pixels (pre-zoom)
 *
 * ── Usage ────────────────────────────────────────────────────────
 *   const cam = new CameraRig(stageEl);
 *
 *   // Build a timeline for MasterTimeline:
 *   const tl = cam.buildTimeline(scene.camera);
 *   masterTL.add(tl, 0);
 *
 *   // Direct call (interactive mode):
 *   cam.applyPreset("push_in", { zoom: 1.6, dur: 0.8 });
 */
export class CameraRig {
  /**
   * @param {HTMLElement} stageEl — the outer stage div (camera transforms applied here)
   * @param {object} opts
   * @param {number} opts.stageWidth  — stage pixel width (default 360)
   * @param {number} opts.stageHeight — stage pixel height (default 420)
   */
  constructor(stageEl, { stageWidth = 360, stageHeight = 420 } = {}) {
    this.el           = stageEl;
    this.stageWidth   = stageWidth;
    this.stageHeight  = stageHeight;

    // Current camera state — tracked for relative moves
    this.state = { zoom: 1, x: 0, y: 0, rotation: 0 };

    // Active camera timeline (for interrupt/kill)
    this._activeTL = null;
  }

  // ── Timeline builder ──────────────────────────────────────────

  /**
   * Build a complete GSAP timeline from an array of camera directives.
   * Each directive: { at, preset, opts }
   * Returns a timeline to be added to MasterTimeline.
   *
   * @param {Array} directives — camera array from scene JSON
   * @returns {gsap.core.Timeline}
   */
  buildTimeline(directives = []) {
    const tl = gsap.timeline({ id: "camera" });

    directives.forEach((dir) => {
      const camTL = this._buildDirective(dir);
      if (camTL) tl.add(camTL, dir.at ?? 0);
    });

    return tl;
  }

  // ── Direct preset application (interactive mode) ──────────────

  /**
   * Apply a camera preset immediately (kills current camera tween).
   * @param {string} preset
   * @param {object} opts
   * @returns {gsap.core.Timeline}
   */
  applyPreset(preset, opts = {}) {
    this._activeTL?.kill();
    const tl = this._buildPreset(preset, opts);
    this._activeTL = tl;
    tl?.play();
    return tl;
  }

  /** Reset camera to neutral position */
  reset(dur = 0.5) {
    return gsap.to(this.el, {
      scale: 1, x: 0, y: 0, rotation: 0,
      duration: dur, ease: "power2.inOut",
    });
  }

  // ── Internal preset factory ───────────────────────────────────

  _buildDirective(dir) {
    return this._buildPreset(dir.preset, dir.opts ?? {});
  }

  _buildPreset(preset, opts = {}) {
    if (!this.el) return null;

    const PRESETS = {

      // ── Zoom / dolly ────────────────────────────────────────

      wide_shot: () => {
        const dur = opts.dur ?? 0.6;
        return gsap.timeline()
          .to(this.el, { scale: 1, x: 0, y: 0, rotation: 0,
                         duration: dur, ease: "power2.inOut" });
      },

      push_in: () => {
        const zoom   = opts.zoom   ?? 1.4;
        const dur    = opts.dur    ?? 0.8;
        const focusX = opts.focusX ?? 0;   // stage-unit x to zoom toward
        const focusY = opts.focusY ?? 0;   // stage-unit y to zoom toward
        // When zooming by factor Z, the point (focusX, focusY) stays centered.
        // The stage offset needed: translate by -(focusX*(Z-1), focusY*(Z-1))
        const tx = -(focusX * (zoom - 1));
        const ty = -(focusY * (zoom - 1));
        return gsap.timeline()
          .to(this.el, { scale: zoom, x: tx, y: ty,
                         duration: dur, ease: "power2.inOut" });
      },

      dolly_out: () => {
        const zoom = opts.zoom ?? 0.78;
        const dur  = opts.dur  ?? 1.0;
        return gsap.timeline()
          .to(this.el, { scale: zoom, duration: dur, ease: "power1.out" });
      },

      // ── Pan / tilt ──────────────────────────────────────────

      pan_left: () => {
        const amount = opts.amount ?? 80;
        const dur    = opts.dur    ?? 0.8;
        return gsap.timeline()
          .to(this.el, { x: `-=${amount}`, duration: dur, ease: "power1.inOut" });
      },

      pan_right: () => {
        const amount = opts.amount ?? 80;
        const dur    = opts.dur    ?? 0.8;
        return gsap.timeline()
          .to(this.el, { x: `+=${amount}`, duration: dur, ease: "power1.inOut" });
      },

      tilt_up: () => {
        const amount = opts.amount ?? 60;
        const dur    = opts.dur    ?? 0.8;
        return gsap.timeline()
          .to(this.el, { y: `-=${amount}`, duration: dur, ease: "power1.inOut" });
      },

      tilt_down: () => {
        const amount = opts.amount ?? 60;
        const dur    = opts.dur    ?? 0.8;
        return gsap.timeline()
          .to(this.el, { y: `+=${amount}`, duration: dur, ease: "power1.inOut" });
      },

      // ── Impact / reaction ────────────────────────────────────

      camera_shake: () => {
        const intensity = opts.intensity ?? 6;
        const shakeDur  = opts.shakeDur  ?? 0.4;
        const stepDur   = 0.055;
        const steps     = Math.max(2, Math.floor(shakeDur / stepDur));
        const tl        = gsap.timeline();
        for (let i = 0; i < steps; i++) {
          const xOff = (Math.random() - 0.5) * intensity * 2;
          const yOff = (Math.random() - 0.5) * intensity;
          tl.to(this.el, { x: `+=${xOff}`, y: `+=${yOff}`,
                           duration: stepDur, ease: "none" });
        }
        // Return to origin
        tl.to(this.el, { x: 0, y: 0, duration: 0.12, ease: "power2.out" });
        return tl;
      },

      // Smooth handheld-style drift — less random than shake
      handheld: () => {
        const amount = opts.amount ?? 3;
        const dur    = opts.dur    ?? 2.0;
        return gsap.timeline({ repeat: -1, yoyo: true })
          .to(this.el, { x: amount, y: amount * 0.5, rotation: 0.3,
                         duration: dur, ease: "sine.inOut" });
      },

      // ── Cinematic moves ──────────────────────────────────────

      // Slow creep in — builds tension
      slow_push: () => {
        const zoom = opts.zoom ?? 1.2;
        const dur  = opts.dur  ?? 3.0;
        return gsap.timeline()
          .to(this.el, { scale: zoom, duration: dur, ease: "none" });
      },

      // Dutch tilt — tilts the camera for disorientation
      dutch_tilt: () => {
        const angle = opts.angle ?? 8;
        const dur   = opts.dur   ?? 0.5;
        return gsap.timeline()
          .to(this.el, { rotation: angle, duration: dur, ease: "power2.out" })
          .to(this.el, { rotation: 0, duration: dur, ease: "power2.out",
                         delay: opts.hold ?? 1.0 });
      },

      // Quick cut zoom — snap to position
      snap_zoom: () => {
        const zoom = opts.zoom ?? 1.8;
        const dur  = opts.dur  ?? 0.08;
        return gsap.timeline()
          .to(this.el, { scale: zoom, duration: dur, ease: "power3.out" });
      },

      // Rack focus simulation — zoom in sharply then ease back
      rack_focus: () => {
        const peakZoom = opts.zoom ?? 1.6;
        const dur      = opts.dur  ?? 0.3;
        return gsap.timeline()
          .to(this.el, { scale: peakZoom, duration: dur * 0.4, ease: "power3.out" })
          .to(this.el, { scale: opts.restZoom ?? 1.2, duration: dur * 0.6, ease: "power2.inOut" });
      },
    };

    const factory = PRESETS[preset];
    if (!factory) {
      console.warn(`[CameraRig] Unknown preset: "${preset}". Available: ${Object.keys(PRESETS).join(", ")}`);
      return null;
    }

    return factory();
  }

  /** List all available camera presets */
  listPresets() {
    return [
      "wide_shot", "push_in", "dolly_out",
      "pan_left", "pan_right", "tilt_up", "tilt_down",
      "camera_shake", "handheld", "slow_push",
      "dutch_tilt", "snap_zoom", "rack_focus",
    ];
  }

  destroy() {
    this._activeTL?.kill();
    this._activeTL = null;
  }
}
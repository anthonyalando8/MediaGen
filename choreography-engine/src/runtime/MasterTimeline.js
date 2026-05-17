import { gsap }             from "gsap";
import { CharacterTimeline } from "./CharacterTimeline.js";
import { CameraRig }         from "../camera/CameraRig.js";
import EventBus              from "./EventBus.js";

/**
 * MasterTimeline.js
 * -----------------
 * Top-level timeline orchestrator for the choreography engine.
 *
 * Responsibilities:
 *   1. Accept a parsed scene object and a rigRegistry (characterId → rigRef)
 *   2. Build a CharacterTimeline per character and add to the master GSAP TL
 *   3. Wire camera directives into the master timeline
 *   4. Expose play/pause/seek/destroy interface
 *   5. Emit EventBus events at scene lifecycle points
 *   6. Support deterministic tick mode for Chromium render pipeline
 *
 * ── Usage ───────────────────────────────────────────────────────
 *
 *   const master = new MasterTimeline(sceneJSON, rigRegistry);
 *   master.build();
 *   master.play();
 *
 *   // Seek to 3.5s for preview scrubbing:
 *   master.seekTo(3.5);
 *
 *   // Deterministic tick (Python render loop):
 *   master.enableDeterministicMode();
 *   master.tick(1 / 30); // advance one frame
 *
 * ── rigRegistry shape ───────────────────────────────────────────
 *   {
 *     "hero":    <rigRef from SVGPuppet ref={heroRigRef}>,
 *     "villain": <rigRef from SVGPuppet ref={villainRigRef}>,
 *   }
 */
export class MasterTimeline {
  /**
   * @param {object} scene        — parsed scene JSON object
   * @param {object} rigRegistry  — { characterId: rigRef }
   * @param {object} stageEl      — DOM element for camera transforms (optional)
   */
  constructor(scene, rigRegistry, stageEl = null) {
    this.scene        = scene;
    this.rigRegistry  = rigRegistry;
    this.stageEl      = stageEl;

    this.master             = null;
    this.characterTimelines = {};
    this.camera             = null;   // CameraRig instance
    this._deterministic     = false;
    this._frameTime         = 0;
    this._built             = false;
  }

  // ── Build ──────────────────────────────────────────────────────

  /**
   * Build the complete master timeline from the scene definition.
   * Must be called after all rigRefs are populated (after React mount).
   */
  build() {
    const { meta = {}, characters = [], camera = [], transitions = {} } = this.scene;

    // Create master — paused until play() is called
    this.master = gsap.timeline({
      paused:     true,
      id:         `master_${meta.id ?? "scene"}`,
      onComplete: () => {
        EventBus.emit("scene:complete", { sceneId: meta.id });
        this._handleTransitionOut(transitions.out);
      },
      onUpdate: () => {
        const t = this.master.time();
        const p = this.master.progress();
        EventBus.emit("scene:tick", { time: t, progress: p });
      },
    });

    // ── Character timelines ─────────────────────────────────────
    characters.forEach((charDef) => {
      const rig = this.rigRegistry[charDef.id];
      if (!rig) {
        console.warn(`[MasterTimeline] No rig found for character "${charDef.id}". Skipping.`);
        return;
      }

      const charTL = new CharacterTimeline(charDef, rig);
      const built  = charTL.build();

      this.characterTimelines[charDef.id] = charTL;

      // Add character timeline into master at the character's startAt offset
      this.master.add(built, charDef.startAt ?? 0);
    });

    // ── Camera directives ───────────────────────────────────────
    if (this.stageEl && camera.length > 0) {
      this.camera = new CameraRig(this.stageEl);
      const camTL = this.camera.buildTimeline(camera);
      this.master.add(camTL, 0);
    }

    // ── Transition in ───────────────────────────────────────────
    if (transitions.in) {
      const inTL = this._buildTransitionIn(transitions.in);
      if (inTL) this.master.add(inTL, 0);
    }

    this._built = true;
    EventBus.emit("scene:built", { sceneId: meta.id, duration: this.master.duration() });
    return this;
  }

  // ── Playback controls ──────────────────────────────────────────

  play() {
    if (!this._built) {
      console.warn("[MasterTimeline] Call build() before play().");
      return this;
    }
    // Start each character's idle layer now (deferred from build time)
    Object.values(this.characterTimelines).forEach(ct => ct.startIdle());
    EventBus.emit("scene:start", { sceneId: this.scene.meta?.id });
    this.master.play();
    return this;
  }

  pause() {
    this.master?.pause();
    EventBus.emit("timeline:pause", {});
    return this;
  }

  resume() {
    this.master?.resume();
    EventBus.emit("timeline:resume", {});
    return this;
  }

  /**
   * Seek to an absolute time position (seconds).
   * If seeking to 0 (restart), re-triggers idle layers.
   */
  seekTo(t) {
    this.master?.seek(t);
    if (t === 0) {
      Object.values(this.characterTimelines).forEach(ct => ct.startIdle());
    }
    EventBus.emit("timeline:seek", { time: t });
    return this;
  }

  /** 0–1 progress scrub */
  setProgress(p) {
    this.master?.progress(p);
    return this;
  }

  get time()     { return this.master?.time()     ?? 0; }
  get progress() { return this.master?.progress() ?? 0; }
  get duration() { return this.master?.duration() ?? 0; }

  // ── Deterministic mode (Python render pipeline) ────────────────

  /**
   * Enable deterministic mode — disables GSAP's internal ticker.
   * The Python render loop then drives time manually via tick().
   */
  enableDeterministicMode() {
    this._deterministic = true;
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.remove(gsap.updateRoot);
    this.master?.pause();
    return this;
  }

  /**
   * Advance by one frame duration.
   * Called once per frame by the Python render loop.
   * @param {number} frameDelta — seconds per frame (e.g. 1/30)
   */
  tick(frameDelta) {
    if (!this._deterministic) return;
    this._frameTime += frameDelta;
    gsap.updateRoot(this._frameTime);

    if (typeof window !== "undefined" && window.__FRAME_READY__ !== undefined) {
      window.__FRAME_READY__ = true;
    }
  }

  /**
   * Seek to an exact frame number (Python render loop).
   * @param {number} frameIndex — 0-based frame number
   * @param {number} fps        — frames per second
   */
  tickToFrame(frameIndex, fps = 30) {
    const t = frameIndex / fps;
    this._frameTime = t;
    gsap.updateRoot(t);
  }

  // ── Character access ───────────────────────────────────────────

  getCharacterTimeline(id) {
    return this.characterTimelines[id] ?? null;
  }

  // ── Cleanup ────────────────────────────────────────────────────

  destroy() {
    Object.values(this.characterTimelines).forEach(ct => ct.destroy());
    this.camera?.destroy();
    this.master?.kill();
    this.characterTimelines = {};
    this.camera = null;
    this.master = null;
    this._built = false;
    EventBus.clear("scene:tick");
  }

  // ── Camera internals ───────────────────────────────────────────

  _buildTransitionIn(cfg) {
    if (!this.stageEl) return null;
    switch (cfg.type) {
      case "fade_black": {
        const tl = gsap.timeline();
        tl.set(this.stageEl, { opacity: 0 });
        tl.to(this.stageEl, { opacity: 1, duration: cfg.dur ?? 0.5 });
        return tl;
      }
      default:
        return null;
    }
  }

  _handleTransitionOut(cfg) {
    if (!this.stageEl || !cfg) return;
    switch (cfg.type) {
      case "fade_black":
        gsap.to(this.stageEl, { opacity: 0, duration: cfg.dur ?? 0.5 });
        break;
    }
  }
}
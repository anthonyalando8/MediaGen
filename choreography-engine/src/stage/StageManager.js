import { gsap } from "gsap";

/**
 * StageManager.js
 * ---------------
 * Owns the visual stage: viewport dimensions, 9:16 enforcement,
 * background layers, z-ordering, and responsive pixel scaling.
 *
 * ── Coordinate system ────────────────────────────────────────────
 * Stage uses a FIXED logical coordinate space (never changes):
 *   Width:  360 units  (x: -180 to +180)
 *   Height: 420 units  (y: -400 to +20)
 *
 * Characters are designed for this space. Pixel rendering size is
 * controlled by StageManager.width — the SVG scales uniformly.
 *
 * ── Layer stack (back to front) ─────────────────────────────────
 *   0  sky / gradient background
 *   1  far background (buildings, mountains)
 *   2  mid background (trees, props)
 *   3  floor / ground plane
 *   4  character layer (SVGPuppets live here)
 *   5  foreground elements (particles, effects)
 *   6  UI overlays (subtitles, captions)
 *
 * ── Usage ────────────────────────────────────────────────────────
 *   const stage = new StageManager({ width: 390 });
 *   stage.setBackground("city_night");
 *   stage.setLighting("dramatic_side");
 */

// ── Fixed logical coordinate space constants ─────────────────────
export const STAGE_VB_X  = -180;
export const STAGE_VB_Y  = -400;
export const STAGE_VB_W  = 360;
export const STAGE_VB_H  = 420;
export const STAGE_VIEWBOX = `${STAGE_VB_X} ${STAGE_VB_Y} ${STAGE_VB_W} ${STAGE_VB_H}`;

// ── Layer z-index constants ──────────────────────────────────────
export const LAYER = {
  SKY:         0,
  FAR_BG:      1,
  MID_BG:      2,
  FLOOR:       3,
  CHARACTERS:  4,
  FOREGROUND:  5,
  OVERLAY:     6,
};

// ── Background presets ───────────────────────────────────────────
// Each returns { sky, floor } gradient stops for SVG backgrounds.
// Extensible — add entries for new environment themes.
export const BACKGROUND_PRESETS = {
  default: {
    sky:   ["#1a1a2e", "#0f0f1a"],
    floor: "#0a0a12",
  },
  city_night: {
    sky:   ["#0d0d1a", "#1a0d2e"],
    floor: "#080810",
    accent: "#2a1a4e",
  },
  dawn: {
    sky:   ["#1a0a0a", "#4a1a0a", "#8a3a1a"],
    floor: "#2a1a0a",
  },
  midday: {
    sky:   ["#1a4a8a", "#2a6abf", "#4a8ad0"],
    floor: "#1a3a1a",
  },
  studio: {
    sky:   ["#1a1a1a", "#222222"],
    floor: "#111111",
  },
  void: {
    sky:   ["#000000", "#000000"],
    floor: "#000000",
  },
};

// ── Lighting presets ─────────────────────────────────────────────
// Applied as SVG filter or overlay tint on the character layer.
export const LIGHTING_PRESETS = {
  neutral:       { tint: null,      opacity: 0    },
  dramatic_side: { tint: "#1a0a2e", opacity: 0.15 },
  warm_key:      { tint: "#2a1a00", opacity: 0.12 },
  cold_fill:     { tint: "#001a2e", opacity: 0.18 },
  backlit:       { tint: "#000000", opacity: 0.3  },
  danger_red:    { tint: "#2e0000", opacity: 0.2  },
};

export class StageManager {
  /**
   * @param {object} opts
   * @param {number} opts.width        — pixel width (height = width * 420/360)
   * @param {string} opts.background   — background preset name
   * @param {string} opts.lighting     — lighting preset name
   */
  constructor({ width = 360, background = "default", lighting = "neutral" } = {}) {
    this.width   = width;
    this.height  = Math.round(STAGE_VB_H * (width / STAGE_VB_W));
    this._bg     = background;
    this._light  = lighting;
    this._layers = {};
  }

  // ── Getters ───────────────────────────────────────────────────

  get viewBox()     { return STAGE_VIEWBOX; }
  get aspectRatio() { return STAGE_VB_W / STAGE_VB_H; }

  get backgroundConfig() {
    return BACKGROUND_PRESETS[this._bg] ?? BACKGROUND_PRESETS.default;
  }

  get lightingConfig() {
    return LIGHTING_PRESETS[this._light] ?? LIGHTING_PRESETS.neutral;
  }

  // ── Configuration ─────────────────────────────────────────────

  setBackground(name) {
    if (!BACKGROUND_PRESETS[name]) {
      console.warn(`[StageManager] Unknown background: "${name}". Using default.`);
    }
    this._bg = BACKGROUND_PRESETS[name] ? name : "default";
    return this;
  }

  setLighting(name) {
    this._light = LIGHTING_PRESETS[name] ? name : "neutral";
    return this;
  }

  setWidth(width) {
    this.width  = width;
    this.height = Math.round(STAGE_VB_H * (width / STAGE_VB_W));
    return this;
  }

  // ── Layer registration ────────────────────────────────────────

  /**
   * Register a DOM element as a stage layer.
   * Layers are used for camera targeting and z-ordering.
   */
  registerLayer(name, el) {
    this._layers[name] = el;
    return this;
  }

  getLayer(name) {
    return this._layers[name] ?? null;
  }

  // ── Character positioning helpers ─────────────────────────────

  /**
   * Calculate stage x position for common placements.
   * Returns stage-unit x coordinate.
   */
  getPositionX(placement) {
    const positions = {
      center:       0,
      left:        -80,
      right:        80,
      far_left:    -140,
      far_right:    140,
      center_left:  -40,
      center_right:  40,
    };
    return positions[placement] ?? 0;
  }

  /**
   * Calculate scale for a character based on their perceived distance.
   * Farther characters appear smaller.
   */
  getDepthScale(layer = "foreground") {
    const scales = {
      foreground: 1.0,
      midground:  0.75,
      background: 0.5,
    };
    return scales[layer] ?? 1.0;
  }

  // ── Background SVG generation ─────────────────────────────────

  /**
   * Generate SVG background elements for a given preset.
   * Returns an array of SVG element descriptors for the Stage component.
   */
  generateBackground(presetName) {
    const preset = BACKGROUND_PRESETS[presetName] ?? BACKGROUND_PRESETS.default;
    const W = STAGE_VB_W;
    const H = STAGE_VB_H;
    const x = STAGE_VB_X;
    const y = STAGE_VB_Y;

    const elements = [];

    // Sky gradient
    if (preset.sky && preset.sky.length >= 2) {
      elements.push({
        type: "gradient_rect",
        id:   `bg_sky_${presetName}`,
        x, y, width: W, height: H,
        colors: preset.sky,
        layer: LAYER.SKY,
      });
    }

    // Floor plane
    if (preset.floor) {
      elements.push({
        type:  "rect",
        id:    `bg_floor_${presetName}`,
        x,
        y:     -20,
        width: W,
        height: 40,
        fill:  preset.floor,
        layer: LAYER.FLOOR,
      });
    }

    return elements;
  }

  // ── Responsive scaling ────────────────────────────────────────

  /**
   * Calculate the pixel scale factor for a target container width.
   * Used when embedding the stage in different viewport sizes.
   */
  scaleForContainer(containerWidth) {
    return containerWidth / STAGE_VB_W;
  }

  /**
   * Recommended pixel sizes for common device targets.
   */
  static get DEVICE_WIDTHS() {
    return {
      tiktok_export:  1080,  // 1080×1920 (9:16 4K export)
      instagram_reel: 1080,
      iphone_preview:  390,
      dev_preview:     360,
      thumbnail:       180,
    };
  }
}
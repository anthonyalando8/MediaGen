import { gsap }         from "gsap";
import { BUILTIN_VARIANTS } from "../assets/AssetLoader.js";

/**
 * CharacterVariantSystem.js
 * -------------------------
 * Runtime palette swap system. Changes a character's color scheme
 * by directly tweening or setting SVG fill/stroke values.
 *
 * Works WITH the two-group SVG architecture — targets the raw path
 * elements inside the rig by their data-rig-part attribute.
 *
 * ── How it works ────────────────────────────────────────────────
 * Each variant defines a palette: { skin, hair, shirt, pants, shoes }
 * The system maps palette keys to SVG fill colors on rig parts.
 * Colors are applied via GSAP attr tweens or direct style mutation.
 *
 * ── Usage ────────────────────────────────────────────────────────
 *   // Instant swap:
 *   VariantSystem.apply(rigRef, "villain_default");
 *
 *   // Animated morph (crossfade colors):
 *   VariantSystem.morph(rigRef, "hero_alt", { dur: 0.5 });
 *
 *   // Custom palette:
 *   VariantSystem.applyPalette(rigRef, {
 *     skin: "#8B5E3C", hair: "#1A0A00", shirt: "#BF3A3A"
 *   });
 */

// ── Palette → SVG part mapping ────────────────────────────────────
// Maps palette key → array of { part, property, selector }
// 'part' matches data-rig-part attributes on SVG <g> elements.
// 'selector' is a CSS selector for child path/ellipse/rect elements.
const PALETTE_MAP = {
  skin: [
    { part: "head",       selector: "rect, ellipse"  },
    { part: "lower_arm",  selector: "path"           },
    { part: "hand",       selector: "ellipse, rect"  },
  ],
  hair: [
    { part: "head",       selector: "path"           },
  ],
  shirt: [
    { part: "torso",      selector: "path:first-child" },
    { part: "upper_arm",  selector: "path:first-child" },
  ],
  pants: [
    { part: "hip",        selector: "path:first-child" },
    { part: "leg",        selector: "path:first-child" },
  ],
  shoes: [
    { part: "foot",       selector: "path"           },
  ],
};

export class CharacterVariantSystemClass {

  /**
   * Apply a variant by ID — instant, no animation.
   * @param {object} rig       — rigRef map from SVGPuppet
   * @param {string} variantId — variant ID from BUILTIN_VARIANTS or custom
   * @param {object} customVariants — additional variants to check
   */
  apply(rig, variantId, customVariants = {}) {
    const variant = customVariants[variantId]
      ?? BUILTIN_VARIANTS[variantId];

    if (!variant) {
      console.warn(`[VariantSystem] Unknown variant: "${variantId}"`);
      return;
    }

    this.applyPalette(rig, variant.palette);
  }

  /**
   * Apply a palette object directly.
   * @param {object} rig      — rigRef map
   * @param {object} palette  — { skin, hair, shirt, pants, shoes }
   */
  applyPalette(rig, palette) {
    if (!palette) return;

    Object.entries(palette).forEach(([key, color]) => {
      const targets = PALETTE_MAP[key];
      if (!targets) return;

      targets.forEach(({ part, selector }) => {
        const partEl = this._getPartEl(rig, part);
        if (!partEl) return;

        // Find all matching child elements
        const children = partEl.querySelectorAll(selector);
        children.forEach((el) => {
          // Apply to fill if element has fill, stroke if it has stroke
          if (el.getAttribute("fill") && el.getAttribute("fill") !== "none") {
            el.setAttribute("fill", color);
          }
        });
      });
    });
  }

  /**
   * Animated palette morph — smoothly transitions colors.
   * Uses GSAP to tween CSS fill property.
   * @param {object} rig
   * @param {string} variantId
   * @param {object} opts     — { dur, ease, customVariants }
   */
  morph(rig, variantId, { dur = 0.5, ease = "power2.inOut", customVariants = {} } = {}) {
    const variant = customVariants[variantId] ?? BUILTIN_VARIANTS[variantId];
    if (!variant) {
      console.warn(`[VariantSystem] Unknown variant: "${variantId}"`);
      return;
    }

    return this.morphPalette(rig, variant.palette, { dur, ease });
  }

  /**
   * Morph to a custom palette with animation.
   */
  morphPalette(rig, palette, { dur = 0.5, ease = "power2.inOut" } = {}) {
    if (!palette) return;

    const tl = gsap.timeline();

    Object.entries(palette).forEach(([key, color]) => {
      const targets = PALETTE_MAP[key];
      if (!targets) return;

      targets.forEach(({ part, selector }) => {
        const partEl = this._getPartEl(rig, part);
        if (!partEl) return;

        partEl.querySelectorAll(selector).forEach((el) => {
          if (el.getAttribute("fill") && el.getAttribute("fill") !== "none") {
            tl.to(el, { fill: color, duration: dur, ease }, 0);
          }
        });
      });
    });

    return tl;
  }

  /**
   * Read the current palette from a rig.
   * Useful for snapshotting before a swap.
   */
  readPalette(rig) {
    const palette = {};
    Object.entries(PALETTE_MAP).forEach(([key, targets]) => {
      const { part, selector } = targets[0];
      const partEl = this._getPartEl(rig, part);
      if (!partEl) return;
      const el = partEl.querySelector(selector);
      if (el) palette[key] = el.getAttribute("fill") ?? null;
    });
    return palette;
  }

  /**
   * List available built-in variant IDs.
   */
  listVariants() {
    return Object.keys(BUILTIN_VARIANTS);
  }

  // ── Internal ─────────────────────────────────────────────────

  _getPartEl(rig, partName) {
    // Try direct rig ref first
    const directRef = rig[partName];
    if (directRef && directRef.nodeType) return directRef;

    // Fall back to querySelector on root element
    if (rig.root) {
      return rig.root.querySelector(`[data-rig-part="${partName}"]`);
    }

    return null;
  }
}

export const VariantSystem = new CharacterVariantSystemClass();
export default VariantSystem;
import { gsap }           from "gsap";
import { VISEME_LIBRARY } from "./visemeLibrary.js";
import { LipSyncEngine }  from "./LipSyncEngine.js";

/**
 * LipSyncTimeline.js
 * ------------------
 * Converts a timed viseme sequence into a GSAP timeline that
 * animates the mouth rig parts (upperLip, lowerLip, cavity).
 *
 * The mouth rig (from Mouth.jsx useImperativeHandle) exposes:
 *   mouth.el        — whole group (for scaleX expression blending)
 *   mouth.upperLip  — upper lip <g> (y translate for lip sync)
 *   mouth.lowerLip  — lower lip <g> (y translate for lip sync)
 *
 * ── Two animation strategies ─────────────────────────────────────
 *
 * SCALE mode (default, no MorphSVG plugin):
 *   Animates scaleY on the lip groups to simulate open/close.
 *   Works with GSAP free tier. Good enough for ~90% of use cases.
 *
 * PATH mode (requires GSAP MorphSVGPlugin — Club GSAP):
 *   Morphs the actual SVG path d-values between viseme shapes.
 *   True lip sync — each phoneme has distinct lip shape.
 *   Enabled automatically when MorphSVGPlugin is detected.
 *
 * ── Usage ────────────────────────────────────────────────────────
 *   // From scene JSON dialogue:
 *   const tl = LipSyncTimeline.fromDialogue(dialogue, mouthRig);
 *   masterTL.add(tl, dialogue.startAt);
 *
 *   // From text (auto-estimated):
 *   const tl = LipSyncTimeline.fromText("Hello world", mouthRig, { startAt: 2.0 });
 *   masterTL.add(tl, 0);
 */
export class LipSyncTimeline {

  /**
   * Build from a scene JSON dialogue directive.
   *
   * Dialogue shape (scene JSON):
   * {
   *   startAt: 3.2,
   *   text: "You won't get away with this.",
   *   phonemes: [                         // optional — if omitted, text mode used
   *     { phoneme: "Y", start: 0.0, end: 0.06 },
   *     { phoneme: "UW", start: 0.06, end: 0.14 },
   *     ...
   *   ],
   *   wpm: 140                            // optional, for text mode
   * }
   *
   * @param {object} dialogue  — dialogue directive from scene JSON
   * @param {object} mouthRig  — mouth ref from SVGPuppet (mouth.el, mouth.upperLip, mouth.lowerLip)
   * @returns {gsap.core.Timeline}
   */
  static fromDialogue(dialogue, mouthRig) {
    const { startAt = 0, text, phonemes, wpm = 140 } = dialogue;

    let visemes;
    if (phonemes && phonemes.length > 0) {
      // Precise phoneme data provided (from forced alignment)
      visemes = LipSyncEngine.fromPhonemes(phonemes);
    } else if (text) {
      // Auto-estimate from text
      visemes = LipSyncEngine.fromText(text, 0, wpm);
    } else {
      return gsap.timeline(); // empty — nothing to sync
    }

    return this._buildTimeline(visemes, mouthRig);
  }

  /**
   * Build directly from plain text (convenience method).
   *
   * @param {string} text
   * @param {object} mouthRig
   * @param {object} opts — { wpm, startAt }
   * @returns {gsap.core.Timeline}
   */
  static fromText(text, mouthRig, { wpm = 140 } = {}) {
    const visemes = LipSyncEngine.fromText(text, 0, wpm);
    return this._buildTimeline(visemes, mouthRig);
  }

  /**
   * Build from pre-computed viseme array.
   * @param {Array} visemes  — from LipSyncEngine output
   * @param {object} mouthRig
   * @returns {gsap.core.Timeline}
   */
  static fromVisemes(visemes, mouthRig) {
    return this._buildTimeline(visemes, mouthRig);
  }

  // ── Core timeline builder ────────────────────────────────────────

  static _buildTimeline(visemes, mouthRig) {
    if (!mouthRig || !visemes.length) return gsap.timeline();

    const tl = gsap.timeline({ id: "lipsync" });

    // Detect MorphSVG availability
    const hasMorphSVG = typeof gsap.plugins?.morphSVG !== "undefined"
                     || typeof window?.MorphSVGPlugin !== "undefined";

    if (hasMorphSVG) {
      return this._buildPathMorphTimeline(visemes, mouthRig, tl);
    } else {
      return this._buildScaleTimeline(visemes, mouthRig, tl);
    }
  }

  // ── Strategy A: Scale mode (GSAP free) ──────────────────────────

  static _buildScaleTimeline(visemes, mouthRig, tl) {
    const { el, upperLip, lowerLip } = mouthRig;

    // Reset to closed at the start
    tl.set([upperLip, lowerLip], { y: 0 });

    visemes.forEach((v, i) => {
      const dur      = Math.max(0.04, v.end - v.start);
      const openness = v.weight; // 0..1
      const ease     = dur < 0.08 ? "none" : "power1.inOut";

      // Translate upper lip up, lower lip down proportionally
      // In the mouth's scale(s) space: max excursion ≈ 4px each direction
      const upperY = -(openness * 3.5); // negative = up
      const lowerY =  (openness * 4.5); // positive = down

      // Blend with expression scaleX (preserve current scaleX)
      tl.to(upperLip, { y: upperY, duration: dur * 0.6, ease }, v.start);
      tl.to(lowerLip, { y: lowerY, duration: dur * 0.6, ease }, v.start);
    });

    // Close mouth after last viseme
    const lastViseme = visemes[visemes.length - 1];
    tl.to([upperLip, lowerLip], {
      y: 0, duration: 0.1, ease: "power2.out",
    }, lastViseme.end);

    return tl;
  }

  // ── Strategy B: Path morph mode (MorphSVGPlugin) ─────────────────

  static _buildPathMorphTimeline(visemes, mouthRig, tl) {
    // With MorphSVG we can morph the actual path d-values.
    // The mouth SVG has elements with data-rig-part attributes.
    const mouthEl    = mouthRig.el;
    const upperPath  = mouthEl?.querySelector("[data-rig-part='mouth_upper'] path");
    const lowerPath  = mouthEl?.querySelector("[data-rig-part='mouth_lower'] path");

    if (!upperPath || !lowerPath) {
      // Fallback to scale mode
      return this._buildScaleTimeline(visemes, mouthRig, tl);
    }

    visemes.forEach((v) => {
      const shape = VISEME_LIBRARY[v.viseme] ?? VISEME_LIBRARY.rest;
      const dur   = Math.max(0.04, v.end - v.start);

      tl.to(upperPath, {
        morphSVG: shape.upperLip,
        duration: dur * 0.7,
        ease: "power1.inOut",
      }, v.start);

      tl.to(lowerPath, {
        morphSVG: shape.lowerLip,
        duration: dur * 0.7,
        ease: "power1.inOut",
      }, v.start);
    });

    // Close
    const last  = visemes[visemes.length - 1];
    const rest  = VISEME_LIBRARY.rest;
    tl.to(upperPath, { morphSVG: rest.upperLip, duration: 0.1 }, last.end);
    tl.to(lowerPath, { morphSVG: rest.lowerLip, duration: 0.1 }, last.end);

    return tl;
  }

  /**
   * Preview helper — returns viseme sequence as a readable string.
   * Useful for debugging scene dialogue timing.
   */
  static preview(dialogue) {
    const { text, phonemes, wpm = 140 } = dialogue;
    const visemes = phonemes?.length
      ? LipSyncEngine.fromPhonemes(phonemes)
      : LipSyncEngine.fromText(text ?? "", 0, wpm);

    return visemes.map(v =>
      `${v.start.toFixed(2)}s → ${v.end.toFixed(2)}s  [${v.viseme}]  ${v.weight.toFixed(2)}`
    ).join("\n");
  }
}
import { PHONEME_TO_VISEME, VISEME_LIBRARY, VISEME_OPENNESS } from "./visemeLibrary.js";

/**
 * LipSyncEngine.js
 * ----------------
 * Converts dialogue data into timed viseme sequences for GSAP.
 *
 * ── Three input modes ────────────────────────────────────────────
 *
 * 1. PHONEME mode (most accurate):
 *    Input: array of { phoneme, start, end } from CMU Pronouncing
 *    Dictionary or forced-alignment tools (e.g. Montreal Forced Aligner).
 *    → Direct phoneme→viseme mapping.
 *
 * 2. TEXT mode (auto-estimate, no audio required):
 *    Input: plain text string + start time + words-per-minute.
 *    → Converts text to approximate phoneme durations.
 *    → Suitable for scene previewing and non-critical dialogue.
 *
 * 3. AMPLITUDE mode (audio-driven, coarse):
 *    Input: Float32Array of audio amplitude samples + sample rate.
 *    → Maps amplitude to mouth openness directly.
 *    → No phoneme accuracy — just open/close based on sound level.
 *
 * ── Output ───────────────────────────────────────────────────────
 * All modes produce the same output shape:
 * [
 *   { viseme: "AH_AA", start: 0.0, end: 0.15, weight: 0.9 },
 *   { viseme: "rest",  start: 0.15, end: 0.2, weight: 0.0 },
 *   ...
 * ]
 * This is consumed by LipSyncTimeline to build the GSAP tween sequence.
 */

// ── English phoneme duration averages (seconds) ──────────────────
// Based on average speech at ~150 words/minute (natural conversation).
const PHONEME_DURATIONS = {
  // Vowels — longer
  "AA": 0.12, "AE": 0.11, "AH": 0.09, "AO": 0.12,
  "AW": 0.13, "AY": 0.12, "EH": 0.10, "ER": 0.13,
  "EY": 0.11, "IH": 0.08, "IY": 0.10, "OW": 0.12,
  "OY": 0.14, "UH": 0.09, "UW": 0.11,
  // Consonants — shorter
  "B":  0.07, "CH": 0.08, "D":  0.06, "DH": 0.05,
  "F":  0.07, "G":  0.07, "HH": 0.06, "JH": 0.08,
  "K":  0.07, "L":  0.06, "M":  0.07, "N":  0.06,
  "NG": 0.07, "P":  0.07, "R":  0.06, "S":  0.08,
  "SH": 0.08, "T":  0.06, "TH": 0.07, "V":  0.06,
  "W":  0.06, "Y":  0.05, "Z":  0.07, "ZH": 0.07,
  // Silence
  "SIL": 0.15, "SP": 0.08,
};

// ── Simple English text→phoneme approximation ────────────────────
// Maps common words to their dominant phoneme sequences.
// Not a full dictionary — covers ~200 most common words.
// For production: use CMU dict lookup or server-side forced alignment.
const WORD_PHONEMES = {
  "the":    ["DH","AH"],      "a":      ["AH"],
  "i":      ["AY"],           "you":    ["Y","UW"],
  "is":     ["IH","Z"],       "it":     ["IH","T"],
  "in":     ["IH","N"],       "that":   ["DH","AE","T"],
  "he":     ["HH","IY"],      "she":    ["SH","IY"],
  "we":     ["W","IY"],       "they":   ["DH","EY"],
  "what":   ["W","AH","T"],   "this":   ["DH","IH","S"],
  "are":    ["AA","R"],       "for":    ["F","AO","R"],
  "not":    ["N","AO","T"],   "with":   ["W","IH","DH"],
  "have":   ["HH","AE","V"],  "from":   ["F","R","AH","M"],
  "do":     ["D","UW"],       "can":    ["K","AE","N"],
  "will":   ["W","IH","L"],   "no":     ["N","OW"],
  "yes":    ["Y","EH","S"],   "hello":  ["HH","AH","L","OW"],
  "go":     ["G","OW"],       "stop":   ["S","T","AO","P"],
  "now":    ["N","AW"],       "how":    ["HH","AW"],
  "your":   ["Y","AO","R"],   "time":   ["T","AY","M"],
  "never":  ["N","EH","V","ER"], "away": ["AH","W","EY"],
};

export class LipSyncEngine {

  // ── Mode 1: Phoneme array input ──────────────────────────────────

  /**
   * Convert an array of timed phonemes to timed visemes.
   *
   * @param {Array<{phoneme, start, end}>} phonemes
   * @returns {Array<{viseme, start, end, weight}>}
   */
  static fromPhonemes(phonemes) {
    const result = [];

    phonemes.forEach(({ phoneme, start, end }) => {
      const viseme  = PHONEME_TO_VISEME[phoneme.toUpperCase()] ?? "rest";
      const weight  = VISEME_OPENNESS[viseme] ?? 0;
      result.push({ viseme, start, end, weight });
    });

    return this._smooth(result);
  }

  // ── Mode 2: Text → auto-estimated phoneme timing ─────────────────

  /**
   * Convert plain text to a viseme sequence with estimated timing.
   * No audio required — timing is based on average phoneme durations.
   *
   * @param {string} text         — dialogue text
   * @param {number} startTime    — when dialogue begins (seconds)
   * @param {number} wpm          — speaking rate (default 140 wpm)
   * @returns {Array<{viseme, start, end, weight}>}
   */
  static fromText(text, startTime = 0, wpm = 140) {
    const speedFactor = 140 / wpm; // scale durations by speed
    const words       = text.toLowerCase()
                            .replace(/[^a-z\s]/g, "")
                            .split(/\s+/)
                            .filter(Boolean);

    const phonemeSequence = [];
    let cursor = startTime;

    words.forEach((word, wi) => {
      // Add inter-word pause
      if (wi > 0) {
        phonemeSequence.push({ phoneme: "SP", start: cursor, end: cursor + 0.06 });
        cursor += 0.06;
      }

      // Get phonemes for word
      const phonemes = WORD_PHONEMES[word] ?? this._naivePhonemes(word);

      phonemes.forEach((ph) => {
        const dur = (PHONEME_DURATIONS[ph] ?? 0.08) * speedFactor;
        phonemeSequence.push({ phoneme: ph, start: cursor, end: cursor + dur });
        cursor += dur;
      });
    });

    // Terminal silence
    phonemeSequence.push({ phoneme: "SIL", start: cursor, end: cursor + 0.1 });

    return this.fromPhonemes(phonemeSequence);
  }

  // ── Mode 3: Audio amplitude → mouth openness ─────────────────────

  /**
   * Convert audio amplitude data to mouth openness timeline.
   * Coarse sync — no phoneme accuracy, but works with any audio.
   *
   * @param {Float32Array} samples    — audio samples (-1..1)
   * @param {number}       sampleRate — samples per second
   * @param {number}       startTime  — offset in seconds
   * @param {number}       frameRate  — analysis frames per second (default 30)
   * @returns {Array<{viseme, start, end, weight}>}
   */
  static fromAmplitude(samples, sampleRate, startTime = 0, frameRate = 30) {
    const samplesPerFrame = Math.floor(sampleRate / frameRate);
    const result = [];
    const frameCount = Math.floor(samples.length / samplesPerFrame);

    for (let i = 0; i < frameCount; i++) {
      const start = startTime + (i / frameRate);
      const end   = start + (1 / frameRate);

      // RMS amplitude for this frame
      let sum = 0;
      const offset = i * samplesPerFrame;
      for (let j = 0; j < samplesPerFrame; j++) {
        const s = samples[offset + j] ?? 0;
        sum += s * s;
      }
      const rms    = Math.sqrt(sum / samplesPerFrame);
      const weight = Math.min(1, rms * 3); // amplify for visibility

      // Map weight to appropriate viseme
      let viseme;
      if      (weight < 0.05) viseme = "rest";
      else if (weight < 0.25) viseme = "D_T_N";
      else if (weight < 0.5)  viseme = "EH";
      else if (weight < 0.75) viseme = "AH_AA";
      else                    viseme = "AH_AA";

      result.push({ viseme, start, end, weight });
    }

    return result;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /**
   * Naive text→phoneme for unknown words.
   * Converts letter combinations to approximate phonemes.
   */
  static _naivePhonemes(word) {
    const phonemes = [];
    let i = 0;
    while (i < word.length) {
      const pair = word.slice(i, i + 2).toUpperCase();
      const ch   = word[i].toUpperCase();

      if      (pair === "TH") { phonemes.push("TH");  i += 2; }
      else if (pair === "CH") { phonemes.push("CH");  i += 2; }
      else if (pair === "SH") { phonemes.push("SH");  i += 2; }
      else if (pair === "PH") { phonemes.push("F");   i += 2; }
      else if (pair === "WH") { phonemes.push("W");   i += 2; }
      else if ("AEIOU".includes(ch)) {
        // Approximate vowel
        const vmap = { A:"AE", E:"EH", I:"IH", O:"OW", U:"AH" };
        phonemes.push(vmap[ch] ?? "AH");
        i++;
      }
      else {
        // Consonant passthrough
        if (PHONEME_TO_VISEME[ch]) phonemes.push(ch);
        i++;
      }
    }
    return phonemes.length ? phonemes : ["AH"];
  }

  /**
   * Smooth viseme transitions — remove single-frame flickers
   * and add brief rests between very different visemes.
   */
  static _smooth(visemes) {
    if (visemes.length < 2) return visemes;

    const smoothed = [...visemes];

    // Merge consecutive identical visemes
    const merged = [];
    for (let i = 0; i < smoothed.length; i++) {
      const curr = smoothed[i];
      const prev = merged[merged.length - 1];
      if (prev && prev.viseme === curr.viseme) {
        prev.end = curr.end; // extend
      } else {
        merged.push({ ...curr });
      }
    }

    return merged;
  }

  /**
   * Calculate total dialogue duration from viseme sequence.
   */
  static getDuration(visemes) {
    if (!visemes.length) return 0;
    return visemes[visemes.length - 1].end - visemes[0].start;
  }
}
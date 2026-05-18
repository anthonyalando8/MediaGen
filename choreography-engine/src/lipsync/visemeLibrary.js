/**
 * visemeLibrary.js
 * ----------------
 * Defines every mouth shape (viseme) as SVG path data.
 *
 * ── Coordinate system ─────────────────────────────────────────────
 * All paths are in the Mouth component's native viewBox: 0 0 56 32.
 * The mouth center is at (28, 18).
 * Upper lip path is painted last (on top).
 *
 * ── Viseme groups ─────────────────────────────────────────────────
 * We use the Preston Blair viseme set, condensed to 10 shapes that
 * cover all English phonemes without over-complexity:
 *
 *   REST     — neutral closed mouth (silence)
 *   MBP      — lips together (M, B, P sounds)
 *   F_V      — lower lip touches upper teeth (F, V)
 *   TH       — tongue tip visible between teeth (TH)
 *   EE_IH    — wide stretched lips (EE, IH, AE sounds)
 *   OH_OW    — rounded lips (OH, OW, UW sounds)
 *   AH_AA    — open mouth (AH, AA, AO, AW sounds)
 *   EH       — half-open, relaxed (EH, AY, EY sounds)
 *   WQ       — very rounded, lips pucker (W, OO, Q sounds)
 *   D_T_N    — teeth slightly open, tongue up (D, T, N, L)
 *
 * ── Path format ───────────────────────────────────────────────────
 * Each viseme defines:
 *   cavity   — inner mouth / darkness
 *   upperLip — upper lip shape (rendered on top)
 *   lowerLip — lower lip shape
 *   teeth    — optional upper teeth rect (x, y, w, h, rx)
 *   openness — 0..1 normalized mouth open amount (for blending)
 */

// ── Upper lip path factory (varies by horizontal stretch and height) ──
// U(stretch, height_offset): stretch -1..+1, height_offset = lip raise
const ULP = {
  closed:    "M6 16 Q14 13 28 14 Q42 13 50 16 Q42 14 28 16 Q14 14 6 16 Z",
  smile_sm:  "M6 16 Q14 11 28 13 Q42 11 50 16 Q42 13 28 14 Q14 13 6 16 Z",
  smile_lg:  "M5 16 Q14 9  28 11 Q42 9  51 16 Q42 11 28 12 Q14 11 5 16 Z",
  open_sm:   "M8 15 Q16 11 28 12 Q40 11 48 15 Q40 13 28 14 Q16 13 8 15 Z",
  open_md:   "M9 14 Q17 9  28 10 Q39 9  47 14 Q39 11 28 12 Q17 11 9 14 Z",
  open_lg:   "M10 13 Q18 7 28 8 Q38 7 46 13 Q38 10 28 11 Q18 10 10 13 Z",
  pucker:    "M14 17 Q20 13 28 14 Q36 13 42 17 Q36 15 28 16 Q20 15 14 17 Z",
  fv:        "M6 15 Q14 12 28 13 Q42 12 50 15 Q42 13 28 14 Q14 13 6 15 Z",
  mbp:       "M6 16 Q17 15 28 16 Q39 15 50 16 Q39 16 28 17 Q17 16 6 16 Z",
  wide:      "M3  16 Q14 10 28 12 Q42 10 53 16 Q42 12 28 13 Q14 12 3 16 Z",
};

// ── Lower lip path factory ────────────────────────────────────────
const LLP = {
  closed:    "M6 16 Q18 20 28 21 Q38 20 50 16 Q40 18 28 19 Q16 18 6 16 Z",
  open_sm:   "M8 17 Q18 23 28 25 Q38 23 48 17 Q40 21 28 23 Q16 21 8 17 Z",
  open_md:   "M9 17 Q18 25 28 27 Q38 25 47 17 Q39 23 28 25 Q17 23 9 17 Z",
  open_lg:   "M10 16 Q18 27 28 29 Q38 27 46 16 Q38 24 28 27 Q18 24 10 16 Z",
  pucker:    "M14 17 Q20 22 28 23 Q36 22 42 17 Q36 20 28 21 Q20 20 14 17 Z",
  fv:        "M6 18 Q18 24 28 25 Q38 24 50 18 Q40 22 28 23 Q16 22 6 18 Z",
  mbp:       "M6 16 Q17 17 28 17 Q39 17 50 16 Q39 17 28 17 Q17 17 6 16 Z",
  wide:      "M3 16 Q16 23 28 25 Q40 23 53 16 Q42 21 28 23 Q14 21 3 16 Z",
  th:        "M9 17 Q18 22 28 23 Q38 22 47 17 Q39 20 28 21 Q17 20 9 17 Z",
};

// ── Cavity (inner darkness) paths ─────────────────────────────────
const CAV = {
  none:    null,
  tiny:    { cx: 28, cy: 18, rx: 8,  ry: 4  },
  small:   { cx: 28, cy: 19, rx: 14, ry: 7  },
  medium:  { cx: 28, cy: 19, rx: 18, ry: 10 },
  large:   { cx: 28, cy: 20, rx: 20, ry: 12 },
  round:   { cx: 28, cy: 20, rx: 12, ry: 11 },
  wide:    { cx: 28, cy: 19, rx: 22, ry: 8  },
};

// ── Viseme definitions ────────────────────────────────────────────
export const VISEME_LIBRARY = {

  /**
   * REST — silence / neutral closed mouth
   */
  rest: {
    cavity:   CAV.none,
    upperLip: ULP.closed,
    lowerLip: LLP.closed,
    openness: 0,
  },

  /**
   * MBP — M, B, P — lips pressed together
   */
  MBP: {
    cavity:   CAV.none,
    upperLip: ULP.mbp,
    lowerLip: LLP.mbp,
    openness: 0,
  },

  /**
   * F_V — F, V — lower lip raised to upper teeth
   */
  F_V: {
    cavity:   CAV.tiny,
    upperLip: ULP.fv,
    lowerLip: LLP.fv,
    teeth:    { x: 12, y: 14, w: 32, h: 5, rx: 2, fill: "white" },
    openness: 0.1,
  },

  /**
   * TH — TH sounds — tongue between teeth, small gap
   */
  TH: {
    cavity:   CAV.tiny,
    upperLip: ULP.open_sm,
    lowerLip: LLP.th,
    teeth:    { x: 11, y: 13, w: 34, h: 6, rx: 2, fill: "white" },
    tongue:   true,
    openness: 0.15,
  },

  /**
   * EE_IH — EE, IH, AE — wide stretched smile with small opening
   */
  EE_IH: {
    cavity:   CAV.wide,
    upperLip: ULP.smile_lg,
    lowerLip: LLP.open_sm,
    teeth:    { x: 9, y: 13, w: 38, h: 5, rx: 2, fill: "white" },
    openness: 0.2,
  },

  /**
   * AH_AA — AH, AA, AO — open mouth, relaxed lips
   */
  AH_AA: {
    cavity:   CAV.large,
    upperLip: ULP.open_lg,
    lowerLip: LLP.open_lg,
    teeth:    { x: 10, y: 12, w: 36, h: 6, rx: 3, fill: "white" },
    openness: 0.9,
  },

  /**
   * EH — EH, AY, EY — half open, relaxed
   */
  EH: {
    cavity:   CAV.medium,
    upperLip: ULP.open_md,
    lowerLip: LLP.open_md,
    teeth:    { x: 11, y: 13, w: 34, h: 6, rx: 3, fill: "white" },
    openness: 0.5,
  },

  /**
   * OH_OW — OH, OW — rounded lips, medium opening
   */
  OH_OW: {
    cavity:   CAV.round,
    upperLip: ULP.pucker,
    lowerLip: LLP.pucker,
    openness: 0.6,
  },

  /**
   * WQ — W, OO — lips very rounded and puckered
   */
  WQ: {
    cavity:   CAV.round,
    upperLip: ULP.pucker,
    lowerLip: LLP.pucker,
    openness: 0.4,
  },

  /**
   * D_T_N — D, T, N, L — slight opening, teeth together
   */
  D_T_N: {
    cavity:   CAV.small,
    upperLip: ULP.open_sm,
    lowerLip: LLP.open_sm,
    teeth:    { x: 12, y: 13, w: 32, h: 7, rx: 3, fill: "white" },
    openness: 0.25,
  },
};

// ── Phoneme → viseme mapping ──────────────────────────────────────
// Maps ARPAbet phoneme codes to viseme keys.
// Used by LipSyncEngine to convert phoneme timing to viseme timing.
export const PHONEME_TO_VISEME = {
  // Silence
  "SIL":  "rest",  "SP": "rest",  "":  "rest",

  // Bilabial (lips together)
  "M":  "MBP",  "B": "MBP",  "P": "MBP",

  // Labiodental
  "F":  "F_V",  "V": "F_V",

  // Dental
  "TH": "TH",  "DH": "TH",

  // Alveolar stops/nasals
  "T":  "D_T_N",  "D": "D_T_N",  "N": "D_T_N",  "L": "D_T_N",

  // Vowels — open
  "AA": "AH_AA",  "AO": "AH_AA",  "AH": "AH_AA",  "AW": "AH_AA",

  // Vowels — mid
  "AE": "EE_IH",  "EY": "EH",    "EH": "EH",
  "AY": "EH",     "AX": "EH",

  // Vowels — front/high
  "IH": "EE_IH",  "IY": "EE_IH",

  // Vowels — back
  "OW": "OH_OW",  "OY": "OH_OW",  "UH": "OH_OW",
  "UW": "WQ",     "W":  "WQ",

  // Semivowels / glides
  "Y":  "EE_IH",  "HH": "AH_AA",

  // Fricatives / sibilants
  "S":  "D_T_N",  "Z": "D_T_N",
  "SH": "D_T_N",  "ZH": "D_T_N",
  "CH": "D_T_N",  "JH": "D_T_N",

  // Velar / glottal
  "K":  "D_T_N",  "G": "D_T_N",
  "NG": "D_T_N",  "R": "EH",

  // Approximants
  "ER": "EH",
};

// ── Viseme blend weights ──────────────────────────────────────────
// How aggressively each viseme opens the mouth.
// Used by LipSyncEngine for smooth interpolation.
export const VISEME_OPENNESS = Object.fromEntries(
  Object.entries(VISEME_LIBRARY).map(([k, v]) => [k, v.openness])
);

// ── List of all viseme names ──────────────────────────────────────
export const VISEME_NAMES = Object.keys(VISEME_LIBRARY);
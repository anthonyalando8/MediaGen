/**
 * RigSchema.js
 * ------------
 * The non-negotiable contract every character asset must satisfy.
 * All action presets, expression resolvers, and timeline builders
 * reference ONLY these names — never raw DOM selectors.
 *
 * transformOrigin: CSS transform-origin value applied at runtime.
 * zIndex:         SVG rendering order (higher = in front).
 * parent:         Logical parent for hierarchical transforms.
 * animatable:     Parts the ActionRegistry is allowed to touch.
 */

export const RIG_SCHEMA = {
  // ── Body parts ──────────────────────────────────────────────────
  parts: {
    // Root anchor — never animated directly, positions the whole character
    root: {
      zIndex: 0,
      transformOrigin: "50% 100%",
      animatable: false,
    },

    // Shadow beneath feet
    shadow: {
      zIndex: 1,
      transformOrigin: "50% 50%",
      animatable: true,
    },

    // Lower body
    hip: {
      zIndex: 4,
      transformOrigin: "50% 0%",
      parent: "root",
      animatable: true,
    },
    leg_l: {
      zIndex: 3,
      transformOrigin: "50% 0%",
      parent: "hip",
      animatable: true,
    },
    leg_r: {
      zIndex: 3,
      transformOrigin: "50% 0%",
      parent: "hip",
      animatable: true,
    },
    foot_l: {
      zIndex: 2,
      transformOrigin: "50% 0%",
      parent: "leg_l",
      animatable: true,
    },
    foot_r: {
      zIndex: 2,
      transformOrigin: "50% 0%",
      parent: "leg_r",
      animatable: true,
    },

    // Torso — everything above the hip
    torso: {
      zIndex: 5,
      transformOrigin: "50% 0%",
      parent: "root",
      animatable: true,
    },

    // Arms — left side (screen left = character's right in default facing)
    upper_arm_l: {
      zIndex: 4,
      transformOrigin: "50% 0%",
      parent: "torso",
      animatable: true,
    },
    lower_arm_l: {
      zIndex: 4,
      transformOrigin: "50% 0%",
      parent: "upper_arm_l",
      animatable: true,
    },
    hand_l: {
      zIndex: 4,
      transformOrigin: "50% 0%",
      parent: "lower_arm_l",
      animatable: true,
    },

    // Arms — right side
    upper_arm_r: {
      zIndex: 6,
      transformOrigin: "50% 0%",
      parent: "torso",
      animatable: true,
    },
    lower_arm_r: {
      zIndex: 6,
      transformOrigin: "50% 0%",
      parent: "upper_arm_r",
      animatable: true,
    },
    hand_r: {
      zIndex: 6,
      transformOrigin: "50% 0%",
      parent: "lower_arm_r",
      animatable: true,
    },

    // Head chain
    neck: {
      zIndex: 8,
      transformOrigin: "50% 100%",
      parent: "torso",
      animatable: true,
    },
    head: {
      zIndex: 9,
      transformOrigin: "50% 100%",
      parent: "neck",
      animatable: true,
    },

    // Facial features — all children of head
    brows: {
      zIndex: 12,
      transformOrigin: "50% 50%",
      parent: "head",
      animatable: true,
    },
    brow_l: {
      zIndex: 12,
      transformOrigin: "50% 50%",
      parent: "head",
      animatable: true,
    },
    brow_r: {
      zIndex: 12,
      transformOrigin: "50% 50%",
      parent: "head",
      animatable: true,
    },
    eyes: {
      zIndex: 11,
      transformOrigin: "50% 50%",
      parent: "head",
      animatable: true,
    },
    eye_l: {
      zIndex: 11,
      transformOrigin: "50% 50%",
      parent: "head",
      animatable: true,
    },
    eye_r: {
      zIndex: 11,
      transformOrigin: "50% 50%",
      parent: "head",
      animatable: true,
    },
    pupils: {
      zIndex: 12,
      transformOrigin: "50% 50%",
      parent: "head",
      animatable: true,
    },
    mouth: {
      zIndex: 11,
      transformOrigin: "50% 50%",
      parent: "head",
      animatable: true,
    },
    // Mouth sub-parts for lip sync
    mouth_upper: {
      zIndex: 11,
      transformOrigin: "50% 100%",
      parent: "head",
      animatable: true,
    },
    mouth_lower: {
      zIndex: 11,
      transformOrigin: "50% 0%",
      parent: "head",
      animatable: true,
    },
  },

  // ── Expression presets ───────────────────────────────────────────
  // Maps expression names to per-part target states.
  // Values are passed as opts into the expression resolver.
  expressions: {
    neutral: {
      brow_l:      { rotation: 0,    y: 0 },
      brow_r:      { rotation: 0,    y: 0 },
      eye_l:       { scaleY: 1,      y: 0 },
      eye_r:       { scaleY: 1,      y: 0 },
      pupils:      { scale: 1 },
      mouth:       { morphTarget: "closed", scaleX: 1 },
    },
    happy: {
      brow_l:      { rotation: -8,   y: -3 },
      brow_r:      { rotation:  8,   y: -3 },
      eye_l:       { scaleY: 0.6,    y: 2  },
      eye_r:       { scaleY: 0.6,    y: 2  },
      pupils:      { scale: 0.9 },
      mouth:       { morphTarget: "smile", scaleX: 1.1 },
    },
    angry: {
      brow_l:      { rotation:  15,  y: 4  },
      brow_r:      { rotation: -15,  y: 4  },
      eye_l:       { scaleY: 0.75,   y: 0  },
      eye_r:       { scaleY: 0.75,   y: 0  },
      pupils:      { scale: 0.85 },
      mouth:       { morphTarget: "frown", scaleX: 0.9 },
    },
    scared: {
      brow_l:      { rotation: -5,   y: -5 },
      brow_r:      { rotation:  5,   y: -5 },
      eye_l:       { scaleY: 1.3,    y: -2 },
      eye_r:       { scaleY: 1.3,    y: -2 },
      pupils:      { scale: 1.25 },
      mouth:       { morphTarget: "open_small", scaleX: 0.85 },
    },
    surprised: {
      brow_l:      { rotation: -3,   y: -7 },
      brow_r:      { rotation:  3,   y: -7 },
      eye_l:       { scaleY: 1.4,    y: -3 },
      eye_r:       { scaleY: 1.4,    y: -3 },
      pupils:      { scale: 1.3 },
      mouth:       { morphTarget: "open_wide", scaleX: 1.1 },
    },
    sad: {
      brow_l:      { rotation:  8,   y: 2  },
      brow_r:      { rotation: -8,   y: 2  },
      eye_l:       { scaleY: 0.85,   y: 1  },
      eye_r:       { scaleY: 0.85,   y: 1  },
      pupils:      { scale: 0.9 },
      mouth:       { morphTarget: "frown", scaleX: 0.8 },
    },
    smug: {
      brow_l:      { rotation: 0,    y: -1 },
      brow_r:      { rotation: -10,  y: -4 },
      eye_l:       { scaleY: 0.9,    y: 1  },
      eye_r:       { scaleY: 0.75,   y: 1  },
      pupils:      { scale: 0.9 },
      mouth:       { morphTarget: "smirk", scaleX: 1.0 },
    },
    determined: {
      brow_l:      { rotation:  5,   y: 2  },
      brow_r:      { rotation: -5,   y: 2  },
      eye_l:       { scaleY: 0.9,    y: 0  },
      eye_r:       { scaleY: 0.9,    y: 0  },
      pupils:      { scale: 1.0 },
      mouth:       { morphTarget: "firm", scaleX: 1.0 },
    },
    evil_grin: {
      brow_l:      { rotation:  12,  y: -2 },
      brow_r:      { rotation: -20,  y: -4 },
      eye_l:       { scaleY: 0.65,   y: 1  },
      eye_r:       { scaleY: 0.65,   y: 1  },
      pupils:      { scale: 0.8 },
      mouth:       { morphTarget: "evil_smile", scaleX: 1.2 },
    },
  },

  // ── Mouth viseme shapes (for lip sync) ───────────────────────────
  // SVG path d-values for mouth morph targets.
  // Populated in visemeLibrary.js — stub keys defined here for IDE awareness.
  visemes: {
    closed:      null, // M x x ...
    smile:       null,
    frown:       null,
    open_small:  null,
    open_wide:   null,
    smirk:       null,
    firm:        null,
    evil_smile:  null,
    // Phoneme visemes
    "AA":        null, // "father"
    "AE":        null, // "cat"
    "AH":        null, // "cut"
    "AO":        null, // "dog"
    "EH":        null, // "bed"
    "IH":        null, // "sit"
    "IY":        null, // "feet"
    "UH":        null, // "book"
    "UW":        null, // "food"
    "OW":        null, // "go"
    "M_B_P":     null, // bilabial — lips together
    "F_V":       null, // labiodental
    "TH":        null, // dental
    "rest":      null, // silence / default
  },
};

// ── Ordered render stack ─────────────────────────────────────────
// Parts listed back-to-front for SVG z-ordering.
export const RENDER_ORDER = [
  "shadow",
  "foot_l", "foot_r",
  "leg_l",  "leg_r",
  "hip",
  "upper_arm_l", "lower_arm_l", "hand_l",
  "torso",
  "upper_arm_r", "lower_arm_r", "hand_r",
  "neck",
  "head",
  "eyes", "eye_l", "eye_r",
  "pupils",
  "brows", "brow_l", "brow_r",
  "mouth", "mouth_upper", "mouth_lower",
];

// ── Part group aliases ───────────────────────────────────────────
// Convenience: action presets can target a group instead of individual parts.
export const PART_GROUPS = {
  face:       ["head", "brow_l", "brow_r", "eye_l", "eye_r", "pupils", "mouth"],
  arms_l:     ["upper_arm_l", "lower_arm_l", "hand_l"],
  arms_r:     ["upper_arm_r", "lower_arm_r", "hand_r"],
  arms:       ["upper_arm_l", "lower_arm_l", "hand_l", "upper_arm_r", "lower_arm_r", "hand_r"],
  legs:       ["leg_l", "leg_r", "foot_l", "foot_r"],
  upper_body: ["torso", "neck", "upper_arm_l", "upper_arm_r"],
  full_body:  Object.keys(RIG_SCHEMA.parts).filter(k => k !== "root"),
};
/**
 * scene_schema.js
 * ---------------
 * Runtime JSON Schema validator for scene objects.
 * No external dependencies — pure JS validation function.
 *
 * Usage:
 *   import { validateScene, SCENE_SCHEMA } from "./scene_schema.js";
 *
 *   const result = validateScene(sceneJSON);
 *   if (!result.ok) {
 *     console.error("Scene validation errors:", result.errors);
 *   }
 */

// ── Schema definition ─────────────────────────────────────────────
export const SCENE_SCHEMA = {
  required: ["meta", "characters"],

  meta: {
    required:  ["id", "duration"],
    optional:  ["title", "fps", "aspect", "resolution"],
    types:     { id: "string", duration: "number", fps: "number" },
    ranges:    { duration: [0.1, 600], fps: [1, 120] },
  },

  character: {
    required:  ["id"],
    optional:  ["idleMode", "startAt", "facingRight", "position", "scale", "actions", "dialogue"],
    types:     { id: "string", startAt: "number", scale: "number" },
    idleModes: ["default", "menace", "float"],
  },

  action: {
    required:  ["at"],
    optional:  ["name", "expression", "opts"],
    types:     { at: "number" },
  },

  camera: {
    required:  ["at", "preset"],
    types:     { at: "number", preset: "string" },
    presets:   [
      "wide_shot", "push_in", "dolly_out",
      "pan_left", "pan_right", "tilt_up", "tilt_down",
      "camera_shake", "handheld", "slow_push",
      "dutch_tilt", "snap_zoom", "rack_focus",
    ],
  },

  dialogue: {
    required:  ["startAt", "text"],
    optional:  ["mode", "wpm", "speaker", "phonemes"],
    types:     { startAt: "number", text: "string" },
    modes:     ["text", "phoneme", "amplitude"],
  },
};

// ── Known action names ────────────────────────────────────────────
const KNOWN_ACTIONS = new Set([
  "walk_in", "walk_out", "fade_in", "pop_in", "walk_cycle", "run_cycle",
  "jump", "recoil", "panic", "laugh", "shake_head", "nod",
  "point_forward", "wave", "arms_cross", "hands_up", "lunge", "stand_firm",
]);

const KNOWN_EXPRESSIONS = new Set([
  "neutral", "happy", "angry", "scared", "surprised", "sad",
  "smug", "determined", "evil_grin", "confused",
]);

// ── Validator ─────────────────────────────────────────────────────

/**
 * Validate a scene object against the schema.
 * @param {object} scene
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateScene(scene) {
  const errors   = [];
  const warnings = [];

  if (!scene || typeof scene !== "object") {
    return { ok: false, errors: ["Scene must be a non-null object"], warnings: [] };
  }

  // ── meta ──────────────────────────────────────────────────────
  if (!scene.meta) {
    errors.push("Missing required field: meta");
  } else {
    if (!scene.meta.id)       errors.push("meta.id is required");
    if (!scene.meta.duration) errors.push("meta.duration is required");
    if (typeof scene.meta.duration === "number") {
      if (scene.meta.duration < 0.1) errors.push("meta.duration must be ≥ 0.1s");
      if (scene.meta.duration > 600) warnings.push("meta.duration > 600s — very long scene");
    }
    if (scene.meta.fps && (scene.meta.fps < 1 || scene.meta.fps > 120)) {
      errors.push("meta.fps must be between 1 and 120");
    }
  }

  // ── characters ────────────────────────────────────────────────
  if (!Array.isArray(scene.characters)) {
    errors.push("characters must be an array");
  } else if (scene.characters.length === 0) {
    errors.push("characters array is empty");
  } else {
    const charIds = new Set();

    scene.characters.forEach((char, i) => {
      const prefix = `characters[${i}]`;

      if (!char.id) {
        errors.push(`${prefix}.id is required`);
      } else {
        if (charIds.has(char.id)) errors.push(`Duplicate character id: "${char.id}"`);
        charIds.add(char.id);
      }

      if (char.idleMode && !SCENE_SCHEMA.character.idleModes.includes(char.idleMode)) {
        warnings.push(`${prefix}.idleMode "${char.idleMode}" is not a known idle mode`);
      }

      if (char.scale !== undefined && (char.scale <= 0 || char.scale > 5)) {
        warnings.push(`${prefix}.scale ${char.scale} is outside normal range (0–5)`);
      }

      // Validate actions
      if (char.actions) {
        if (!Array.isArray(char.actions)) {
          errors.push(`${prefix}.actions must be an array`);
        } else {
          char.actions.forEach((action, j) => {
            const ap = `${prefix}.actions[${j}]`;

            if (typeof action.at !== "number") {
              errors.push(`${ap}.at must be a number`);
            }

            if (action.name && !KNOWN_ACTIONS.has(action.name)) {
              warnings.push(`${ap}.name "${action.name}" is not a built-in action (may be a plugin)`);
            }

            if (action.expression && !KNOWN_EXPRESSIONS.has(action.expression)) {
              warnings.push(`${ap}.expression "${action.expression}" is not a built-in expression`);
            }
          });

          // Check for overlapping actions at same timestamp
          const timestamps = char.actions.map(a => a.at);
          const dupes = timestamps.filter((t, i) => timestamps.indexOf(t) !== i);
          if (dupes.length > 0) {
            warnings.push(`${prefix} has multiple actions at same timestamp: ${[...new Set(dupes)].join(", ")}`);
          }
        }
      }

      // Validate dialogue
      if (char.dialogue) {
        const dialogues = Array.isArray(char.dialogue) ? char.dialogue : [char.dialogue];
        dialogues.forEach((d, j) => {
          const dp = `${prefix}.dialogue[${j}]`;
          if (typeof d.startAt !== "number") errors.push(`${dp}.startAt must be a number`);
          if (!d.text) errors.push(`${dp}.text is required`);
          if (d.mode && !SCENE_SCHEMA.dialogue.modes.includes(d.mode)) {
            warnings.push(`${dp}.mode "${d.mode}" is not a known dialogue mode`);
          }
        });
      }
    });
  }

  // ── camera ────────────────────────────────────────────────────
  if (scene.camera) {
    if (!Array.isArray(scene.camera)) {
      errors.push("camera must be an array");
    } else {
      scene.camera.forEach((cam, i) => {
        if (typeof cam.at !== "number") errors.push(`camera[${i}].at must be a number`);
        if (!cam.preset)                errors.push(`camera[${i}].preset is required`);
        if (cam.preset && !SCENE_SCHEMA.camera.presets.includes(cam.preset)) {
          warnings.push(`camera[${i}].preset "${cam.preset}" is not a built-in preset`);
        }
      });
    }
  }

  // ── Timeline sanity checks ────────────────────────────────────
  if (scene.meta?.duration && scene.characters) {
    scene.characters.forEach((char) => {
      (char.actions ?? []).forEach((action) => {
        if (action.at > scene.meta.duration) {
          warnings.push(
            `Character "${char.id}" action at ${action.at}s exceeds scene duration ${scene.meta.duration}s`
          );
        }
      });
    });
  }

  return {
    ok:       errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Throws if validation fails. Convenience for strict mode.
 */
export function assertValidScene(scene) {
  const result = validateScene(scene);
  if (!result.ok) {
    throw new Error(
      `Scene validation failed:\n${result.errors.map(e => `  ✗ ${e}`).join("\n")}`
    );
  }
  if (result.warnings.length > 0) {
    result.warnings.forEach(w => console.warn(`[SceneSchema] ⚠ ${w}`));
  }
  return true;
}
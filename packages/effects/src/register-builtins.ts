// packages/effects/src/register-builtins.ts
import { EffectRegistry, TransitionRegistry } from "./registry";
import { blurEffect } from "./effects/blur";
import { gradeEffect } from "./effects/grade";
import { glowEffect } from "./effects/glow";
import { rgbSplitEffect } from "./effects/rgb-split";
import { displaceEffect } from "./effects/displace";
import { dropShadowEffect } from "./effects/drop-shadow";
import { levelsEffect } from "./effects/levels";
import { cutTransition, dipTransition, crossDissolveTransition } from "./transitions/dip";
import { slamTransition } from "./transitions/slam";
import { whipPanTransition } from "./transitions/whip";
import { linearWipeTransition, radialWipeTransition, pushTransition } from "./transitions/wipe";

/** All Phase 2 builtin effects, in registration order — §6's "~7 effects". */
export const builtinEffects = [blurEffect, gradeEffect, glowEffect, rgbSplitEffect, displaceEffect, dropShadowEffect, levelsEffect] as const;

/** All Phase 2 builtin transitions, in registration order — §6's "~6 transitions" (and "cut" + "cross-dissolve" beyond it). */
export const builtinTransitions = [
  cutTransition,
  dipTransition,
  crossDissolveTransition,
  slamTransition,
  whipPanTransition,
  linearWipeTransition,
  radialWipeTransition,
  pushTransition,
] as const;

/**
 * Registers every Phase 2 builtin effect/transition into `reg` — called
 * once at bootstrap (apps/editor's registry-context.tsx, and again in the
 * render worker), same "bootstrap, not global singleton" convention
 * `nodekinds`'s `registerBuiltins` uses.
 */
export function registerBuiltinEffects(reg: EffectRegistry): void {
  for (const def of builtinEffects) reg.register(def);
}

export function registerBuiltinTransitions(reg: TransitionRegistry): void {
  for (const def of builtinTransitions) reg.register(def);
}
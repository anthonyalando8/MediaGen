// packages/effects/src/register-builtins.ts
import { EffectRegistry, TransitionRegistry } from "./registry";

// ── Pre-existing ──────────────────────────────────────────────────────────────
import { blurEffect }       from "./effects/blur";
import { gradeEffect }      from "./effects/grade";
import { glowEffect }       from "./effects/glow";
import { rgbSplitEffect }   from "./effects/rgb-split";
import { displaceEffect }   from "./effects/displace";
import { dropShadowEffect } from "./effects/drop-shadow";
import { levelsEffect }     from "./effects/levels";

// ── Color & grading ───────────────────────────────────────────────────────────
import { sepiaEffect }         from "./effects/sepia";
import { colorGradeEffect }    from "./effects/color-grade";
import { curvesEffect }        from "./effects/curves";
import { tonemapFilmicEffect } from "./effects/tonemap-filmic";
import { bleachBypassEffect }  from "./effects/bleach-bypass";
import { tealOrangeEffect }    from "./effects/teal-orange";
import { dayForNightEffect }   from "./effects/day-for-night";
import { infraredEffect }      from "./effects/infrared";

// ── Stylize ───────────────────────────────────────────────────────────────────
import { bloomEffect }     from "./effects/bloom";
import { filmGrainEffect } from "./effects/film-grain";
import { vignetteEffect }  from "./effects/vignette";
import { letterboxEffect } from "./effects/letterbox";
import { halationEffect }  from "./effects/halation";
import { fogEffect }       from "./effects/fog";
import { glassEffect }     from "./effects/glass";
import { oldTvEffect }     from "./effects/old-tv";
import { pixelateEffect }  from "./effects/pixelate";
import { neonEffect }      from "./effects/neon";

// ── Lens & optics ─────────────────────────────────────────────────────────────
import { lensFlareEffect }       from "./effects/lens-flare";
import { anamorphicStreakEffect } from "./effects/anamorphic-streak";
import { depthOfFieldEffect }    from "./effects/depth-of-field";

// ── Distort & motion ──────────────────────────────────────────────────────────
import { chromaticAberrationEffect } from "./effects/chromatic-aberration";
import { glitchEffect }              from "./effects/glitch";
import { cameraShakeEffect }         from "./effects/camera-shake";
import { motionBlurEffect }          from "./effects/motion-blur";
import { radialBlurEffect }          from "./effects/radial-blur";
import { mirrorEffect }              from "./effects/mirror";
import { kaleidoscopeEffect }        from "./effects/kaleidoscope";
import { rippleEffect }              from "./effects/ripple";

// ── Overlays (animated / atmospheric) ────────────────────────────────────────
import { rainEffect }         from "./effects/rain";
import { snowEffect }         from "./effects/snow";
import { sparklesEffect }     from "./effects/sparkles";
import { lightLeaksEffect }   from "./effects/light-leaks";
import { waterDropletsEffect } from "./effects/water-droplets";
import { embersEffect }       from "./effects/embers";
import { bubblesEffect }      from "./effects/bubbles";
import { dustEffect }         from "./effects/dust";

// ── Transitions ───────────────────────────────────────────────────────────────
import { cutTransition, dipTransition, crossDissolveTransition } from "./transitions/dip";
import { slamTransition }      from "./transitions/slam";
import { whipPanTransition }   from "./transitions/whip";
import { linearWipeTransition, radialWipeTransition, pushTransition } from "./transitions/wipe";

// ─────────────────────────────────────────────────────────────────────────────

export const builtinEffects = [
  // Pre-existing
  blurEffect, gradeEffect, glowEffect, rgbSplitEffect,
  displaceEffect, dropShadowEffect, levelsEffect,

  // Color & grading
  sepiaEffect, colorGradeEffect, curvesEffect, tonemapFilmicEffect,
  bleachBypassEffect, tealOrangeEffect, dayForNightEffect, infraredEffect,

  // Stylize
  bloomEffect, filmGrainEffect, vignetteEffect, letterboxEffect,
  halationEffect, fogEffect, glassEffect, oldTvEffect, pixelateEffect, neonEffect,

  // Lens & optics
  lensFlareEffect, anamorphicStreakEffect, depthOfFieldEffect,

  // Distort & motion
  chromaticAberrationEffect, glitchEffect, cameraShakeEffect,
  motionBlurEffect, radialBlurEffect, mirrorEffect, kaleidoscopeEffect, rippleEffect,

  // Overlays
  rainEffect, snowEffect, sparklesEffect, lightLeaksEffect,
  waterDropletsEffect, embersEffect, bubblesEffect, dustEffect,
] as const;

export const builtinTransitions = [
  cutTransition, dipTransition, crossDissolveTransition,
  slamTransition, whipPanTransition,
  linearWipeTransition, radialWipeTransition, pushTransition,
] as const;

export function registerBuiltinEffects(reg: EffectRegistry): void {
  for (const def of builtinEffects) reg.register(def);
}
export function registerBuiltinTransitions(reg: TransitionRegistry): void {
  for (const def of builtinTransitions) reg.register(def);
}

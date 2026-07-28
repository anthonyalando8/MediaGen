// apps/editor/src/persistence/text/services/type-scale.ts
//
// P0/§05 · The typography system.
//
// TWO layers on purpose:
//   • LEGACY_TYPE_SCALE / MIN_PX / rolePx / floorPxFor — reproduce
//     scene-import.ts's EXACT numbers so P0 is a byte-for-byte refactor.
//     Existing call sites import these unchanged.
//   • TIERS / tierPx / tierFloorPx — the new semantic scale representations
//     should prefer going forward. ROLE_TO_TIER documents the mapping so the
//     legacy roles can be retired tier-by-tier without a visual jump.
//
// One responsive formula for everything: px = round(base * min(W,H) / 1080),
// clamped to the tier's floor. Keying off the SHORTER side makes portrait and
// landscape render identical absolute text (the width-only fractions didn't).

export const TYPE_BASE = 1080;
const shortSide = (W: number, H: number) => Math.min(W, H);

// ── New semantic scale (§05) ──────────────────────────────────────────────
export interface TypeTier {
  base: number;       // px at min(W,H) = 1080
  weight: number;
  tracking: number;   // em
  lineHeight: number;
  floor: number;      // absolute readable px at base resolution
}

export const TIERS = {
  displayXl:  { base: 132, weight: 700, tracking: -0.02, lineHeight: 1.02, floor: 48 },
  displayL:   { base: 96,  weight: 700, tracking: -0.02, lineHeight: 1.04, floor: 40 },
  displayM:   { base: 76,  weight: 700, tracking: -0.01, lineHeight: 1.06, floor: 36 },
  headingXl:  { base: 60,  weight: 700, tracking: -0.01, lineHeight: 1.10, floor: 34 },
  headingL:   { base: 48,  weight: 600, tracking:  0.00, lineHeight: 1.15, floor: 30 },
  headingM:   { base: 40,  weight: 600, tracking:  0.00, lineHeight: 1.20, floor: 28 },
  subheading: { base: 34,  weight: 600, tracking:  0.01, lineHeight: 1.25, floor: 26 },
  bodyL:      { base: 30,  weight: 500, tracking:  0.00, lineHeight: 1.28, floor: 26 },
  body:       { base: 26,  weight: 400, tracking:  0.00, lineHeight: 1.30, floor: 24 },
  bodyS:      { base: 22,  weight: 400, tracking:  0.01, lineHeight: 1.30, floor: 20 },
  caption:    { base: 20,  weight: 500, tracking:  0.02, lineHeight: 1.30, floor: 18 },
  label:      { base: 18,  weight: 600, tracking:  0.08, lineHeight: 1.20, floor: 16 },
  footnote:   { base: 16,  weight: 400, tracking:  0.02, lineHeight: 1.30, floor: 14 },
  badge:      { base: 15,  weight: 700, tracking:  0.06, lineHeight: 1.10, floor: 13 },
  micro:      { base: 13,  weight: 600, tracking:  0.12, lineHeight: 1.10, floor: 12 },
} satisfies Record<string, TypeTier>;

export type TierName = keyof typeof TIERS;

/** Responsive px for a tier at a given frame size, clamped to its floor. */
export function tierPx(name: TierName, W: number, H: number): number {
  const t = TIERS[name];
  return Math.max(
    Math.round((t.floor * shortSide(W, H)) / TYPE_BASE),
    Math.round((t.base * shortSide(W, H)) / TYPE_BASE),
  );
}
export function tierFloorPx(name: TierName, W: number, H: number): number {
  return Math.round((TIERS[name].floor * shortSide(W, H)) / TYPE_BASE);
}
export function tierTracking(name: TierName, px: number): number {
  return TIERS[name].tracking * px;
}

// ── Legacy scale — verbatim from scene-import.ts, kept for P0 parity ────────
export const LEGACY_TYPE_SCALE: Record<string, number> = {
  hud: 34, keyword: 92, body: 50, caption: 56,
  hero: 96, heroSub: 52, lowerThird: 44, brand: 30,
};
export const MIN_PX: Record<string, number> = { display: 34, body: 26, caption: 30 };

export function rolePx(role: string, W: number, H: number): number {
  return Math.round(((LEGACY_TYPE_SCALE[role] ?? 50) * shortSide(W, H)) / TYPE_BASE);
}
export function floorPxFor(kind: string, W: number, H: number): number {
  return Math.round(((MIN_PX[kind] ?? 26) * shortSide(W, H)) / TYPE_BASE);
}

/** Migration guide: which tier each legacy role maps onto. Not authoritative
 * for rendering yet — `rolePx` stays the source of truth through P0/P1. */
export const ROLE_TO_TIER: Record<string, TierName> = {
  keyword: "headingXl",
  hero: "displayL",
  heroSub: "subheading",
  body: "bodyL",
  caption: "bodyL",
  hud: "label",
  lowerThird: "headingM",
  brand: "micro",
};

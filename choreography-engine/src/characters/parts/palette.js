/**
 * palette.js — single source of truth for puppet colors.
 * Re-skin the whole character by editing this one file.
 *
 * Style: flat modern vector (Storyset-like). Each surface uses ONE flat fill
 * plus ONE soft shade tone for cel-style form. No hard black outlines — the
 * "line" color is a soft warm charcoal used sparingly for the smallest accents.
 * Gender-neutral, bright friendly SaaS palette.
 */
export const PALETTE = {
  // ── skin (warm neutral tan) ──────────────────────────────
  skin:        '#F2C6A0',
  skinShade:   '#E3A87E',
  skinDeep:    '#CE8E61',
  skinLine:    '#B97C50',

  // ── hair (warm modern brown) ─────────────────────────────
  hairBase:    '#5A453A',
  hairShade:   '#46352C',
  hairHi:      '#705749',

  // ── eyes / brows ─────────────────────────────────────────
  eyeDark:     '#3A322E',   // friendly dark (not pure black)
  eyeShine:    '#FFFFFF',
  brow:        '#5A453A',

  // ── mouth ────────────────────────────────────────────────
  mouth:       '#B85C4E',   // soft warm
  mouthDeep:   '#8A3F35',
  mouthIn:     '#7A3329',
  teeth:       '#FBF6EE',

  // ── top / shirt (friendly indigo) ────────────────────────
  top:         '#5C6CD8',
  topShade:    '#4452B2',
  topHi:       '#7E8CEC',
  collar:      '#4452B2',

  // ── pants (deep calm navy) ───────────────────────────────
  pants:       '#323C5E',
  pantsShade:  '#262E49',
  pantsHi:     '#46527A',

  // ── shoes (off-white + teal accent sole) ─────────────────
  shoe:        '#F4F1E9',
  shoeShade:   '#DDD7C8',
  shoeSole:    '#1FB6A0',
  shoeSoleSh:  '#15917F',

  // ── accents ──────────────────────────────────────────────
  blush:       '#F0A892',
  line:        '#3A322E',   // soft warm charcoal, used sparingly
};

// apps/editor/src/inspector/effect-categories.ts
//
// UI-ONLY taxonomy for the redesigned Effects panel. The effect *registry*
// stays the flat list it is today — this module is the presentation layer
// that the new EffectsBrowser / EffectStackPanel use to group, colour and
// label effects. Nothing here touches the document or any command.
//
// Category resolution order for a given EffectDef:
//   1. `def.category` if the registry already carries one (forward-compatible)
//   2. the DISPLAYNAME → category map below (matches register-builtins.ts)
//   3. fallback to "stylize" so an unknown/new effect still renders a card
//
// Colours are a single hue ramp at a constant lightness/chroma so the six
// category accents read as siblings of the teal UI accent (#35D6C1), not a
// random rainbow.

export type CategoryId = "blur" | "color" | "stylize" | "distort" | "lens" | "overlay";

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  color: string;
}

/** Ordered for display in the browser. */
export const CATEGORIES: CategoryMeta[] = [
  { id: "blur", label: "Blur", color: "#46cfe0" },
  { id: "color", label: "Color", color: "#e6a93f" },
  { id: "stylize", label: "Stylize", color: "#b98cff" },
  { id: "distort", label: "Distort", color: "#f2766b" },
  { id: "lens", label: "Lens", color: "#5b9ef2" },
  { id: "overlay", label: "Overlay", color: "#4fcf8b" },
];

const CATEGORY_BY_ID: Record<string, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

// Mirrors register-builtins.ts's grouping. Keyed by displayName (stable,
// human-readable) so it works whether or not EffectDef gains a `category`
// field later. Add new effects here when they're registered.
const DISPLAYNAME_CATEGORY: Record<string, CategoryId> = {
  "Gaussian Blur": "blur",

  Sepia: "color",
  "Color Grade": "color",
  Curves: "color",
  "Filmic Tone-Map": "color",
  "Bleach Bypass": "color",
  "Teal & Orange": "color",
  "Day for Night": "color",
  Infrared: "color",

  Bloom: "stylize",
  "Film Grain": "stylize",
  Vignette: "stylize",
  Letterbox: "stylize",
  Halation: "stylize",
  "Fog/Haze": "stylize",
  "Fog / Haze": "stylize",
  Glass: "stylize",
  "Old TV": "stylize",
  Pixelate: "stylize",
  Neon: "stylize",

  "Chromatic Aberration": "distort",
  Glitch: "distort",
  "Camera Shake": "distort",
  "Motion Blur": "distort",
  "Radial Blur": "distort",
  Mirror: "distort",
  Kaleidoscope: "distort",
  Ripple: "distort",

  "Lens Flare": "lens",
  "Anamorphic Streak": "lens",
  "Depth of Field": "lens",

  Rain: "overlay",
  Snow: "overlay",
  Sparkles: "overlay",
  "Light Leaks": "overlay",
  "Water Droplets": "overlay",
  Embers: "overlay",
  Bubbles: "overlay",
  "Dust Particles": "overlay",
};

/** A registry def carries at least these two fields (EffectDef shape). */
interface DefLike {
  effect: string;
  displayName: string;
  category?: string;
}

export function categoryOf(def: DefLike): CategoryId {
  const fromRegistry = def.category && CATEGORY_BY_ID[def.category] ? (def.category as CategoryId) : undefined;
  return fromRegistry ?? DISPLAYNAME_CATEGORY[def.displayName] ?? "stylize";
}

export function categoryMeta(id: CategoryId): CategoryMeta {
  return CATEGORY_BY_ID[id] ?? CATEGORIES[2];
}

/** Striped, category-tinted placeholder for an effect's preview tile. Swap
 *  for a real WebGL thumbnail render once previews exist — the layout is the
 *  same fixed-aspect box. */
export function previewBackground(color: string): string {
  return (
    `repeating-linear-gradient(135deg, ${color}5c 0 7px, ${color}1a 7px 15px),` +
    ` linear-gradient(180deg, ${color}26, transparent 70%), var(--surface-0)`
  );
}

/** 2–3 char monospace glyph for the preview tile (e.g. "Gaussian Blur" → "GB"). */
export function effectAbbr(name: string): string {
  const words = name.replace(/[^a-zA-Z ]/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "FX";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

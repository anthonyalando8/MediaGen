// apps/editor/src/persistence/scene-import.ts
//
// scene.json  →  Project  compiler. This is the bridge from the AI pipeline
// (script → scene.json, with per-word timing) into the editor: a scene is
// compiled to a normal `Project` (comps + nodes + audioTracks) that
// `loadProjectDocument` opens like any other document — fully editable.
//
// WHY WORDS ARE INDIVIDUAL NODES (not rich-text spans)
// ----------------------------------------------------
// The word-synced caption is the whole point of `word_times`. Rich-text
// `props.spans` could express it, BUT the persistence schema
// (packages/schema ProjectSchema) types a node's `props` as
// `z.record(ScalarSchema)` — arrays-of-span-objects are NOT scalars, so a
// project using `props.spans` fails validation the moment it's saved to a
// `.seabytes` file and re-opened. So each body word is compiled to its own
// `text` node with a first-class `props.fill` COLOR CHANNEL for the
// spoken-word highlight — schema-clean, round-trips through save/open, and
// happens to be more editable (every word is its own animatable layer).
//
// WHAT THIS v1 COMPILES (per beat, laid end-to-end on the timeline by
// `duration_ms`):
//   • a group node (organization + a future camera hook)
//   • HUD tag  (e.g. "// HOOK")           — small, accent
//   • keyword  (e.g. "UNPOPULAR LEADER")  — large display, fg/spike
//   • body     — one text node PER WORD, wrapped + aligned by this compiler
//                (no reliance on renderer align), each highlighting as it's
//                spoken (props.fill channel timed from word_times), emphasis
//                words (`*asterisks*` in body, or emphasis_times) held in the
//                spike accent
//   • brand    (e.g. "SeaBytes")          — small, accent
//
// DELIBERATELY v2 (documented in patches/scene-import/README.md, needs a few
// additive scene.json fields): voiceover audio track, b-roll visuals from
// `visual_query`, camera moves from `camera`/`entry_vector`, and
// per-transition effects. Kept out of v1 so every node it emits is
// schema-valid and renders predictably.

import { createId, toFrame } from "core";
import type { AssetRef, AudioTrack, ColorOKLCH, Composition, Frame, Node, Project } from "core";
import { CURRENT_SCHEMA_VERSION } from "schema";

// ── scene.json shape (only the fields this compiler reads) ──────────────────

interface SceneWordTime {
  text: string;
  start_s: number;
  end_s: number;
  tier?: number;
}
interface SceneVisual {
  asset_id?: string;
  fit?: "cover" | "contain" | "fill";
  opacity?: number;
}
interface SceneBeat {
  id?: string;
  hud_tag?: string;
  keyword?: string;
  body?: string;
  duration_ms?: number;
  accent_override?: string | null;
  layout?: string;
  word_times?: SceneWordTime[];
  emphasis_times?: SceneWordTime[];
  visual?: SceneVisual;                 // NEW (v2): b-roll behind the text
  audio?: { asset_id?: string };        // NEW (v2): this beat's voiceover asset
  transition?: string;                  // scene-motion: transition INTO this beat
  entry_vector?: { x: number; y: number; scale: number };  // camera exit carry (whip angle)
  camera?: string;                      // scene-motion: camera move (push_in/pull_out/tilt_up/…)
  background?: string;                  // scene-motion: bg treatment (glow/noise/…)
  pattern_interrupt?: string | null;    // scene-motion: punch effect (chroma/…)
  intensity?: number;                   // 0..1 master magnitude for moves/effects
}
interface SceneAsset {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
  hash?: string;
  poster?: string;
  width?: number;
  height?: number;
}
interface ScenePalette {
  accent?: string;
  spike?: string;
  bg?: string;
  fg?: string;
}
export interface SceneDoc {
  video_id?: string;
  theme?: string;
  fps?: number;
  width?: number;
  height?: number;
  palette?: ScenePalette;
  brand?: string;
  assets?: SceneAsset[];                 // NEW (v2): resolved media library
  beats?: SceneBeat[];
}

/** A beat's visual after its asset kind has been resolved against `assets[]`. */
interface ResolvedVisual {
  assetId: string;
  kind: "image" | "video";
  fit: "cover" | "contain" | "fill";
  opacity: number;
}

// ── Transitions (slice 2) ────────────────────────────────────────────────────

interface TransitionDef { preset: string; props: Record<string, unknown>; }

/** Whip-pan angle (radians) from the previous beat's camera exit vector. */
function whipAngle(v?: { x: number; y: number }): number {
  if (!v || (v.x === 0 && v.y === 0)) return 0;
  return Math.atan2(v.y, v.x);
}

/**
 * Map a scene `transition` name to a registered editor transition preset
 * (packages/effects/src/transitions). Returns null for `cut`/unknown → a hard
 * cut with no overlap. `bg` colours the dip; `entry` aims the whip.
 */
function mapTransition(name: string | undefined, bg: ColorOKLCH, entry?: { x: number; y: number }): TransitionDef | null {
  switch ((name ?? "").toLowerCase()) {
    case "slam_cut":
    case "slam":
      return { preset: "slam", props: { zoomStart: 1.4, flashIntensity: 0.8 } };
    case "dip_black":
    case "dip":
      return { preset: "dip", props: { color: bg } };
    case "flash":
      return { preset: "dip", props: { color: { l: 1, c: 0, h: 0 } } }; // dip to white
    case "whip_pan":
    case "whip":
      return { preset: "whip", props: { angle: whipAngle(entry), blurAmount: 0.06 } };
    case "blur_wipe":
    case "wipe":
      return { preset: "wipe-linear", props: { angle: 0, feather: 0.09 } };
    case "fade":
      return { preset: "cross-dissolve", props: {} };
    default:
      return null; // cut / unknown → hard cut
  }
}

// ── Camera moves + effects (slice 3) ─────────────────────────────────────────

/**
 * Camera move → group transform channels. Applied to the beat GROUP so the
 * whole beat (text + b-roll) moves together. Uses the same proven keyframed
 * `channels` mechanism as the word-sync/Ken Burns work — no effect uniforms.
 */
function cameraChannels(camera: string | undefined, start: number, dur: number, W: number, H: number, k: number): any[] {
  const end = start + dur;
  const scaleCh = (v0: number, v1: number, fast = false) => ({
    id: createId(),
    path: "transform.scale",
    type: "vec2" as const,
    keys: fast
      ? [
          { frame: toFrame(start), value: { x: v0, y: v0 }, interp: "linear" as const },
          { frame: toFrame(start + Math.min(6, Math.floor(dur * 0.3))), value: { x: v1, y: v1 }, interp: "linear" as const },
        ]
      : [
          { frame: toFrame(start), value: { x: v0, y: v0 }, interp: "linear" as const },
          { frame: toFrame(end), value: { x: v1, y: v1 }, interp: "linear" as const },
        ],
  });
  const posY = (y0: number, y1: number) => ({
    id: createId(),
    path: "transform.position",
    type: "vec3" as const,
    keys: [
      { frame: toFrame(start), value: { x: 0, y: y0, z: 0 }, interp: "linear" as const },
      { frame: toFrame(end), value: { x: 0, y: y1, z: 0 }, interp: "linear" as const },
    ],
  });
  switch ((camera ?? "").toLowerCase()) {
    case "push_in":
      return [scaleCh(1.0, 1.0 + 0.05 * k)];
    case "pull_out":
      return [scaleCh(1.0 + 0.06 * k, 1.0)];
    case "snap_zoom":
      return [scaleCh(1.0 + 0.12 * k, 1.0, true)];
    case "tilt_up":
      return [posY(Math.round(H * 0.03 * k), 0)];
    case "handheld":
    case "micro_shake": {
      const amp = Math.max(2, Math.round(W * 0.006 * k));
      const fr = [0, 0.14, 0.29, 0.43, 0.57, 0.71, 0.86, 1];
      const pat = [[0, 0], [1, -1], [-1, 1], [1, 1], [-1, -1], [1, 0], [0, 1], [0, 0]];
      return [
        {
          id: createId(),
          path: "transform.position",
          type: "vec3" as const,
          keys: fr.map((f, i) => ({
            frame: toFrame(start + Math.round(dur * f)),
            value: { x: pat[i][0] * amp, y: pat[i][1] * amp, z: 0 },
            interp: "linear" as const,
          })),
        },
      ];
    }
    default:
      return [];
  }
}

/** Background treatment → a static effect on the b-roll media node (plain uniforms, no time animation needed). */
function bgEffect(bg: string | undefined): any | null {
  switch ((bg ?? "").toLowerCase()) {
    case "glow":
      return { id: createId(), effect: "glow", enabled: true, props: { threshold: 0.55, intensity: 0.35, radius: 5 } };
    case "noise":
      return { id: createId(), effect: "film-grain", enabled: true, props: { amount: 0.08, seed: 7 } };
    default:
      return null;
  }
}

/** Background types that get a synthesized full-bleed pattern (when the beat has no photo b-roll). */
function wantsBgImage(bg: string | undefined): boolean {
  return ["grid", "lines", "gradient", "abstract"].includes((bg ?? "").toLowerCase());
}

/** Generate a comp-sized SVG background (grid/lines/gradient) as a data: URL, tinted from the palette. */
function bgSvgDataUrl(type: string, W: number, H: number, accent: string, bg: string): string {
  const base = `<rect width="${W}" height="${H}" fill="${bg}"/>`;
  let inner = "";
  const t = type.toLowerCase();
  if (t === "grid") {
    inner = `<defs><pattern id="p" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="${accent}" stroke-opacity="0.12" stroke-width="2"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#p)"/>`;
  } else if (t === "lines") {
    inner = `<defs><pattern id="p" width="46" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="23" height="46" fill="${accent}" fill-opacity="0.06"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#p)"/>`;
  } else {
    // gradient / abstract: soft accent wash from a corner
    inner = `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.28"/><stop offset="1" stop-color="${bg}" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${base}${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Pattern-interrupt → a BRIEF effect burst on the beat group: the effect's main
 * uniform ramps 0→peak→0 over ~0.3s at beat start (a punch, not a constant
 * treatment). Uses the `fx.<ref.id>.<prop>` channel convention the evaluator's
 * sampleEffectProps reads. Peak magnitude scales with `k` (intensity).
 */
function patternBurst(pi: string | null | undefined, start: number, dur: number, fps: number, k: number): any | null {
  const name = (pi ?? "").toLowerCase();
  if (!name) return null;
  const burstF = Math.max(3, Math.min(Math.round(fps * 0.3), Math.floor(dur * 0.4)));
  const peakF = Math.max(1, Math.round(burstF * 0.35));
  const id = createId();
  const ramp = (prop: string, peak: number) => ({
    id: createId(),
    path: `fx.${id}.${prop}`,
    type: "scalar" as const,
    keys: [
      { frame: toFrame(start), value: 0, interp: "linear" as const },
      { frame: toFrame(start + peakF), value: peak, interp: "linear" as const },
      { frame: toFrame(start + burstF), value: 0, interp: "linear" as const },
    ],
  });
  switch (name) {
    case "chroma":
      return { id, effect: "chromatic-aberration", enabled: true, props: { amount: 0 }, channels: [ramp("amount", 4 + 8 * k)] };
    case "glitch":
    case "invert":
      return {
        id,
        effect: "glitch",
        enabled: true,
        props: { intensity: 0, speed: 3, time: 0 },
        channels: [
          ramp("intensity", 8 + 14 * k),
          {
            id: createId(),
            path: `fx.${id}.time`,
            type: "scalar" as const,
            keys: [
              { frame: toFrame(start), value: 0, interp: "linear" as const },
              { frame: toFrame(start + burstF), value: 20, interp: "linear" as const },
            ],
          },
        ],
      };
    case "flash":
      return { id, effect: "glow", enabled: true, props: { threshold: 0.4, intensity: 0, radius: 6 }, channels: [ramp("intensity", 1.0 + 0.8 * k)] };
    default:
      return null;
  }
}

export class SceneFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneFileError";
  }
}

// ── Color: hex → OKLCH (the renderer's color space) ─────────────────────────

const WHITE: ColorOKLCH = { l: 1, c: 0, h: 0 };

/** Convert `#rrggbb` (or `#rgb`) to ColorOKLCH { l, c, h } used throughout core/renderer. */
export function hexToOklch(hex: string, fallback: ColorOKLCH = WHITE): ColorOKLCH {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const R = lin(r), G = lin(g), B = lin(b);
  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
  const m2 = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m2), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const Bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(A * A + Bb * Bb);
  let H = (Math.atan2(Bb, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { l: L, c: C, h: H };
}

// ── Text helpers ────────────────────────────────────────────────────────────

/**
 * Real glyph-advance width via an offscreen canvas — matches what the Pixi
 * text renderer actually draws (same font + weight), so a word placed at
 * `x + measuredWidth` never overlaps the next one. Falls back to a rough
 * per-char estimate only when no canvas is available (SSR/tests). Inter is
 * loaded by the editor's theme.css by import time.
 */
let _measureCtx: CanvasRenderingContext2D | null | undefined;
function measureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx !== undefined) return _measureCtx;
  try {
    _measureCtx = document.createElement("canvas").getContext("2d");
  } catch {
    _measureCtx = null;
  }
  return _measureCtx;
}
function measureText(text: string, fontSize: number, weight: number): number {
  const ctx = measureCtx();
  if (!ctx) return text.length * fontSize * (weight >= 600 ? 0.56 : 0.52);
  ctx.font = `${weight} ${fontSize}px Inter, system-ui, sans-serif`;
  return ctx.measureText(text).width;
}
/** Width of a single space in the given font (measured, not guessed). */
function spaceWidth(fontSize: number, weight: number): number {
  return Math.max(fontSize * 0.22, measureText("a a", fontSize, weight) - measureText("aa", fontSize, weight));
}

/** Normalize a token for matching body words against word_times (lowercase, strip non-alphanumerics). */
function normWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']/gi, "");
}

interface DisplayWord {
  text: string;
  emphasis: boolean;
}

/** Parse a beat body into display words, marking `*emphasis*` runs and normalizing smart quotes. */
function parseBody(body: string): DisplayWord[] {
  const clean = body.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const tokens = clean.split(/\s+/).filter(Boolean);
  const out: DisplayWord[] = [];
  for (const tok of tokens) {
    const emphasis = /^\*.*\*$/.test(tok) || tok.startsWith("*") || tok.endsWith("*");
    out.push({ text: tok.replace(/\*/g, ""), emphasis });
  }
  return out;
}

// ── Node factories ──────────────────────────────────────────────────────────

function textNode(opts: {
  name: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  weight: number;
  align: "left" | "center" | "right";
  fill: ColorOKLCH;
  start: number;
  duration: number;
  tracking?: number;
  fillChannel?: { keys: { frame: number; value: ColorOKLCH }[] };
  /** Per-word opacity reveal (word-sync). scalar keys. */
  opacityKeys?: { frame: number; value: number }[];
  /** Emphasis scale pop. vec2 keys. */
  scaleKeys?: { frame: number; value: { x: number; y: number } }[];
  /** Entrance/exit position move. vec3 keys. */
  posKeys?: { frame: number; value: { x: number; y: number; z: number } }[];
}): Node {
  const channels: any[] = [];
  if (opts.fillChannel) {
    channels.push({
      id: createId(),
      path: "props.fill",
      type: "color" as const,
      keys: opts.fillChannel.keys.map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: "linear" as const })),
    });
  }
  if (opts.opacityKeys) {
    channels.push({
      id: createId(),
      path: "opacity",
      type: "scalar" as const,
      keys: opts.opacityKeys.map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: "linear" as const })),
    });
  }
  if (opts.scaleKeys) {
    channels.push({
      id: createId(),
      path: "transform.scale",
      type: "vec2" as const,
      keys: opts.scaleKeys.map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: "linear" as const })),
    });
  }
  if (opts.posKeys) {
    channels.push({
      id: createId(),
      path: "transform.position",
      type: "vec3" as const,
      keys: opts.posKeys.map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: "linear" as const })),
    });
  }
  return {
    id: createId(),
    kind: "text",
    name: opts.name,
    transform: { position: { x: opts.x, y: opts.y, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
    opacity: 1,
    blend: "normal",
    time: { start: toFrame(opts.start), duration: toFrame(opts.duration) },
    origin: "user",
    props: {
      text: opts.text,
      fontFamily: "Inter",
      fontSize: opts.fontSize,
      weight: opts.weight,
      align: opts.align,
      fill: opts.fill,
      tracking: opts.tracking ?? 0,
      lineHeight: 1.15,
    },
    channels,
  } as Node;
}

/**
 * Full-bleed b-roll node (image or video) placed behind a beat's text.
 * Asset dimensions are intentionally omitted upstream so the renderer's
 * `imageBox` returns the whole comp frame; with `fit: "cover"` the media
 * fills the vertical frame (letterbox-free) — the right default for TikTok-
 * style backgrounds.
 */
function mediaNode(opts: {
  assetId: string;
  kind: "image" | "video";
  fit: "cover" | "contain" | "fill";
  opacity: number;
  start: number;
  duration: number;
  /** Ken Burns / motion channels (scale vec2, position vec3). */
  channels?: any[];
  /** Static effects (background treatment). */
  effects?: any[];
}): Node {
  const props = opts.kind === "video" ? { fit: opts.fit, volume: 0 } : { fit: opts.fit };
  return {
    id: createId(),
    kind: opts.kind,
    name: opts.kind === "video" ? "B-roll (video)" : "B-roll (image)",
    transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
    opacity: opts.opacity,
    blend: "normal",
    time: { start: toFrame(opts.start), duration: toFrame(opts.duration) },
    origin: "user",
    props,
    channels: opts.channels ?? [],
    ...(opts.effects && opts.effects.length ? { effects: opts.effects } : {}),
    source: { assetId: opts.assetId },
  } as unknown as Node;
}

// ── Beat → layer group ──────────────────────────────────────────────────────

function buildBeatGroup(
  beat: SceneBeat,
  beatIndex: number,
  startFrame: number,
  durationFrames: number,
  fps: number,
  size: { width: number; height: number },
  palette: { accent: ColorOKLCH; spike: ColorOKLCH; fg: ColorOKLCH },
  brand: string,
  visual: ResolvedVisual | undefined,
  bgAssetId: string | undefined,
  lingerFrames: number,
  transitionIn: { preset: string; durationF: Frame; props: Record<string, unknown> } | undefined
): Node {
  // Extend the visual tail so this beat's timespan OVERLAPS the next one — the
  // evaluator only renders a transition across an actual overlap window. Audio
  // stays sequential (tracks aren't extended) and word-sync keyframes use
  // absolute frames, so nothing desyncs.
  durationFrames = durationFrames + lingerFrames;
  const W = size.width;
  const intensity = typeof beat.intensity === "number" ? Math.max(0, Math.min(1, beat.intensity)) : 0.65;
  const k = 0.6 + 0.8 * intensity; // master magnitude knob for moves + effect bursts
  const margin = Math.round(W * 0.08);
  const colWidth = W - margin * 2;
  const children: Node[] = [];

  // Synthesized full-bleed background (grid/lines/gradient) when there's no photo.
  if (!visual && bgAssetId) {
    children.push(
      mediaNode({ assetId: bgAssetId, kind: "image", fit: "cover", opacity: 1, start: startFrame, duration: durationFrames })
    );
  }

  // B-roll visual behind the text (z-order 0 = bottom of the group).
  if (visual) {
    // Ken Burns: slow zoom + drift, direction alternating per beat for variety.
    const even = beatIndex % 2 === 0;
    const z = 0.1 * k; // zoom travel, intensity-scaled
    const s0 = even ? 1.06 : 1.06 + z;
    const s1 = even ? 1.06 + z : 1.06;
    const dx = (even ? 1 : -1) * Math.round(W * 0.02);
    const dy = (even ? 1 : -1) * Math.round(size.height * 0.012);
    const end = startFrame + durationFrames;
    const kenBurns = [
      {
        id: createId(),
        path: "transform.scale",
        type: "vec2" as const,
        keys: [
          { frame: toFrame(startFrame), value: { x: s0, y: s0 }, interp: "linear" as const },
          { frame: toFrame(end), value: { x: s1, y: s1 }, interp: "linear" as const },
        ],
      },
      {
        id: createId(),
        path: "transform.position",
        type: "vec3" as const,
        keys: [
          { frame: toFrame(startFrame), value: { x: 0, y: 0, z: 0 }, interp: "linear" as const },
          { frame: toFrame(end), value: { x: dx, y: dy, z: 0 }, interp: "linear" as const },
        ],
      },
    ];
    children.push(
      mediaNode({
        assetId: visual.assetId,
        kind: visual.kind,
        fit: visual.fit,
        opacity: visual.opacity,
        start: startFrame,
        duration: durationFrames,
        channels: kenBurns,
        effects: bgEffect(beat.background) ? [bgEffect(beat.background)] : undefined,
      })
    );
  }

  const align: "left" | "center" | "right" =
    beat.layout === "center" || beat.layout === "full" ? "center" : beat.layout === "right" ? "right" : "left";
  const alignX = (lineWidth: number): number =>
    align === "center" ? (W - lineWidth) / 2 : align === "right" ? W - margin - lineWidth : margin;

  // HUD tag (top)
  if (beat.hud_tag) {
    const fs = Math.round(W * 0.032);
    const w = measureText(beat.hud_tag, fs, 700);
    const hx = alignX(w);
    const hy = Math.round(size.height * 0.12);
    const entF = Math.min(8, Math.max(3, Math.round(durationFrames * 0.1)));
    const rise = Math.round(size.height * 0.02);
    children.push(
      textNode({
        name: `${beat.id ?? "beat"} · hud`,
        text: beat.hud_tag,
        x: hx,
        y: hy,
        fontSize: fs,
        weight: 700,
        align,
        fill: palette.accent,
        start: startFrame,
        duration: durationFrames,
        tracking: 2,
        posKeys: [
          { frame: startFrame, value: { x: hx, y: hy + rise, z: 0 } },
          { frame: startFrame + entF, value: { x: hx, y: hy, z: 0 } },
        ],
      })
    );
  }

  // Keyword (large display)
  if (beat.keyword) {
    let fs = Math.round(W * 0.092);
    const keywordFill = beat.accent_override === "spike" ? palette.spike : palette.fg;
    // Shrink to fit the column width if the keyword would overflow.
    let w = measureText(beat.keyword, fs, 800);
    if (w > colWidth) {
      fs = Math.max(Math.round(W * 0.04), Math.floor((fs * colWidth) / w));
      w = measureText(beat.keyword, fs, 800);
    }
    const kx = alignX(Math.min(w, colWidth));
    const ky = Math.round(size.height * 0.2);
    const entF = Math.min(10, Math.max(4, Math.round(durationFrames * 0.12)));
    const rise = Math.round(size.height * 0.03);
    children.push(
      textNode({
        name: `${beat.id ?? "beat"} · keyword`,
        text: beat.keyword,
        x: kx,
        y: ky,
        fontSize: fs,
        weight: 800,
        align,
        fill: keywordFill,
        start: startFrame,
        duration: durationFrames,
        posKeys: [
          { frame: startFrame, value: { x: kx, y: ky + rise, z: 0 } },
          { frame: startFrame + entF, value: { x: kx, y: ky, z: 0 } },
        ],
        scaleKeys: [
          { frame: startFrame, value: { x: 0.94, y: 0.94 } },
          { frame: startFrame + entF, value: { x: 1, y: 1 } },
        ],
      })
    );
  }

  // Body — one node per word, wrapped + aligned + spoken-word highlight.
  if (beat.body) {
    const words = parseBody(beat.body);
    const fs = Math.round(W * 0.05);
    const space = spaceWidth(fs, 600);
    const lineH = fs * 1.35;
    const bodyTop = Math.round(size.height * 0.6);

    // Match display words to word_times (advance a pointer, skipping spillover).
    const wt = beat.word_times ?? [];
    let wtPtr = 0;
    const emphasisSet = new Set((beat.emphasis_times ?? []).map((e) => normWord(e.text)));

    // Wrap into lines of {word, width, emphasis, timing}.
    interface WordBox { text: string; width: number; emphasis: boolean; startAbs?: number; endAbs?: number; }
    const lines: WordBox[][] = [];
    let line: WordBox[] = [];
    let lineWidth = 0;
    for (const dw of words) {
      const wWidth = measureText(dw.text, fs, dw.emphasis ? 700 : 600);
      if (line.length > 0 && lineWidth + space + wWidth > colWidth) {
        lines.push(line);
        line = [];
        lineWidth = 0;
      }
      // find timing
      const norm = normWord(dw.text);
      let startAbs: number | undefined;
      let endAbs: number | undefined;
      for (let p = wtPtr; p < wt.length; p++) {
        if (normWord(wt[p].text) === norm) {
          startAbs = startFrame + Math.round(wt[p].start_s * fps);
          endAbs = startFrame + Math.round(wt[p].end_s * fps);
          wtPtr = p + 1;
          break;
        }
      }
      const emphasis = dw.emphasis || emphasisSet.has(norm);
      line.push({ text: dw.text, width: wWidth, emphasis, startAbs, endAbs });
      lineWidth += (line.length > 1 ? space : 0) + wWidth;
    }
    if (line.length > 0) lines.push(line);

    lines.forEach((ln, li) => {
      const totalW = ln.reduce((sum, w, i) => sum + w.width + (i > 0 ? space : 0), 0);
      let x = alignX(totalW);
      const y = bodyTop + li * lineH;
      for (const w of ln) {
        const baseFill = w.emphasis ? palette.spike : palette.fg;
        // Spoken-word colour highlight: fg → spike flash → fg, timed to the word.
        const fillChannel =
          !w.emphasis && w.startAbs !== undefined && w.endAbs !== undefined
            ? {
                keys: [
                  { frame: w.startAbs, value: palette.fg },
                  { frame: w.startAbs + 2, value: palette.spike },
                  { frame: Math.max(w.startAbs + 3, w.endAbs), value: palette.fg },
                ],
              }
            : undefined;
        // Word-sync reveal: dim until spoken, then full (past words stay readable).
        const opacityKeys =
          w.startAbs !== undefined
            ? [
                { frame: startFrame, value: 0.45 },
                { frame: Math.max(startFrame, w.startAbs - 1), value: 0.45 },
                { frame: w.startAbs + 2, value: 1 },
              ]
            : undefined;
        // Emphasis words get a scale pop as they land.
        const scaleKeys =
          w.emphasis && w.startAbs !== undefined
            ? [
                { frame: w.startAbs, value: { x: 1, y: 1 } },
                { frame: w.startAbs + 2, value: { x: 1.08, y: 1.08 } },
                { frame: w.startAbs + 9, value: { x: 1, y: 1 } },
              ]
            : undefined;
        children.push(
          textNode({
            name: `${beat.id ?? "beat"} · ${w.text}`,
            text: w.text,
            x,
            y,
            fontSize: fs,
            weight: w.emphasis ? 700 : 600,
            align: "left",
            fill: baseFill,
            start: startFrame,
            duration: durationFrames,
            fillChannel,
            opacityKeys,
            scaleKeys,
          })
        );
        x += w.width + space;
      }
    });
  }

  // Brand (bottom)
  if (brand) {
    const fs = Math.round(W * 0.028);
    children.push(
      textNode({
        name: `${beat.id ?? "beat"} · brand`,
        text: brand,
        x: margin,
        y: Math.round(size.height * 0.94),
        fontSize: fs,
        weight: 600,
        align: "left",
        fill: palette.accent,
        start: startFrame,
        duration: durationFrames,
        tracking: 3,
      })
    );
  }

  // Group fade-IN only, and ONLY when no real transition handles the entrance
  // (a transitionIn already brings the beat on — a fade-in on top double-dips).
  const fadeF = Math.min(6, Math.max(2, Math.round(durationFrames * 0.08)));
  const groupChannels: any[] = [];
  // Fade-in on every beat EXCEPT the first: beat 0 must be fully opaque at
  // frame 0, otherwise the paused reset-frame after an import/generate is
  // transparent and the renderer leaves the PREVIOUS project's pixels on
  // screen (stale canvas). A transitionIn already handles the entrance, so
  // skip the plain fade there too.
  if (!transitionIn && beatIndex > 0) {
    groupChannels.push({
      id: createId(),
      path: "opacity",
      type: "scalar" as const,
      keys: [
        { frame: toFrame(startFrame), value: 0, interp: "linear" as const },
        { frame: toFrame(startFrame + fadeF), value: 1, interp: "linear" as const },
      ],
    });
  }
  // Camera move on the whole beat (text + b-roll move together).
  groupChannels.push(...cameraChannels(beat.camera, startFrame, durationFrames, W, size.height, k));

  // Pattern-interrupt effect burst on the beat group.
  const groupEffects: any[] = [];
  const pe = patternBurst(beat.pattern_interrupt, startFrame, durationFrames, fps, k);
  if (pe) groupEffects.push(pe);

  return {
    id: createId(),
    kind: "group",
    name: `Beat ${beatIndex + 1}${beat.keyword ? ` · ${beat.keyword}` : ""}`,
    transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
    opacity: 1,
    blend: "normal",
    time: { start: toFrame(startFrame), duration: toFrame(durationFrames) },
    origin: "user",
    props: {},
    channels: groupChannels,
    children,
    ...(groupEffects.length ? { effects: groupEffects } : {}),
    ...(transitionIn ? { transitionIn } : {}),
  } as Node;
}

// ── Compile ─────────────────────────────────────────────────────────────────

/** Compiles a validated `SceneDoc` into an editable `Project`. */
export function compileSceneToProject(scene: SceneDoc): Project {
  const fps = scene.fps && scene.fps > 0 ? scene.fps : 30;
  const size = { width: scene.width ?? 1080, height: scene.height ?? 1920 };
  const pal = scene.palette ?? {};
  const palette = {
    accent: hexToOklch(pal.accent ?? "#d8d0c0"),
    spike: hexToOklch(pal.spike ?? "#e8a020"),
    fg: hexToOklch(pal.fg ?? "#f4f2ef"),
  };
  const background = hexToOklch(pal.bg ?? "#080808");
  const brand = scene.brand ?? "";
  const beats = scene.beats ?? [];

  // Resolved media library (dedup by id) + a kind lookup for beat visuals/audio.
  const sceneAssets = scene.assets ?? [];
  const assetKind = new Map<string, SceneAsset["kind"]>();
  const projectAssets: AssetRef[] = [];
  const seenAsset = new Set<string>();
  for (const a of sceneAssets) {
    if (!a.id || !a.url || seenAsset.has(a.id)) continue;
    seenAsset.add(a.id);
    assetKind.set(a.id, a.kind);
    projectAssets.push({
      id: a.id,
      hash: a.hash ?? a.id,
      kind: a.kind,
      master: a.url,
      proxy: a.url,
      poster: a.poster,
      // width/height intentionally omitted so image/video boxes fill the frame
      // (full-bleed b-roll); include them upstream only if you want true aspect.
      ...(a.width && a.height ? { width: a.width, height: a.height } : {}),
      provenance: "stock",
    } as unknown as AssetRef);
  }

  const root: Node[] = [];
  const audioTracks: AudioTrack[] = [];

  // Synthesized backgrounds (grid/lines/gradient) — one asset per type, reused
  // across beats. Only used on beats without a resolved photo b-roll.
  const palHex = (scene.palette ?? {}) as { accent?: string; bg?: string };
  const accentHex = palHex.accent ?? "#4ab0f5";
  const bgHex = palHex.bg ?? "#09090b";
  const bgAssetIds = new Map<string, string>();
  const ensureBgAsset = (type: string): string => {
    const key = type.toLowerCase();
    const existing = bgAssetIds.get(key);
    if (existing) return existing;
    const id = `bg_${key}`;
    projectAssets.push({
      id,
      hash: id,
      kind: "image",
      master: bgSvgDataUrl(key, size.width, size.height, accentHex, bgHex),
      provenance: "generated",
    } as unknown as AssetRef);
    bgAssetIds.set(key, id);
    return id;
  };

  // Pre-pass: per-beat frame durations, the transition INTO each beat, and the
  // overlap window each boundary needs (transition length, clamped to half of
  // the shorter neighbouring beat so it never swallows a whole beat).
  const durs = beats.map((b) => Math.max(1, Math.round(((b.duration_ms ?? 4000) / 1000) * fps)));
  const transDefs = beats.map((b, i) => (i === 0 ? null : mapTransition(b.transition, background, beats[i - 1].entry_vector)));
  const overlaps = beats.map((b, i) => {
    if (i === 0 || !transDefs[i]) return 0;
    return Math.max(2, Math.min(Math.round(fps * 0.4), Math.floor(durs[i] * 0.5), Math.floor(durs[i - 1] * 0.5)));
  });

  let cursor = 0;
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const durFrames = durs[i];

    // Resolve this beat's visual against the asset library.
    let visual: ResolvedVisual | undefined;
    const vid = beat.visual?.asset_id;
    const vkind = vid ? assetKind.get(vid) : undefined;
    if (vid && (vkind === "image" || vkind === "video")) {
      visual = {
        assetId: vid,
        kind: vkind,
        fit: beat.visual?.fit ?? "cover",
        opacity: beat.visual?.opacity ?? 1,
      };
    }

    const bgAssetId = !visual && wantsBgImage(beat.background) ? ensureBgAsset(beat.background as string) : undefined;

    // Linger into the next beat by that boundary's overlap; transition in from
    // the previous beat using this beat's own transition.
    const linger = i < beats.length - 1 ? overlaps[i + 1] : 0;
    const def = transDefs[i];
    const transitionIn =
      def && overlaps[i] > 0
        ? { preset: def.preset, durationF: toFrame(overlaps[i]) as Frame, props: def.props }
        : undefined;

    root.push(buildBeatGroup(beat, i, cursor, durFrames, fps, size, palette, brand, visual, bgAssetId, linger, transitionIn));

    // One voiceover AudioTrack per beat, placed at the beat's start (sequential;
    // NOT extended by linger, so voiceovers never overlap).
    const aid = beat.audio?.asset_id;
    if (aid && assetKind.get(aid) === "audio") {
      audioTracks.push({
        id: createId(),
        assetId: aid,
        name: `VO ${i + 1}`,
        startFrame: cursor,
        endFrame: cursor + durFrames,
        trimIn: 0,
        trimOut: undefined,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        loop: false,
        muted: false,
        solo: false,
        lane: 0,
      });
    }

    cursor += durFrames;
  }
  const totalFrames = Math.max(1, cursor);

  const comp: Composition = {
    id: createId(),
    name: "Main",
    size,
    fps,
    duration: toFrame(totalFrames) as Frame,
    background,
    root,
    audioTracks,
  };

  return {
    id: createId(),
    schema: CURRENT_SCHEMA_VERSION,
    name: scene.video_id ? `Scene ${scene.video_id}` : "Imported Scene",
    comps: { [comp.id]: comp },
    rootCompId: comp.id,
    assets: projectAssets,
    opLog: [],
  };
}

// ── File parse / pick ───────────────────────────────────────────────────────

/** Parses scene JSON text and compiles it. Throws `SceneFileError` on bad input. */
export function parseSceneJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SceneFileError("This file isn't valid JSON — expected a scene.json.");
  }
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as SceneDoc).beats)) {
    throw new SceneFileError("This doesn't look like a scene.json (no `beats` array).");
  }
  try {
    return compileSceneToProject(raw as SceneDoc);
  } catch (err) {
    throw new SceneFileError(`Could not compile scene: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function readSceneFile(file: File): Promise<Project> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new SceneFileError("Could not read the file.");
  }
  return parseSceneJson(text);
}

/** Opens the OS picker for a scene JSON file, resolving with the chosen `File` or `null`. */
export function pickSceneFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    document.body.appendChild(input);
    input.addEventListener("change", () => input.remove(), { once: true });
    input.click();
  });
}

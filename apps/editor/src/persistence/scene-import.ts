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
import type { ColorOKLCH, Composition, Frame, Node, Project } from "core";
import { CURRENT_SCHEMA_VERSION } from "schema";

// ── scene.json shape (only the fields this compiler reads) ──────────────────

interface SceneWordTime {
  text: string;
  start_s: number;
  end_s: number;
  tier?: number;
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
  beats?: SceneBeat[];
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

/** Rough advance width of `text` at `fontSize` — used only for wrap/centering; the renderer re-measures for display. */
function approxWidth(text: string, fontSize: number, weight: number): number {
  const per = fontSize * (weight >= 600 ? 0.56 : 0.52);
  return text.length * per;
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
}): Node {
  const channels = opts.fillChannel
    ? [
        {
          id: createId(),
          path: "props.fill",
          type: "color" as const,
          keys: opts.fillChannel.keys.map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: "linear" as const })),
        },
      ]
    : [];
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

// ── Beat → layer group ──────────────────────────────────────────────────────

function buildBeatGroup(
  beat: SceneBeat,
  beatIndex: number,
  startFrame: number,
  durationFrames: number,
  fps: number,
  size: { width: number; height: number },
  palette: { accent: ColorOKLCH; spike: ColorOKLCH; fg: ColorOKLCH },
  brand: string
): Node {
  const W = size.width;
  const margin = Math.round(W * 0.08);
  const colWidth = W - margin * 2;
  const children: Node[] = [];

  const align: "left" | "center" | "right" =
    beat.layout === "center" || beat.layout === "full" ? "center" : beat.layout === "right" ? "right" : "left";
  const alignX = (lineWidth: number): number =>
    align === "center" ? (W - lineWidth) / 2 : align === "right" ? W - margin - lineWidth : margin;

  // HUD tag (top)
  if (beat.hud_tag) {
    const fs = Math.round(W * 0.032);
    const w = approxWidth(beat.hud_tag, fs, 700);
    children.push(
      textNode({
        name: `${beat.id ?? "beat"} · hud`,
        text: beat.hud_tag,
        x: alignX(w),
        y: Math.round(size.height * 0.12),
        fontSize: fs,
        weight: 700,
        align,
        fill: palette.accent,
        start: startFrame,
        duration: durationFrames,
        tracking: 2,
      })
    );
  }

  // Keyword (large display)
  if (beat.keyword) {
    const fs = Math.round(W * 0.092);
    const keywordFill = beat.accent_override === "spike" ? palette.spike : palette.fg;
    const w = approxWidth(beat.keyword, fs, 800);
    children.push(
      textNode({
        name: `${beat.id ?? "beat"} · keyword`,
        text: beat.keyword,
        x: alignX(Math.min(w, colWidth)),
        y: Math.round(size.height * 0.2),
        fontSize: fs,
        weight: 800,
        align,
        fill: keywordFill,
        start: startFrame,
        duration: durationFrames,
      })
    );
  }

  // Body — one node per word, wrapped + aligned + spoken-word highlight.
  if (beat.body) {
    const words = parseBody(beat.body);
    const fs = Math.round(W * 0.05);
    const space = fs * 0.28;
    const lineH = fs * 1.2;
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
      const wWidth = approxWidth(dw.text, fs, dw.emphasis ? 700 : 600);
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
        // Spoken-word highlight: fg → spike flash → fg, timed to the word.
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
    channels: [],
    children,
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

  const root: Node[] = [];
  let cursor = 0;
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const durFrames = Math.max(1, Math.round(((beat.duration_ms ?? 4000) / 1000) * fps));
    root.push(buildBeatGroup(beat, i, cursor, durFrames, fps, size, palette, brand));
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
    audioTracks: [],
  };

  return {
    id: createId(),
    schema: CURRENT_SCHEMA_VERSION,
    name: scene.video_id ? `Scene ${scene.video_id}` : "Imported Scene",
    comps: { [comp.id]: comp },
    rootCompId: comp.id,
    assets: [],
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

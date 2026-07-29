// apps/editor/src/persistence/text/services/nodes.ts
//
// P0 · The text NODE factories, lifted verbatim from scene-import.ts. These
// are the only place `kind: "text"` / `kind: "shape"` nodes are constructed
// for the text region, so a representation never hand-builds a node — it
// combines these with reveal builders and tier sizes.
//
// (Composition node builders — mediaNode / scrimNode / dividerNode /
// slotRect / splitAxis — stay in scene-import.ts; representations own text,
// not the frame.)

import { createId, toFrame } from "core";
import type { ColorOKLCH, Node } from "core";
import { eased, EASE_OUT, fadeRise, fadeIn } from "./reveal";
import { measureText, spaceWidth, normWord } from "./measure";
import { fitTextToBox, LINE_H_BODY, LINE_H_DISPLAY, _FONT_SCALE_SHRINK_STEP, type FitBox, type FitResult } from "./layout";
import { rolePx, floorPxFor } from "./type-scale";

export interface TextNodeOpts {
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
  opacityKeys?: { frame: number; value: number }[];
  scaleKeys?: { frame: number; value: { x: number; y: number } }[];
  posKeys?: { frame: number; value: { x: number; y: number; z: number } }[];
}

export function textNode(opts: TextNodeOpts): Node {
  const channels: any[] = [];
  if (opts.fillChannel) {
    channels.push({
      id: createId(),
      path: "props.fill",
      type: "color" as const,
      keys: eased(opts.fillChannel.keys).map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: k.interp })),
    });
  }
  if (opts.opacityKeys) {
    channels.push({
      id: createId(),
      path: "opacity",
      type: "scalar" as const,
      keys: eased(opts.opacityKeys).map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: k.interp })),
    });
  }
  if (opts.scaleKeys) {
    channels.push({
      id: createId(),
      path: "transform.scale",
      type: "vec2" as const,
      keys: eased(opts.scaleKeys).map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: k.interp })),
    });
  }
  if (opts.posKeys) {
    channels.push({
      id: createId(),
      path: "transform.position",
      type: "vec3" as const,
      keys: eased(opts.posKeys).map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: k.interp })),
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

/** A filled rectangle (bubble background, definition rule, banner fill). Used
 * by P3 representations that need a shape behind their text. Fades in with
 * the same ease as the scrim. */
export function rectNode(opts: {
  name: string;
  x: number; y: number; w: number; h: number;
  radius?: number;
  fill: ColorOKLCH;
  opacity: number;
  start: number;
  duration: number;
  fadeF?: number;
}): Node {
  const fadeF = opts.fadeF ?? 6;
  return {
    id: createId(),
    kind: "shape",
    name: opts.name,
    transform: { position: { x: opts.x, y: opts.y, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
    opacity: 0,
    blend: "normal",
    time: { start: toFrame(opts.start), duration: toFrame(opts.duration) },
    origin: "user",
    props: { shape: "rect", width: opts.w, height: opts.h, radius: opts.radius ?? 0, fill: opts.fill },
    channels: [{
      id: createId(), path: "opacity", type: "scalar" as const,
      keys: eased([{ frame: opts.start, value: 0 }, { frame: opts.start + fadeF, value: opts.opacity }])
        .map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: k.interp })),
    }],
  } as unknown as Node;
}

/** Lay out already-fitted lines centered horizontally at a given `top`.
 * (Verbatim `emitCenteredBlock` — used by stat-figure's stacked pair.) */
export function emitCenteredBlock(fit: FitResult, top: number, box: FitBox, start: number, dur: number, fill: ColorOKLCH, weight: number, name: string): Node[] {
  const entF = Math.min(10, Math.max(4, Math.round(dur * 0.15)));
  const rise = Math.round(box.h * 0.02);
  return fit.lines.map((ln, li) => {
    const x = Math.round(box.x + (box.w - ln.width) / 2);
    const y = top + li * fit.lineH;
    return textNode({
      name: `${name} ${li + 1}`, text: ln.text,
      x, y, fontSize: fit.fs, weight, align: "left", fill,
      start, duration: dur,
      posKeys: [{ frame: start, value: { x, y: y + rise, z: 0 } }, { frame: start + entF, value: { x, y, z: 0 } }],
      opacityKeys: [{ frame: start, value: 0 }, { frame: start + entF, value: 1 }],
    });
  });
}

/** A centered, wrapped block fitted into `box`, each line rising+fading in.
 * (Verbatim `layerTextNodes`.) Used by hero-title / pull-quote. */
export function centeredTextNodes(text: string, start: number, dur: number, box: FitBox, fill: ColorOKLCH, startPx: number, floor: number, weight = 700, beatId = ""): Node[] {
  const fit = fitTextToBox(text, box.w, box.h, weight, startPx, floor, LINE_H_BODY);
  if (!fit.fits && beatId) console.warn(`[text] overflow on ${beatId}: "${text.slice(0, 32)}…" (floor ${fit.fs}px)`);
  const top = box.y + Math.max(0, Math.round((box.h - fit.totalH) / 2));
  const entF = Math.min(10, Math.max(4, Math.round(dur * 0.15)));
  const rise = Math.round(box.h * 0.03);
  return fit.lines.map((ln, li) => {
    const x = Math.round(box.x + (box.w - ln.width) / 2);
    const y = top + li * fit.lineH;
    return textNode({
      name: `text · line ${li + 1}`, text: ln.text,
      x, y, fontSize: fit.fs, weight, align: "left", fill,
      start, duration: dur,
      posKeys: [{ frame: start, value: { x, y: y + rise, z: 0 } }, { frame: start + entF, value: { x, y, z: 0 } }],
      opacityKeys: [{ frame: start, value: 0 }, { frame: start + entF, value: 1 }],
    });
  });
}

/** Left/right-anchored, vertically-centered wrapped block — the anchored
 * sibling of `centeredTextNodes` (which is always centered). When `opts.span`
 * is given, words matching it (case-insensitive, whole-word) render in
 * `opts.accent` instead of `fill` — the "one word in accent" headline
 * treatment. Used by accent-headline, editorial-lede, anaphora-stack. */
export function alignedTextNodes(
  fit: FitResult, box: FitBox, align: "left" | "right",
  start: number, dur: number, fill: ColorOKLCH,
  opts: { weight?: number; accent?: ColorOKLCH; span?: string; tracking?: number; reveal?: "rise" | "fade" } = {},
): Node[] {
  const weight = opts.weight ?? 700;
  const top = box.y + Math.max(0, Math.round((box.h - fit.totalH) / 2));
  const entF = Math.min(10, Math.max(4, Math.round(dur * 0.15)));
  const rise = Math.round(box.h * 0.03);
  const spanWords = opts.span ? new Set(opts.span.split(/\s+/).map(normWord).filter(Boolean)) : null;
  const enter = (x: number, y: number) => (opts.reveal === "fade" ? fadeIn(start, entF) : fadeRise(start, entF, x, y, rise));

  const out: Node[] = [];
  fit.lines.forEach((ln, li) => {
    const y = top + li * fit.lineH;
    const lineX = align === "left" ? box.x : box.x + box.w - ln.width;
    if (!spanWords || !spanWords.size) {
      out.push(textNode({
        name: `text · line ${li + 1}`, text: ln.text,
        x: lineX, y, fontSize: fit.fs, weight, align: "left", fill,
        tracking: opts.tracking, start, duration: dur, ...enter(lineX, y),
      }));
      return;
    }
    // Split the line into accent/non-accent word runs so each can carry its
    // own fill, merging adjacent same-color words into one node.
    const words = ln.text.split(" ");
    let x = lineX;
    for (let i = 0; i < words.length; ) {
      const accentRun = spanWords.has(normWord(words[i]));
      let j = i + 1;
      while (j < words.length && spanWords.has(normWord(words[j])) === accentRun) j++;
      const run = words.slice(i, j).join(" ");
      out.push(textNode({
        name: `text · line ${li + 1} run`, text: run,
        x, y, fontSize: fit.fs, weight, align: "left",
        fill: accentRun ? (opts.accent ?? fill) : fill,
        tracking: opts.tracking, start, duration: dur, ...enter(x, y),
      }));
      x += measureText(run, fit.fs, weight) + (j < words.length ? spaceWidth(fit.fs, weight) : 0);
      i = j;
    }
  });
  return out;
}

/** Kinetic typography: per-line staggered pop-in. (Verbatim `kineticTextNodes`.) */
export function kineticTextNodes(text: string, start: number, dur: number, box: FitBox, fill: ColorOKLCH, startPx: number, floor: number, beatId = ""): Node[] {
  const fit = fitTextToBox(text, box.w, box.h, 800, startPx, floor, LINE_H_DISPLAY);
  if (!fit.fits && beatId) console.warn(`[text] kinetic overflow on ${beatId} (floor ${fit.fs}px)`);
  const top = box.y + Math.max(0, Math.round((box.h - fit.totalH) / 2));
  const staggerF = Math.min(6, Math.max(2, Math.round(dur * 0.06)));
  const popF = Math.min(10, Math.max(4, Math.round(dur * 0.12)));
  return fit.lines.map((ln, li) => {
    const x = Math.round(box.x + (box.w - ln.width) / 2);
    const y = top + li * fit.lineH;
    const lineStart = start + li * staggerF;
    return textNode({
      name: `kinetic · line ${li + 1}`, text: ln.text,
      x, y, fontSize: fit.fs, weight: 800, align: "left", fill,
      start, duration: dur,
      scaleKeys: [
        { frame: lineStart, value: { x: 0.7, y: 0.7 } },
        { frame: lineStart + popF, value: { x: 1.08, y: 1.08 } },
        { frame: lineStart + popF + 4, value: { x: 1, y: 1 } },
      ],
      opacityKeys: [
        { frame: lineStart, value: 0 },
        { frame: lineStart + Math.max(1, Math.round(popF * 0.4)), value: 1 },
      ],
    });
  });
}

/** Broadcast lower-third: text-sized bar + left-aligned label near the bottom.
 * (Verbatim `lowerThirdNodes`.) */
export function lowerThirdNodes(text: string, start: number, dur: number, W: number, H: number, fill: ColorOKLCH, accent: ColorOKLCH): Node[] {
  const margin = Math.round(W * 0.08);
  const maxLabelW = W - margin * 2;
  const floor = floorPxFor("display", W, H);
  let fs = rolePx("lowerThird", W, H);
  while (measureText(text, fs, 700) > maxLabelW && fs > floor) {
    fs = Math.max(floor, Math.min(fs - 1, Math.round(fs * _FONT_SCALE_SHRINK_STEP)));
  }
  const bandH = Math.round(fs * 2.2);
  const bandY = Math.round(H * 0.8);
  const pad = Math.round(fs * 0.6);
  const labelW = Math.min(measureText(text, fs, 700), maxLabelW);
  const barW = Math.min(W - margin, labelW + pad * 2);
  const barX = Math.max(0, margin - pad);
  const entF = Math.min(8, Math.max(3, Math.round(dur * 0.1)));

  const bar: Node = {
    id: createId(),
    kind: "shape",
    name: "Lower third bar",
    transform: { position: { x: barX, y: bandY, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
    opacity: 0,
    blend: "normal",
    time: { start: toFrame(start), duration: toFrame(dur) },
    origin: "user",
    props: { shape: "rect", width: barW, height: bandH, radius: 0, fill: { l: 0, c: 0, h: 0 } },
    channels: [{
      id: createId(), path: "opacity", type: "scalar" as const,
      keys: eased([{ frame: start, value: 0 }, { frame: start + entF, value: 0.55 }])
        .map((k) => ({ frame: toFrame(k.frame), value: k.value, interp: k.interp })),
    }],
  } as unknown as Node;

  const label = textNode({
    name: "Lower third label",
    text,
    x: margin, y: bandY + Math.round((bandH - fs) / 2),
    fontSize: fs, weight: 700, align: "left", fill: fill === accent ? accent : fill,
    start, duration: dur,
    posKeys: [
      { frame: start, value: { x: margin - Math.round(W * 0.03), y: bandY + Math.round((bandH - fs) / 2), z: 0 } },
      { frame: start + entF, value: { x: margin, y: bandY + Math.round((bandH - fs) / 2), z: 0 } },
    ],
    opacityKeys: [{ frame: start, value: 0 }, { frame: start + entF, value: 1 }],
  });

  return [bar, label];
}

// apps/editor/src/persistence/text/representations/chat-bubbles.ts
//
// P3 · Messenger-style dialogue — one bubble per `items[]` entry, alternating
// sides by `speaker`, each with a rounded background and staggered entrance.

import type { ColorOKLCH, Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx } from "../services/type-scale";
import { fitTextToBox, LINE_H_BODY } from "../services/layout";
import { textNode, rectNode } from "../services/nodes";
import { layerWindow } from "../services/timing";
import { fadeRise } from "../services/reveal";

const DARK: ColorOKLCH = { l: 0.12, c: 0, h: 0 };

export const chatBubbles: TextRepresentation = {
  id: "chat-bubbles",
  fields: ["items"],
  region: "full",
  supports: (i) => (i.intent === "dialogue" ? 1 : 0),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const items = ctx.fields.items ?? [];
    if (!items.length) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    const fs = tierPx("body", W, H);
    const maxBubbleW = Math.round(sb.w * 0.82);
    const padX = Math.round(fs * 0.7);
    const padY = Math.round(fs * 0.5);
    const gap = Math.round(fs * 0.7);

    // Measure each bubble first so we can center the stack vertically.
    const speakers = [...new Set(items.map((it) => it.speaker ?? ""))];
    const laid = items.map((it) => {
      const fit = fitTextToBox(it.text, maxBubbleW - padX * 2, sb.h, 500, fs, tierPx("bodyS", W, H), LINE_H_BODY);
      const textW = fit.lines.reduce((m, l) => Math.max(m, l.width), 0);
      const bubbleW = textW + padX * 2;
      const bubbleH = fit.totalH + padY * 2;
      const outgoing = speakers.length > 1 ? (it.speaker ?? "") === speakers[1] : false;
      return { it, fit, bubbleW, bubbleH, outgoing };
    });
    const totalH = laid.reduce((s, b) => s + b.bubbleH + gap, -gap);
    let y = Math.round(H * 0.5 - totalH / 2);
    const staggerF = Math.min(10, Math.max(3, Math.round(win.dur / (items.length + 2))));
    const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.1)));

    const out: Node[] = [];
    laid.forEach((b, idx) => {
      const bx = b.outgoing ? sb.x + sb.w - b.bubbleW : sb.x;
      const bStart = win.start + idx * staggerF;
      const bDur = win.end ? Math.max(1, win.end - bStart) : win.dur;
      const radius = Math.round(fs * 0.7);
      out.push(rectNode({
        name: `chat · ${idx + 1} bubble`, x: bx, y, w: b.bubbleW, h: b.bubbleH, radius,
        fill: b.outgoing ? ctx.palette.accent : DARK, opacity: b.outgoing ? 1 : 0.9,
        start: bStart, duration: bDur, fadeF: entF,
      }));
      const textFill = b.outgoing ? DARK : ctx.fill;
      b.fit.lines.forEach((ln, li) => {
        const tx = bx + padX;
        const ty = y + padY + li * b.fit.lineH;
        out.push(textNode({
          name: `chat · ${idx + 1} line ${li + 1}`, text: ln.text, x: tx, y: ty,
          fontSize: b.fit.fs, weight: 500, align: "left", fill: textFill,
          start: bStart, duration: bDur, ...fadeRise(bStart, entF, tx, ty, Math.round(fs * 0.4)),
        }));
      });
      y += b.bubbleH + gap;
    });
    return out;
  },
};

register(chatBubbles);

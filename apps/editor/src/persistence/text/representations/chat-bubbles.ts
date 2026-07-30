// apps/editor/src/persistence/text/representations/chat-bubbles.ts
//
// P3 · Messenger-style dialogue — one bubble per `items[]` entry, alternating
// sides by `speaker`, each with a rounded background and staggered entrance.
//
// FIX (P4): each bubble used to fit its text into the WHOLE safe height and
// the stack was centered with an unclamped `totalH`, so one long message could
// fill the frame and several turns spilled off the top and bottom. Now the
// turn count is capped and each bubble's text is fit into an EQUAL share of the
// safe height (`perBubbleH`), so the measured stack is guaranteed ≤ safe.h and
// the top is clamped into the safe box.

import type { ColorOKLCH, Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx } from "../services/type-scale";
import { fitTextToBox, LINE_H_BODY } from "../services/layout";
import { textNode, rectNode } from "../services/nodes";
import { layerWindow } from "../services/timing";
import { fadeRise } from "../services/reveal";

const DARK: ColorOKLCH = { l: 0.12, c: 0, h: 0 };
const MAX_TURNS = 6;

export const chatBubbles: TextRepresentation = {
  id: "chat-bubbles",
  fields: ["items"],
  region: "full",
  supports: (i) => (i.intent === "dialogue" ? 1 : 0),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const items = (ctx.fields.items ?? []).slice(0, MAX_TURNS);
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

    // Each bubble may claim at most an equal share of the safe height minus the
    // inter-bubble gaps — so N bubbles can never sum past safe.h. fitTextToBox
    // shrinks the font to honour that per-bubble cap.
    const gapsTotal = gap * (items.length - 1);
    const perBubbleH = Math.max(fs * 2, Math.floor((sb.h - gapsTotal) / items.length));
    const perTextH = Math.max(fs, perBubbleH - padY * 2);

    const speakers = [...new Set(items.map((it) => it.speaker ?? ""))];
    const laid = items.map((it) => {
      const fit = fitTextToBox(it.text, maxBubbleW - padX * 2, perTextH, 500, fs, tierPx("bodyS", W, H), LINE_H_BODY);
      const textW = fit.lines.reduce((m, l) => Math.max(m, l.width), 0);
      const bubbleW = textW + padX * 2;
      const bubbleH = fit.totalH + padY * 2;
      const outgoing = speakers.length > 1 ? (it.speaker ?? "") === speakers[1] : false;
      return { it, fit, bubbleW, bubbleH, outgoing };
    });

    const totalH = laid.reduce((s, b) => s + b.bubbleH + gap, -gap);
    // Center, then clamp so the stack never starts above the safe top nor
    // spills the bottom.
    let y = Math.round(sb.y + Math.max(0, (sb.h - totalH) / 2));
    y = Math.min(Math.max(sb.y, y), sb.y + Math.max(0, sb.h - totalH));

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

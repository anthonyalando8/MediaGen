// apps/editor/src/persistence/text/representations/anaphora-stack.ts
//
// P4 · Short repeated phrases, one per line, heavy weight, each with its own
// staggered rise-in — "Why quantum. / Why Africa. / Why now." An optional
// supporting paragraph sits to the right. Scores below kinetic-lines (which
// requires `body` — see its `fields`), so it only wins when the beat carries
// `items` but no body: the rhythm-of-three case kinetic-lines doesn't cover.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { rolePx, floorPxFor, tierPx, tierFloorPx } from "../services/type-scale";
import { fitTextToBox, LINE_H_DISPLAY, LINE_H_BODY, type FitBox } from "../services/layout";
import { alignedTextNodes } from "../services/nodes";
import { layerWindow, staggerWindow } from "../services/timing";

export const anaphoraStack: TextRepresentation = {
  id: "anaphora-stack",
  fields: ["items"],
  region: "full",
  supports: (i) => (i.intent === "emphasis" && i.hasItems ? 0.9 : 0.1),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const items = ctx.fields.items ?? [];
    if (!items.length) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    const body = ctx.fields.body;
    const stackW = Math.round(sb.w * (body ? 0.6 : 1));
    const lines = items.map((it) => it.text);
    const startPx = rolePx("hero", W, H);
    const floor = floorPxFor("display", W, H);
    // One shared size across every line so the stack reads as one rhythm.
    const fs = Math.min(...lines.map((ln) => fitTextToBox(ln, stackW, Infinity, 800, startPx, floor, LINE_H_DISPLAY).fs));
    const lineH = Math.round(fs * LINE_H_DISPLAY);
    const totalH = lineH * lines.length;
    const top = Math.round(sb.y + sb.h / 2 - totalH / 2);

    const out: Node[] = [];
    lines.forEach((text, n) => {
      const itemWin = staggerWindow(win, n, lines.length);
      const box: FitBox = { x: sb.x, y: top + n * lineH, w: stackW, h: lineH };
      const oneLine = fitTextToBox(text, stackW, lineH, 800, fs, floor, LINE_H_DISPLAY);
      out.push(...alignedTextNodes(oneLine, box, "left", itemWin.start, itemWin.dur, ctx.fill, { weight: 800 }));
    });

    if (body) {
      const ledeX = sb.x + stackW + Math.round(sb.w * 0.06);
      const ledeBox: FitBox = { x: ledeX, y: top, w: sb.x + sb.w - ledeX, h: totalH };
      const ledeFit = fitTextToBox(body, ledeBox.w, ledeBox.h, 400, tierPx("bodyS", W, H), tierFloorPx("footnote", W, H), LINE_H_BODY);
      out.push(...alignedTextNodes(ledeFit, ledeBox, "left", win.start, win.dur, ctx.fill, { weight: 400 }));
    }
    return out;
  },
};

register(anaphoraStack);

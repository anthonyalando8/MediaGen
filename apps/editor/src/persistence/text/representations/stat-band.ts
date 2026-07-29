// apps/editor/src/persistence/text/representations/stat-band.ts
//
// P4 · Two-to-four figures laid out in a row with hairline dividers, each
// figure over a wrapped caption — the multi-column sibling of stat-figure
// (which renders one hero figure + one label as two stacked layers). Reads
// `items[]` as `{ label: "600M+", text: "caption…" }` and columnises evenly
// so "600M+ / 5–7 yrs / 0" reads as one comparative statement.

import type { ColorOKLCH, Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx, tierFloorPx } from "../services/type-scale";
import { fitTextToBox, LINE_H_BODY, LINE_H_DISPLAY, type FitBox } from "../services/layout";
import { textNode, rectNode } from "../services/nodes";
import { layerWindow, staggerWindow } from "../services/timing";
import { fadeIn } from "../services/reveal";

export const statBand: TextRepresentation = {
  id: "stat-band",
  fields: ["items"],
  region: "full",
  supports: (i) => (i.intent === "stat" && i.hasItems ? 1 : i.hasItems ? 0.2 : 0.1),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const cols = (ctx.fields.items ?? []).slice(0, 4);
    if (!cols.length) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    const figureFs = tierPx("displayM", W, H);
    const captionFs = tierPx("bodyS", W, H);
    const gutter = Math.round(sb.w * 0.03);
    const colW = sb.w / cols.length;
    const ruleW = Math.max(1, Math.round(Math.min(W, H) * 0.0015));
    const out: Node[] = [];

    cols.forEach((c, n) => {
      const box: FitBox = { x: sb.x + n * colW, y: sb.y, w: colW - gutter, h: sb.h };
      const itemWin = staggerWindow(win, n, cols.length);
      const entF = Math.min(10, Math.max(4, Math.round(itemWin.dur * 0.15)));
      const figure = c.label ?? c.text;

      // `figure` isn't guaranteed short (a heuristic-derived item without a
      // real `label` falls back to the whole clause) — fit it like every
      // other headline instead of assuming it always fits on one line at a
      // fixed huge size, which overflows straight into the next column.
      const figureFit = fitTextToBox(figure, box.w, Math.round(box.h * 0.4), 700, figureFs, tierFloorPx("footnote", W, H), LINE_H_DISPLAY);
      const captionFit = fitTextToBox(c.text, box.w, Math.round(box.h * 0.4), 500, captionFs, tierFloorPx("footnote", W, H), LINE_H_BODY);
      const gap = Math.round(figureFit.fs * 0.3);
      const blockH = figureFit.totalH + gap + captionFit.totalH;
      const top = Math.round(box.y + box.h * 0.5 - blockH / 2);

      figureFit.lines.forEach((ln, li) => {
        out.push(textNode({
          name: `stat-band · ${n + 1} figure ${li + 1}`, text: ln.text,
          x: box.x, y: top + li * figureFit.lineH,
          fontSize: figureFit.fs, weight: 700, align: "left", fill: ctx.palette.accent,
          start: itemWin.start, duration: itemWin.dur, ...fadeIn(itemWin.start, entF),
        }));
      });
      const capTop = top + figureFit.totalH + gap;
      captionFit.lines.forEach((ln, li) => {
        out.push(textNode({
          name: `stat-band · ${n + 1} caption ${li + 1}`, text: ln.text,
          x: box.x, y: capTop + li * captionFit.lineH,
          fontSize: captionFit.fs, weight: 400, align: "left", fill: ctx.fill,
          start: itemWin.start, duration: itemWin.dur, ...fadeIn(itemWin.start, entF),
        }));
      });
      if (n > 0) {
        out.push(rectNode({
          name: `stat-band · ${n + 1} divider`, x: box.x - Math.round(gutter / 2), y: sb.y,
          w: ruleW, h: sb.h, fill: ctx.fill as ColorOKLCH, opacity: 0.18,
          start: itemWin.start, duration: itemWin.dur,
        }));
      }
    });
    return out;
  },
};

register(statBand);

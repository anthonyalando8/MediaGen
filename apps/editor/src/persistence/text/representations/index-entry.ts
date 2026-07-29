// apps/editor/src/persistence/text/representations/index-entry.ts
//
// P4 · A numbered case: tracked accent label, a large ghosted ordinal, and a
// headline — "01 — THE THREAT — Current encryption will be broken." Renders
// one or two entries side-by-side; the ordinal is chrome, not content, so it
// sits behind the text at low opacity and is derived from index, never
// authored.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx, tierTracking, tierFloorPx } from "../services/type-scale";
import { fitTextToBox, LINE_H_BODY } from "../services/layout";
import { textNode, rectNode } from "../services/nodes";
import { layerWindow, staggerWindow } from "../services/timing";
import { fadeRise } from "../services/reveal";

export const indexEntry: TextRepresentation = {
  id: "index-entry",
  fields: ["items"],
  region: "full",
  supports: (i) => (i.intent === "timeline" ? 1 : i.intent === "list" && i.hasItems ? 0.5 : 0.1),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const cols = (ctx.fields.items ?? []).slice(0, 2);
    if (!cols.length) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    const gutter = Math.round(sb.w * 0.05);
    const colW = (sb.w - gutter * (cols.length - 1)) / cols.length;
    const labelFs = tierPx("label", W, H);
    const headingFs = tierPx("headingL", W, H);
    const ordinalFs = tierPx("displayXl", W, H);
    const ruleH = Math.max(1, Math.round(Math.min(W, H) * 0.002));
    const ghostOpacity = 0.08;

    const out: Node[] = [];
    cols.forEach((c, n) => {
      const x = sb.x + n * (colW + gutter);
      // `c.text` isn't guaranteed a single short line (a heuristic-derived
      // case can be a full clause) — fit it, like every other headline,
      // instead of a fixed size with no width constraint.
      const headingFit = fitTextToBox(c.text, colW, Math.round(sb.h * 0.4), 600, headingFs, tierFloorPx("bodyL", W, H), LINE_H_BODY);
      const labelH = c.label ? Math.round(labelFs * 1.6) : 0;
      const blockH = labelH + headingFit.totalH;
      const top = Math.round(sb.y + sb.h * 0.5 - blockH / 2);
      const itemWin = staggerWindow(win, n, cols.length);
      const entF = Math.min(10, Math.max(4, Math.round(itemWin.dur * 0.15)));

      out.push(rectNode({
        name: `index-entry · ${n + 1} rule`, x, y: top - Math.round(labelFs * 0.6), w: colW, h: ruleH,
        fill: n === 0 ? ctx.palette.accent : ctx.fill, opacity: n === 0 ? 0.9 : 0.3,
        start: itemWin.start, duration: itemWin.dur, fadeF: entF,
      }));
      const ordinalY = top - Math.round(ordinalFs * 0.15);
      out.push(textNode({
        name: `index-entry · ${n + 1} ordinal`, text: String(n + 1).padStart(2, "0"),
        x, y: ordinalY, fontSize: ordinalFs, weight: 700,
        align: "left", fill: ctx.fill, start: itemWin.start, duration: itemWin.dur,
        opacityKeys: [{ frame: itemWin.start, value: 0 }, { frame: itemWin.start + entF, value: ghostOpacity }],
      }));
      if (c.label) {
        out.push(textNode({
          name: `index-entry · ${n + 1} label`, text: c.label.toUpperCase(), x, y: top,
          fontSize: labelFs, weight: 600, align: "left", fill: ctx.palette.spike,
          start: itemWin.start, duration: itemWin.dur, tracking: tierTracking("label", labelFs),
          ...fadeRise(itemWin.start, entF, x, top, Math.round(H * 0.02)),
        }));
      }
      const headingY = top + labelH;
      headingFit.lines.forEach((ln, li) => {
        const ly = headingY + li * headingFit.lineH;
        out.push(textNode({
          name: `index-entry · ${n + 1} heading ${li + 1}`, text: ln.text, x, y: ly,
          fontSize: headingFit.fs, weight: 600, align: "left", fill: ctx.fill,
          start: itemWin.start, duration: itemWin.dur,
          ...fadeRise(itemWin.start, entF, x, ly, Math.round(H * 0.02)),
        }));
      });
    });
    return out;
  },
};

register(indexEntry);

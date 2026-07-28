// apps/editor/src/persistence/text/representations/numbered-list.ts
//
// P3 · Numbered / bullet list — one row per `items[]` entry, each a marker
// (number or the item's `label`) + text, staggered in. Serves list / timeline
// / takeaway / top-N intents (same module, different marker glyph upstream).

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx } from "../services/type-scale";
import { measureText } from "../services/measure";
import { textNode } from "../services/nodes";
import { layerWindow } from "../services/timing";
import { fadeRise } from "../services/reveal";

export const numberedList: TextRepresentation = {
  id: "numbered-list",
  fields: ["items"],
  region: "full",
  supports: (i) =>
    i.intent === "list" || i.intent === "timeline" || i.intent === "takeaway" ? 1 : i.hasItems ? 0.4 : 0,
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const items = ctx.fields.items ?? [];
    if (!items.length) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    const markerFs = tierPx("headingXl", W, H);
    const itemFs = tierPx("headingM", W, H);
    const rowH = Math.round(markerFs * 1.55);
    const gutter = Math.round(markerFs * 1.4);
    const blockH = rowH * items.length;
    let y = Math.round(H * 0.5 - blockH / 2);
    const x = sb.x;
    const staggerF = Math.min(8, Math.max(3, Math.round(win.dur / (items.length + 2))));
    const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.1)));
    const rise = Math.round(H * 0.02);

    const out: Node[] = [];
    items.forEach((it, idx) => {
      const rowStart = win.start + idx * staggerF;
      const rowDur = win.end ? Math.max(1, win.end - rowStart) : win.dur;
      const marker = it.label ?? String(idx + 1);
      out.push(textNode({
        name: `list · ${idx + 1} marker`, text: marker, x, y,
        fontSize: markerFs, weight: 700, align: "left",
        fill: idx === 0 ? ctx.palette.spike : ctx.palette.accent,
        start: rowStart, duration: rowDur, ...fadeRise(rowStart, entF, x, y, rise),
      }));
      const tx = x + Math.max(gutter, measureText(marker, markerFs, 700) + Math.round(markerFs * 0.4));
      out.push(textNode({
        name: `list · ${idx + 1} text`, text: it.text, x: tx, y: y + Math.round((markerFs - itemFs) * 0.55),
        fontSize: itemFs, weight: 600, align: "left", fill: ctx.fill,
        start: rowStart, duration: rowDur, ...fadeRise(rowStart, entF, tx, y + Math.round((markerFs - itemFs) * 0.55), rise),
      }));
      y += rowH;
    });
    return out;
  },
};

register(numberedList);

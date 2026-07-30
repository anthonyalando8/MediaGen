// apps/editor/src/persistence/text/representations/numbered-list.ts
//
// P3 · Numbered / bullet list — one row per `items[]` entry, each a marker
// (number or the item's `label`) + text, staggered in. Serves list / takeaway
// intents (timeline defers to index-entry).
//
// FIX (P4): previously each `it.text` went straight to `textNode` UNWRAPPED
// (ran off the right safe edge) and the rows were centered with an unclamped
// `blockH = rowH * items.length` (tall lists spilled top & bottom onto the
// HUD). Now every row's text is fit to the text column FIRST, and the whole
// stack is measured + uniformly shrunk to fit `safe.h` via `stackRows`. The
// item count is capped so a run-away contract can't force microscopic type.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx } from "../services/type-scale";
import { measureText } from "../services/measure";
import { stackRows, LINE_H_BODY, type RowSpec } from "../services/layout";
import { textNode } from "../services/nodes";
import { layerWindow } from "../services/timing";
import { fadeRise } from "../services/reveal";

const MAX_ROWS = 6;

export const numberedList: TextRepresentation = {
  id: "numbered-list",
  fields: ["items"],
  region: "full",
  // timeline defers to index-entry's ordinal-chrome treatment; list/takeaway
  // stay owned by this generic marker+text row.
  supports: (i) =>
    i.intent === "list" || i.intent === "takeaway" ? 1 : i.intent === "timeline" ? 0.4 : i.hasItems ? 0.4 : 0,
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const items = (ctx.fields.items ?? []).slice(0, MAX_ROWS);
    if (!items.length) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    // Reserve a gutter wide enough for the widest marker so text never sits
    // under a number. Markers are the item's `label` or its 1-based index.
    const markerFs = tierPx("headingM", W, H);
    const markers = items.map((it, idx) => it.label ?? String(idx + 1));
    const gutter = Math.round(
      Math.max(...markers.map((m) => measureText(m, markerFs, 700))) + markerFs * 0.5,
    );
    const textWFrac = Math.max(0.1, (sb.w - gutter) / sb.w);

    const rows: RowSpec[] = items.map((it) => ({
      text: it.text,
      weight: 600,
      tier: "headingM",
      floorTier: "bodyS",
      maxWFrac: textWFrac,
      lineHeightRatio: LINE_H_BODY,
    }));
    const placed = stackRows(sb, W, H, rows, { gapFrac: 0.7, xOf: () => sb.x + gutter });

    const staggerF = Math.min(8, Math.max(3, Math.round(win.dur / (items.length + 2))));
    const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.1)));
    const rise = Math.round(H * 0.02);

    const out: Node[] = [];
    placed.forEach((row, idx) => {
      const rowStart = win.start + idx * staggerF;
      const rowDur = win.end ? Math.max(1, win.end - rowStart) : win.dur;
      const mFs = row.fit.fs;   // match marker size to the (possibly shrunk) row
      // Marker baseline-aligns to the row's first text line.
      out.push(textNode({
        name: `list · ${idx + 1} marker`, text: markers[idx], x: sb.x, y: row.y,
        fontSize: mFs, weight: 700, align: "left",
        fill: idx === 0 ? ctx.palette.spike : ctx.palette.accent,
        start: rowStart, duration: rowDur, ...fadeRise(rowStart, entF, sb.x, row.y, rise),
      }));
      row.fit.lines.forEach((ln, li) => {
        const ly = row.y + li * row.fit.lineH;
        out.push(textNode({
          name: `list · ${idx + 1} text ${li + 1}`, text: ln.text, x: row.x, y: ly,
          fontSize: row.fit.fs, weight: 600, align: "left", fill: ctx.fill,
          start: rowStart, duration: rowDur, ...fadeRise(rowStart, entF, row.x, ly, rise),
        }));
      });
    });
    return out;
  },
};

register(numberedList);

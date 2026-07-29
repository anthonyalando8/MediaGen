// apps/editor/src/persistence/text/representations/meta-chips.ts
//
// P4 · A wrapping row of fact chips, each with a marker square — "UK Africa
// Quantum AI Convening · 5 Nov 2026", "London · Invite-Only". Metadata, not
// prose: dates, locations, tags. Region `lower` (documentation only today —
// see TextRegion) so it reads as a band that could pair beneath a headline
// once the compiler grows multi-region composition.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx, tierTracking } from "../services/type-scale";
import { measureText } from "../services/measure";
import { textNode, rectNode } from "../services/nodes";
import { layerWindow, staggerWindow } from "../services/timing";
import { fadeIn } from "../services/reveal";

export const metaChips: TextRepresentation = {
  id: "meta-chips",
  fields: ["items"],
  region: "lower",
  supports: (i) => (i.intent === "meta" ? 1 : i.intent === "list" && i.hasItems ? 0.3 : 0.1),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const items = ctx.fields.items ?? [];
    if (!items.length) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    const fs = tierPx("caption", W, H);
    const padX = Math.round(fs * 0.7);
    const padY = Math.round(fs * 0.5);
    const gap = Math.round(fs * 0.5);
    const markerW = Math.round(fs * 0.4);
    const rowH = Math.round(fs * 1.5) + padY * 2;
    const baseY = Math.round(sb.y + sb.h - rowH);
    const track = tierTracking("caption", fs);

    let x = sb.x;
    let row = 0;
    const out: Node[] = [];
    items.forEach((it, n) => {
      const label = it.text;
      const w = measureText(label, fs, 500) + markerW + Math.round(fs * 0.5) + padX * 2;
      if (x + w > sb.x + sb.w && x > sb.x) { x = sb.x; row += 1; }
      const chipY = baseY - row * (rowH + gap);
      const itemWin = staggerWindow(win, n, items.length);
      const entF = Math.min(10, Math.max(4, Math.round(itemWin.dur * 0.15)));

      out.push(rectNode({
        name: `meta-chip · ${n + 1} bg`, x, y: chipY, w, h: rowH, radius: Math.round(fs * 0.2),
        fill: ctx.fill, opacity: 0.12, start: itemWin.start, duration: itemWin.dur, fadeF: entF,
      }));
      out.push(rectNode({
        name: `meta-chip · ${n + 1} marker`, x: x + padX, y: chipY + Math.round((rowH - markerW) / 2),
        w: markerW, h: markerW, fill: ctx.palette.spike, opacity: 1,
        start: itemWin.start, duration: itemWin.dur, fadeF: entF,
      }));
      out.push(textNode({
        name: `meta-chip · ${n + 1} label`, text: label,
        x: x + padX + markerW + Math.round(fs * 0.5), y: chipY + Math.round((rowH - fs) / 2),
        fontSize: fs, weight: 500, align: "left", fill: ctx.fill, tracking: track,
        start: itemWin.start, duration: itemWin.dur, ...fadeIn(itemWin.start, entF),
      }));
      x += w + gap;
    });
    return out;
  },
};

register(metaChips);

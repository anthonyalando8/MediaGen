// apps/editor/src/persistence/text/representations/comparison-labels.ts
//
// P3 · Two panel labels for a comparison / before-after / myth-fact /
// pros-cons beat. The split panels + divider are COMPOSITION, emitted by the
// `comparison` archetype — this only paints the two labels.
//
// FIX (P4): two problems.
//   1. `supports` returned 1 for `intent === "comparison"` REGARDLESS of
//      archetype, so on a full-bleed beat merely tagged `comparison` the
//      selector picked this and painted two labels floating over an image with
//      no panels behind them. It now scores 0 unless the beat is actually
//      composed as `comparison` — the labels never appear without their panels.
//   2. Labels were MEASURED un-cased then rendered `.toUpperCase()`, so the
//      drawn string was wider than measured (mis-centered, clipped). We now
//      uppercase first, then measure + shrink-to-fit the panel width.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx, tierTracking, tierFloorPx } from "../services/type-scale";
import { measureText } from "../services/measure";
import { _FONT_SCALE_SHRINK_STEP } from "../services/layout";
import { textNode } from "../services/nodes";
import { layerWindow } from "../services/timing";
import { fadeRise } from "../services/reveal";

function labelPair(ctx: TextBuildContext): string[] {
  const items = ctx.fields.items;
  if (items && items.length >= 2) return [items[0].label ?? items[0].text, items[1].label ?? items[1].text];
  const kw = ctx.fields.keyword ?? "";
  const parts = kw.split(/\s+(?:vs\.?|versus)\s+|\s*\|\s*/i).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return ["", ""];
}

export const comparisonLabels: TextRepresentation = {
  id: "comparison-labels",
  fields: ["keyword"],
  region: "full",
  // Gate on the COMPOSITION: these labels are meaningless without the split
  // panels the `comparison` archetype paints. Never fire otherwise.
  supports: (i) =>
    i.archetype === "comparison" ? (i.intent === "comparison" ? 1 : 0.6) : 0,
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const [a, b] = labelPair(ctx);
    if (!a && !b) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };
    const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.15)));

    const startFs = tierPx("subheading", W, H);
    const floor = tierFloorPx("subheading", W, H);

    const mk = (raw: string, y: number, fill: typeof ctx.fill, name: string): Node | null => {
      if (!raw) return null;
      const text = raw.toUpperCase();          // case BEFORE measuring
      let fs = startFs;
      while (measureText(text, fs, 700) > sb.w && fs > floor) {
        fs = Math.max(floor, Math.min(fs - 1, Math.round(fs * _FONT_SCALE_SHRINK_STEP)));
      }
      const w = measureText(text, fs, 700);
      const x = Math.round(sb.x + (sb.w - w) / 2);
      return textNode({
        name, text, x, y, fontSize: fs, weight: 700, align: "left",
        fill, start: win.start, duration: win.dur, tracking: tierTracking("subheading", fs),
        ...fadeRise(win.start, entF, x, y, Math.round(H * 0.02)),
      });
    };

    const top = mk(a, Math.round(sb.y + sb.h * 0.06), ctx.palette.spike, "cmp · A");
    const bottom = mk(b, Math.round(sb.y + sb.h * 0.9), ctx.palette.accent, "cmp · B");
    return [top, bottom].filter(Boolean) as Node[];
  },
};

register(comparisonLabels);

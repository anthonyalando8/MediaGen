// apps/editor/src/persistence/text/representations/comparison-labels.ts
//
// P3 · Two panel labels for a comparison / before-after / myth-fact /
// pros-cons beat. The split panels + divider are COMPOSITION (already emitted
// by the archetype); this only paints the two labels, anchored to the top and
// bottom (or left/right) half. Reads `items[]` (side a/b) or falls back to
// splitting `keyword` on "vs" / "|".

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx, tierTracking } from "../services/type-scale";
import { measureText } from "../services/measure";
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
  supports: (i) => (i.intent === "comparison" ? 1 : i.archetype === "comparison" ? 0.6 : 0),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const [a, b] = labelPair(ctx);
    if (!a && !b) return [];
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };
    const fs = tierPx("subheading", W, H);
    const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.15)));
    const trk = tierTracking("subheading", fs);

    const mk = (text: string, y: number, fill: typeof ctx.fill, name: string): Node | null => {
      if (!text) return null;
      const w = measureText(text, fs, 700);
      const x = Math.round((W - w) / 2);
      return textNode({
        name, text: text.toUpperCase(), x, y, fontSize: fs, weight: 700, align: "left",
        fill, start: win.start, duration: win.dur, tracking: trk,
        ...fadeRise(win.start, entF, x, y, Math.round(H * 0.02)),
      });
    };

    const top = mk(a, Math.round(sb.y + sb.h * 0.06), ctx.palette.spike, "cmp · A");
    const bottom = mk(b, Math.round(sb.y + sb.h * 0.9), ctx.palette.accent, "cmp · B");
    return [top, bottom].filter(Boolean) as Node[];
  },
};

register(comparisonLabels);

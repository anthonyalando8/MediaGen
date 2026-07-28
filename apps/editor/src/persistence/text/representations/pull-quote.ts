// apps/editor/src/persistence/text/representations/pull-quote.ts
//
// P1 · Centered statement (quote_card's text, body weight). Verbatim routing
// for the non-hero single-text case. Adds an OPTIONAL attribution line below
// the quote when the beat carries `attribution` (P3 field) — absent → renders
// exactly like today's quote_card.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { rolePx, floorPxFor, tierPx } from "../services/type-scale";
import { MAX_BLOCK_H } from "../services/layout";
import { centeredTextNodes, textNode } from "../services/nodes";
import { measureText } from "../services/measure";
import { layerWindow } from "../services/timing";
import { fadeIn } from "../services/reveal";

function blockBox(ctx: TextBuildContext, anchorY: number) {
  const { H } = ctx.frame;
  const sb = ctx.safe;
  const boxH = Math.min(sb.h, Math.round(H * MAX_BLOCK_H));
  const boxTop = Math.max(sb.y, Math.min(Math.round(anchorY * H - boxH / 2), sb.y + sb.h - boxH));
  return { x: sb.x, y: boxTop, w: sb.w, h: boxH };
}

export const pullQuote: TextRepresentation = {
  id: "pull-quote",
  fields: ["body"],
  region: "full",
  supports: (i) => (i.intent === "quote" ? 1 : 0.3),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const out: Node[] = [];
    for (const layer of ctx.textLayers) {
      const win = layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps);
      const box = blockBox(ctx, layer.anchor_y ?? 0.5);
      out.push(...centeredTextNodes(
        layer.text!, win.start, win.dur, box, ctx.fill,
        rolePx("body", W, H), floorPxFor("body", W, H), 700, ctx.beat.id ?? "",
      ));
    }
    // Attribution (optional): a smaller, muted line just below the block.
    const attribution = ctx.fields.attribution;
    if (attribution) {
      const last = ctx.textLayers[ctx.textLayers.length - 1];
      const win = layerWindow(last, ctx.time.startFrame, ctx.time.durationFrames, fps);
      const fs = tierPx("bodyS", W, H);
      const label = `\u2014 ${attribution}`;
      const w = measureText(label, fs, 500);
      const x = Math.round((W - w) / 2);
      const y = Math.round(ctx.safe.y + ctx.safe.h * 0.86);
      const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.15)));
      out.push(textNode({
        name: `${ctx.beat.id ?? "beat"} · attribution`,
        text: label, x, y, fontSize: fs, weight: 500, align: "left",
        fill: ctx.palette.accent, start: win.start, duration: win.dur,
        ...fadeIn(win.start, entF),
      }));
    }
    return out;
  },
};

register(pullQuote);

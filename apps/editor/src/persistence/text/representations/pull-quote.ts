// apps/editor/src/persistence/text/representations/pull-quote.ts
//
// P1 · Centered statement (quote_card's text, body weight). Verbatim routing
// for the non-hero single-text case. Adds an OPTIONAL attribution line below
// the quote when the beat carries `attribution` (P3 field) — absent → renders
// exactly like today's quote_card.
//
// FIX (P5) — same multi-layer overlap hero-title had: `build` gave every text
// layer its own `blockBox`, each up to MAX_BLOCK_H (62% of frame height), so
// two layers overlapped whether or not their `anchor_y` values matched. Any
// beat with 2+ text layers is now stacked by measured height, with `anchor_y`
// honoured as the position of the whole stack. See hero-title.ts for the full
// write-up.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { rolePx, floorPxFor, tierPx } from "../services/type-scale";
import { MAX_BLOCK_H, stackByHeight, shiftStackToward, anchorCenterPx } from "../services/layout";
import { centeredTextNodes, emitCenteredBlock, textNode } from "../services/nodes";
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
    const layers = ctx.textLayers;
    const out: Node[] = [];

    // The attribution line is pinned near the bottom of the safe box, so the
    // stack must not run into it.
    const attribution = ctx.fields.attribution;

    if (layers.length > 1) {
      const sb = attribution
        ? { ...ctx.safe, h: Math.round(ctx.safe.h * 0.78) }
        : ctx.safe;
      const measured = stackByHeight(sb, W, H, layers.map((l, i) => ({
        text: l.text,
        tier: i === 0 ? "displayM" : "bodyL",
        weight: i === 0 ? 700 : 400,
        maxWFrac: i === 0 ? 1 : 0.9,
      })));
      const stack = shiftStackToward(
        measured, sb, anchorCenterPx(layers.map((l) => l.anchor_y), H),
      );
      const kept = layers.filter((l) => !!l.text && l.text.trim().length > 0);
      stack.forEach((b, i) => {
        const layer = kept[i] ?? kept[kept.length - 1];
        const win = layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps);
        out.push(...emitCenteredBlock(
          b.fit, b.box.y, b.box, win.start, win.dur, ctx.fill,
          b.weight ?? 700, `${ctx.beat.id ?? "beat"} · quote ${i + 1}`,
        ));
      });
    } else {
      for (const layer of layers) {
        const win = layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps);
        const box = blockBox(ctx, layer.anchor_y ?? 0.5);
        out.push(...centeredTextNodes(
          layer.text!, win.start, win.dur, box, ctx.fill,
          rolePx("body", W, H), floorPxFor("body", W, H), 700, ctx.beat.id ?? "",
        ));
      }
    }

    // Attribution (optional): a smaller, muted line just below the block.
    if (attribution) {
      const last = layers[layers.length - 1];
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

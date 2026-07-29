// apps/editor/src/persistence/text/representations/stat-figure.ts
//
// P1 · Hero figure + supporting label, stacked by MEASURED height so the two
// blocks can't collide (stat_callout / poster_card). Verbatim port of the
// stacked branch in buildBeatGroupFromLayers. Falls back to a single hero
// block when only one text layer is present.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { rolePx, floorPxFor } from "../services/type-scale";
import { fitTextToBox, LINE_H_DISPLAY, LINE_H_BODY, MAX_BLOCK_H } from "../services/layout";
import { emitCenteredBlock, centeredTextNodes } from "../services/nodes";
import { layerWindow } from "../services/timing";

export const statFigure: TextRepresentation = {
  id: "stat-figure",
  fields: ["keyword"],
  region: "full",
  // hasItems defers to stat-band: a structured items[] beat won't have this
  // module's two-separate-text-layers shape, so build() would ignore items[].
  supports: (i) => (i.intent === "stat" ? (i.hasItems ? 0.3 : 1) : i.textLayerCount >= 2 ? 0.4 : 0.2),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const layers = ctx.textLayers;
    const winOf = (l: (typeof layers)[number]) => layerWindow(l, ctx.time.startFrame, ctx.time.durationFrames, fps);

    if (layers.length >= 2) {
      const [first, second] = layers;
      const w1 = winOf(first), w2 = winOf(second);
      const fit1 = fitTextToBox(first.text!, sb.w, Math.round(sb.h * 0.5), 800, rolePx("hero", W, H), floorPxFor("display", W, H), LINE_H_DISPLAY);
      const fit2 = fitTextToBox(second.text!, sb.w, Math.round(sb.h * 0.5), 700, rolePx("body", W, H), floorPxFor("body", W, H), LINE_H_BODY);
      const gap = Math.round(H * 0.03);
      let top1 = Math.round((first.anchor_y ?? 0.42) * H - fit1.totalH / 2);
      let top2 = top1 + fit1.totalH + gap;
      const overflow = top2 + fit2.totalH - (sb.y + sb.h);
      if (overflow > 0) { top1 -= overflow; top2 -= overflow; }
      if (top1 < sb.y) { const s = sb.y - top1; top1 += s; top2 += s; }
      return [
        ...emitCenteredBlock(fit1, top1, sb, w1.start, w1.dur, ctx.fill, 800, `${ctx.beat.id ?? "beat"} · hero`),
        ...emitCenteredBlock(fit2, top2, sb, w2.start, w2.dur, ctx.fill, 700, `${ctx.beat.id ?? "beat"} · label`),
      ];
    }

    // Single figure — hero block centered.
    const layer = layers[0];
    if (!layer) return [];
    const win = winOf(layer);
    const boxH = Math.min(sb.h, Math.round(H * MAX_BLOCK_H));
    const boxTop = Math.max(sb.y, Math.min(Math.round((layer.anchor_y ?? 0.5) * H - boxH / 2), sb.y + sb.h - boxH));
    return centeredTextNodes(layer.text!, win.start, win.dur, { x: sb.x, y: boxTop, w: sb.w, h: boxH }, ctx.fill, rolePx("hero", W, H), floorPxFor("display", W, H), 800, ctx.beat.id ?? "");
  },
};

register(statFigure);

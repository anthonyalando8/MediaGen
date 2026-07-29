// apps/editor/src/persistence/text/representations/hero-title.ts
//
// P1 · Big centered title (title_card's text, size:"hero"). Verbatim routing:
// centeredTextNodes at the "hero" role, weight 800.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { rolePx, floorPxFor } from "../services/type-scale";
import { MAX_BLOCK_H } from "../services/layout";
import { centeredTextNodes } from "../services/nodes";
import { layerWindow } from "../services/timing";

function blockBox(ctx: TextBuildContext, anchorY: number) {
  const { H } = ctx.frame;
  const sb = ctx.safe;
  const boxH = Math.min(sb.h, Math.round(H * MAX_BLOCK_H));
  const boxTop = Math.max(sb.y, Math.min(Math.round(anchorY * H - boxH / 2), sb.y + sb.h - boxH));
  return { x: sb.x, y: boxTop, w: sb.w, h: boxH };
}

export const heroTitle: TextRepresentation = {
  id: "hero-title",
  fields: ["keyword"],
  region: "full",
  // hasBody defers to editorial-lede (never renders a body) and
  // hasAccentSpan defers to accent-headline (never tints a span) — both are
  // real rendering-capability gaps, not preference.
  supports: (i) => (i.intent === "title" ? (i.hasBody || i.hasAccentSpan ? 0.5 : 1) : i.size === "hero" ? 0.6 : 0.2),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const out: Node[] = [];
    for (const layer of ctx.textLayers) {
      const win = layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps);
      const box = blockBox(ctx, layer.anchor_y ?? 0.5);
      out.push(...centeredTextNodes(
        layer.text!, win.start, win.dur, box, ctx.fill,
        rolePx("hero", W, H), floorPxFor("display", W, H), 800, ctx.beat.id ?? "",
      ));
    }
    return out;
  },
};

register(heroTitle);

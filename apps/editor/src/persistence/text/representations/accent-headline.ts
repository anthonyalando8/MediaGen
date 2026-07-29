// apps/editor/src/persistence/text/representations/accent-headline.ts
//
// P4 · A left-anchored display title that tints words matching
// `beat.accent_span` in the palette accent, with an optional supporting lede
// below — the "Positioning Africa in the Quantum Age" treatment. Distinct
// from hero-title (centered, single fill, no lede, no span tint): this one
// is corner-set, multi-line, and reads as "headline with one word in accent".

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { rolePx, floorPxFor, tierPx, tierFloorPx } from "../services/type-scale";
import { fitTextToBox, LINE_H_DISPLAY, LINE_H_BODY, MAX_BLOCK_H, type FitBox } from "../services/layout";
import { alignedTextNodes } from "../services/nodes";
import { layerWindow } from "../services/timing";

export const accentHeadline: TextRepresentation = {
  id: "accent-headline",
  fields: ["keyword"],
  region: "full",
  // title_card always sets size:"hero" (see scene_export.py), so without the
  // hasAccentSpan gate this would tie editorial-lede at 1.0 on EVERY
  // title+body beat and win by registration order alone — accent-headline's
  // real differentiator is the tint, so it only claims the top score when
  // there's actually a span to tint; otherwise it defers to editorial-lede
  // (body) or hero-title (bare title).
  supports: (i) =>
    i.intent === "title" && i.size === "hero"
      ? (i.hasAccentSpan ? 1 : i.hasBody ? 0.3 : 0.6)
      : i.intent === "emphasis" ? 0.55 : 0.2,
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    const boxH = Math.min(sb.h, Math.round(H * MAX_BLOCK_H));
    const headBox: FitBox = { x: sb.x, y: sb.y, w: sb.w, h: boxH };
    const fit = fitTextToBox(
      ctx.fields.keyword ?? "", headBox.w, headBox.h, 800,
      rolePx("hero", W, H), floorPxFor("display", W, H), LINE_H_DISPLAY,
    );
    const head = alignedTextNodes(fit, headBox, "left", win.start, win.dur, ctx.fill, {
      weight: 800, accent: ctx.palette.accent, span: ctx.beat.accent_span,
    });

    const body = ctx.fields.body;
    if (!body) return head;

    const headTop = headBox.y + Math.max(0, Math.round((headBox.h - fit.totalH) / 2));
    const ledeGap = Math.round(tierPx("bodyS", W, H) * 1.4);
    const ledeTop = headTop + fit.totalH + ledeGap;
    const ledeBox: FitBox = {
      x: sb.x, y: ledeTop,
      w: Math.round(sb.w * 0.6), h: Math.max(1, sb.y + sb.h - ledeTop),
    };
    const ledeFit = fitTextToBox(body, ledeBox.w, ledeBox.h, 400, tierPx("bodyS", W, H), tierFloorPx("footnote", W, H), LINE_H_BODY);
    const lede = alignedTextNodes(ledeFit, ledeBox, "left", win.start, win.dur, ctx.fill, { weight: 400 });
    return [...head, ...lede];
  },
};

register(accentHeadline);

// apps/editor/src/persistence/text/representations/editorial-lede.ts
//
// P4 · Tracked accent kicker → large headline → body paragraph, left-aligned
// and stacked by measured height — the "ABOUT THE INSTITUTE / A convening
// body…" block. Wins `title` only when the beat carries a `body`, so it
// never competes with hero-title on a bare title.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { stackByHeight } from "../services/layout";
import { alignedTextNodes } from "../services/nodes";
import { layerWindow } from "../services/timing";

export const editorialLede: TextRepresentation = {
  id: "editorial-lede",
  fields: ["keyword", "body"],
  region: "full",
  supports: (i) => (i.intent === "title" && i.hasBody ? 1 : i.hasBody && i.intent === "caption" ? 0.4 : 0.1),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };

    // Falls back to hud_tag (already populated on every beat) so the kicker
    // line renders on real generations even before anything emits `kicker`
    // directly — an explicit `kicker` always wins.
    const kicker = ctx.beat.kicker ?? ctx.beat.hud_tag;
    const stack = stackByHeight(sb, W, H, [
      { text: kicker, tier: "label", weight: 600, color: ctx.palette.accent, maxWFrac: 0.8 },
      { text: ctx.fields.keyword, tier: "displayM", weight: 700, maxWFrac: 0.85 },
      { text: ctx.fields.body, tier: "bodyL", weight: 400, color: ctx.fill, maxWFrac: 0.62 },
    ]);
    return stack.flatMap((b) =>
      alignedTextNodes(b.fit, b.box, "left", win.start, win.dur, b.color ?? ctx.fill, {
        weight: b.weight, tracking: b.tracking,
      }));
  },
};

register(editorialLede);

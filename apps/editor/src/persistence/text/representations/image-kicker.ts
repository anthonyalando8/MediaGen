// apps/editor/src/persistence/text/representations/image-kicker.ts
//
// P4 · A single tracked, uppercase caption pinned to the bottom-left corner
// over full-bleed imagery — "RESEARCH CAPACITY AT THE CENTRE OF THE
// TRANSITION." The restrained sibling of lower-third: no bar, no fill, just
// a scrim-safe tracked line that lets the picture carry the frame. Scored
// below lower-third (0.8 vs 1) — an opt-in alternative treatment, not a
// replacement, for the same `lower_third` intent.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx, tierTracking } from "../services/type-scale";
import { textNode } from "../services/nodes";
import { layerWindow } from "../services/timing";
import { fadeIn } from "../services/reveal";

export const imageKicker: TextRepresentation = {
  id: "image-kicker",
  fields: ["keyword"],
  region: "corner",
  supports: (i) =>
    i.intent === "lower_third" && !i.hasBody && i.textLayerCount === 1 ? 0.8 : i.intent === "caption" ? 0.3 : 0.1,
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const layer = ctx.textLayers[0];
    const text = layer?.text ?? ctx.fields.keyword;
    if (!text) return [];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: ctx.time.startFrame + ctx.time.durationFrames };

    const fs = tierPx("label", W, H);
    const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.15)));
    return [textNode({
      name: "image-kicker · line", text: text.toUpperCase(),
      x: sb.x, y: Math.round(sb.y + sb.h - fs), fontSize: fs, weight: 600,
      align: "left", fill: ctx.fill, tracking: tierTracking("label", fs) * 2,
      start: win.start, duration: win.dur, ...fadeIn(win.start, entF),
    })];
  },
};

register(imageKicker);

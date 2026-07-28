// apps/editor/src/persistence/text/representations/lower-third.ts
//
// P1 · Broadcast lower-third chyron. Verbatim `lowerThirdNodes`. Note: the
// existing compiler builds lower-thirds from the `lower_third`-ROLE layer in
// its layer loop; this module lets that also be driven through the registry
// (see INTEGRATION.md) and enables `text_intent: "lower_third"` on a text
// layer. Reads the text from the first text/lower_third layer.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { lowerThirdNodes } from "../services/nodes";
import { layerWindow } from "../services/timing";

export const lowerThird: TextRepresentation = {
  id: "lower-third",
  fields: ["keyword"],
  region: "lower",
  supports: (i) => (i.intent === "lower_third" ? 1 : i.archetype === "lower_third" ? 0.8 : 0.1),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const layer = ctx.textLayers[0];
    const text = layer?.text ?? ctx.fields.keyword;
    if (!text) return [];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: ctx.time.startFrame + ctx.time.durationFrames };
    return lowerThirdNodes(text, win.start, win.dur, W, H, ctx.palette.fg, ctx.palette.accent);
  },
};

register(lowerThird);

// apps/editor/src/persistence/text/representations/definition-card.ts
//
// P3 · Definition card — an eyebrow ("DEFINITION"), the headword, a rule, and
// the gloss. Reads `term` (falls back to keyword) + `body`. New module: added
// with ZERO edits to the compiler or selector.

import type { ColorOKLCH, Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierPx, tierTracking } from "../services/type-scale";
import { fitTextToBox, LINE_H_BODY } from "../services/layout";
import { textNode, rectNode } from "../services/nodes";
import { layerWindow } from "../services/timing";
import { fadeRise, fadeIn } from "../services/reveal";

export const definitionCard: TextRepresentation = {
  id: "definition-card",
  fields: ["term", "body"],
  region: "full",
  supports: (i) => (i.intent === "definition" ? 1 : 0),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const layer = ctx.textLayers[0];
    const win = layer
      ? layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps)
      : { start: ctx.time.startFrame, dur: ctx.time.durationFrames, end: 0 };
    const term = ctx.fields.term ?? "";
    const gloss = ctx.fields.body ?? "";
    const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.15)));

    const eyebrowFs = tierPx("label", W, H);
    const termFs = tierPx("headingXl", W, H);
    const glossFs = tierPx("bodyL", W, H);
    const glossFit = fitTextToBox(gloss, sb.w, Math.round(sb.h * 0.4), 400, glossFs, tierPx("bodyS", W, H), LINE_H_BODY);

    const blockH = eyebrowFs * 1.8 + termFs * 1.2 + 24 + glossFit.totalH;
    let y = Math.round(H * 0.5 - blockH / 2);
    const x = sb.x;
    const out: Node[] = [];

    out.push(textNode({
      name: "def · eyebrow", text: "DEFINITION", x, y, fontSize: eyebrowFs, weight: 600,
      align: "left", fill: ctx.palette.accent, start: win.start, duration: win.dur,
      tracking: tierTracking("label", eyebrowFs), ...fadeIn(win.start, entF),
    }));
    y += Math.round(eyebrowFs * 1.8);

    out.push(textNode({
      name: "def · term", text: term, x, y, fontSize: termFs, weight: 700,
      align: "left", fill: ctx.fill, start: win.start, duration: win.dur,
      ...fadeRise(win.start, entF, x, y, Math.round(H * 0.02)),
    }));
    y += Math.round(termFs * 1.2);

    const rule: ColorOKLCH = ctx.palette.accent;
    out.push(rectNode({
      name: "def · rule", x, y: y + 6, w: Math.round(sb.w), h: Math.max(1, Math.round(Math.min(W, H) * 0.0015)),
      fill: rule, opacity: 0.4, start: win.start, duration: win.dur, fadeF: entF,
    }));
    y += 24;

    glossFit.lines.forEach((ln, li) => {
      out.push(textNode({
        name: `def · gloss ${li + 1}`, text: ln.text, x, y: y + li * glossFit.lineH,
        fontSize: glossFit.fs, weight: 400, align: "left", fill: ctx.fill,
        start: win.start, duration: win.dur, ...fadeIn(win.start, entF),
      }));
    });
    return out;
  },
};

register(definitionCard);

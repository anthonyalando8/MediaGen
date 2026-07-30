// apps/editor/src/persistence/text/representations/definition-card.ts
//
// P3 · Definition card — an eyebrow ("DEFINITION"), the headword, a rule, and
// the gloss. Reads `term` (falls back to keyword) + `body`.
//
// FIX (P4): the `term` used to go to `textNode` UNWRAPPED (a long headword ran
// off the right edge) and the block was centered with an unclamped `blockH`
// (a tall gloss shoved the eyebrow above the safe top). Now the eyebrow, term
// and gloss are fit + measured + shrink-to-fit as one stack via `stackRows`,
// and the rule is drawn in the measured gap between term and gloss.

import type { ColorOKLCH, Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { tierTracking } from "../services/type-scale";
import { stackRows, LINE_H_BODY, type RowSpec } from "../services/layout";
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
    const term = (ctx.fields.term ?? "").trim();
    const gloss = (ctx.fields.body ?? "").trim();
    const entF = Math.min(10, Math.max(4, Math.round(win.dur * 0.15)));

    const rows: RowSpec[] = [
      { text: "DEFINITION", weight: 600, tier: "label", floorTier: "footnote", maxWFrac: 0.9 },
      { text: term, weight: 700, tier: "headingXl", floorTier: "headingM", maxWFrac: 1, lineHeightRatio: 1.06 },
      { text: gloss, weight: 400, tier: "bodyL", floorTier: "bodyS", maxWFrac: 0.9, lineHeightRatio: LINE_H_BODY },
    ].filter((r) => r.text.length > 0) as RowSpec[];
    if (!rows.length) return [];

    const placed = stackRows(sb, W, H, rows, { gapFrac: 0.55 });
    const out: Node[] = [];

    // The eyebrow (fadeIn) is the first placed row IFF the eyebrow row exists —
    // it always does here since "DEFINITION" is constant.
    placed.forEach((row, ri) => {
      const isEyebrow = ri === 0;
      const isTerm = ri === 1;
      const fill = isEyebrow ? ctx.palette.accent : ctx.fill;
      row.fit.lines.forEach((ln, li) => {
        const ly = row.y + li * row.fit.lineH;
        out.push(textNode({
          name: `def · ${isEyebrow ? "eyebrow" : isTerm ? "term" : "gloss"} ${li + 1}`,
          text: ln.text, x: row.x, y: ly, fontSize: row.fit.fs,
          weight: isEyebrow ? 600 : isTerm ? 700 : 400, align: "left", fill,
          start: win.start, duration: win.dur,
          tracking: isEyebrow ? tierTracking("label", row.fit.fs) : 0,
          ...(isTerm ? fadeRise(win.start, entF, row.x, ly, Math.round(H * 0.02)) : fadeIn(win.start, entF)),
        }));
      });
    });

    // Rule sits in the gap between term (row 1) and gloss (row 2), if both present.
    if (placed.length >= 3) {
      const termRow = placed[1];
      const glossRow = placed[2];
      const ruleY = Math.round((termRow.y + termRow.h + glossRow.y) / 2);
      out.push(rectNode({
        name: "def · rule", x: sb.x, y: ruleY, w: Math.round(sb.w), h: Math.max(1, Math.round(Math.min(W, H) * 0.0015)),
        fill: ctx.palette.accent as ColorOKLCH, opacity: 0.4, start: win.start, duration: win.dur, fadeF: entF,
      }));
    }
    return out;
  },
};

register(definitionCard);

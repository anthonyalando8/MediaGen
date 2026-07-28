// apps/editor/src/persistence/text/representations/word-caption.ts
//
// P1 · Word-synced caption — the body block extracted from buildBeatGroup.
// Per-word text nodes in the bottom band, each highlighting (fg→spike→fg) and
// revealing (dim→full) as it is spoken; emphasis words held in spike with a
// scale pop. This is the module that replaces buildBeatGroup's body in P4;
// it is also the target of `text_intent: "caption"`.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { measureText, spaceWidth, normWord } from "../services/measure";
import { rolePx, floorPxFor } from "../services/type-scale";
import { fitTextToBox, LINE_H_BODY } from "../services/layout";
import { textNode } from "../services/nodes";

interface DisplayWord { text: string; emphasis: boolean; }

function parseBody(body: string): DisplayWord[] {
  const clean = body.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const tokens = clean.split(/\s+/).filter(Boolean);
  return tokens.map((tok) => ({
    text: tok.replace(/\*/g, ""),
    emphasis: /^\*.*\*$/.test(tok) || tok.startsWith("*") || tok.endsWith("*"),
  }));
}

function buildWordCaption(ctx: TextBuildContext): Node[] {
  const body = ctx.fields.body;
  if (!body) return [];
  const { W, H, fps } = ctx.frame;
  const startFrame = ctx.time.startFrame;
  const durationFrames = ctx.time.durationFrames;
  const beat = ctx.beat;
  const { fg, spike } = ctx.palette;

  const margin = Math.round(W * 0.08);
  const colWidth = W - margin * 2;
  const align: "left" | "center" | "right" =
    beat.layout === "center" || beat.layout === "full" ? "center" : beat.layout === "right" ? "right" : "left";
  const alignX = (lineWidth: number): number =>
    align === "center" ? (W - lineWidth) / 2 : align === "right" ? W - margin - lineWidth : margin;

  const words = parseBody(body);
  const bandTop = Math.round(H * 0.58);
  const bandBottom = Math.round(H * 0.90);
  const bodyBox = { x: margin, y: bandTop, w: colWidth, h: bandBottom - bandTop };
  const bodyPlain = words.map((dw) => dw.text).join(" ");
  const bodyFit = fitTextToBox(
    bodyPlain, bodyBox.w, bodyBox.h, 600,
    rolePx("caption", W, H), floorPxFor("caption", W, H), LINE_H_BODY,
  );
  const fs = bodyFit.fs;
  const lineH = bodyFit.lineH;
  const bodyTop = bodyBox.y;
  if (!bodyFit.fits) console.warn(`[text] caption overflow on ${beat.id ?? "beat"} — fit at floor ${fs}px`);
  const space = spaceWidth(fs, 600);

  // Match words → word_times (pointer advance, skipping spillover).
  const wt = beat.word_times ?? [];
  let wtPtr = 0;
  const emphasisSet = new Set((beat.emphasis_times ?? []).map((e) => normWord(e.text)));

  interface WordBox { text: string; width: number; emphasis: boolean; startAbs?: number; endAbs?: number; }
  const lines: WordBox[][] = [];
  let line: WordBox[] = [];
  let lineWidth = 0;
  for (const dw of words) {
    const wWidth = measureText(dw.text, fs, dw.emphasis ? 700 : 600);
    if (line.length > 0 && lineWidth + space + wWidth > colWidth) {
      lines.push(line); line = []; lineWidth = 0;
    }
    const norm = normWord(dw.text);
    let startAbs: number | undefined;
    let endAbs: number | undefined;
    for (let p = wtPtr; p < wt.length; p++) {
      if (normWord(wt[p].text) === norm) {
        startAbs = startFrame + Math.round(wt[p].start_s * fps);
        endAbs = startFrame + Math.round(wt[p].end_s * fps);
        wtPtr = p + 1;
        break;
      }
    }
    const emphasis = dw.emphasis || emphasisSet.has(norm);
    line.push({ text: dw.text, width: wWidth, emphasis, startAbs, endAbs });
    lineWidth += (line.length > 1 ? space : 0) + wWidth;
  }
  if (line.length > 0) lines.push(line);

  const out: Node[] = [];
  lines.forEach((ln, li) => {
    const totalW = ln.reduce((sum, w, i) => sum + w.width + (i > 0 ? space : 0), 0);
    let x = alignX(totalW);
    const y = bodyTop + li * lineH;
    for (const w of ln) {
      const baseFill = w.emphasis ? spike : fg;
      const fillChannel =
        !w.emphasis && w.startAbs !== undefined && w.endAbs !== undefined
          ? { keys: [
              { frame: w.startAbs, value: fg },
              { frame: w.startAbs + 2, value: spike },
              { frame: Math.max(w.startAbs + 3, w.endAbs), value: fg },
            ] }
          : undefined;
      const opacityKeys =
        w.startAbs !== undefined
          ? [
              { frame: startFrame, value: 0.45 },
              { frame: Math.max(startFrame, w.startAbs - 1), value: 0.45 },
              { frame: w.startAbs + 2, value: 1 },
            ]
          : undefined;
      const scaleKeys =
        w.emphasis && w.startAbs !== undefined
          ? [
              { frame: w.startAbs, value: { x: 1, y: 1 } },
              { frame: w.startAbs + 2, value: { x: 1.08, y: 1.08 } },
              { frame: w.startAbs + 9, value: { x: 1, y: 1 } },
            ]
          : undefined;
      out.push(textNode({
        name: `${beat.id ?? "beat"} · ${w.text}`,
        text: w.text, x, y, fontSize: fs, weight: w.emphasis ? 700 : 600,
        align: "left", fill: baseFill, start: startFrame, duration: durationFrames,
        fillChannel, opacityKeys, scaleKeys,
      }));
      x += w.width + space;
    }
  });
  return out;
}

export const wordCaption: TextRepresentation = {
  id: "word-caption",
  fields: ["body"],
  region: "band",
  supports: (i) => (i.intent === "caption" ? 1 : i.hasWordTimes ? 0.5 : 0.3),
  build: buildWordCaption,
};

register(wordCaption);

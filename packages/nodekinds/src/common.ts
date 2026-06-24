// packages/nodekinds/src/common.ts
//
// Small helpers shared across the five Phase 1 NodeKinds (Deliverable 10).
// Kept here instead of depending on the `schema` package, so `nodekinds`
// stays on its declared dependency set (core, contract, zod) per §2.1.

import { z } from "zod";
import type { ColorOKLCH, GlyphRun } from "contract";
import type { Frame } from "core";
import type { Node, Scalar } from "core";

/** Zod mirror of ColorOKLCH (Deliverable 05.1), local to avoid depending on `schema`. */
export const ColorOKLCHSchema = z.object({
  l: z.number(),
  c: z.number(),
  h: z.number(),
  alpha: z.number().optional(),
});

export const WHITE: ColorOKLCH = { l: 1, c: 0, h: 0 };
export const BLACK: ColorOKLCH = { l: 0, c: 0, h: 0 };

/**
/**
 * Lays out `props.spans` (rich text) or `props.text` (plain text fallback)
 * into a flat array of `GlyphRun`s — one per span segment per line.
 *
 * Line breaks within a span's text produce new GlyphRuns on successive y
 * positions. Each span's style overrides the node-level defaults for just
 * that run, enabling per-word bold/italic/color/size without changing the
 * rest of the paragraph.
 *
 * Backwards-compatible: if `props.spans` is absent, falls back to splitting
 * `props.text` by "\n" exactly as before.
 */
export function layout(props: Record<string, Scalar>): GlyphRun[] {
  const fontFamily = String(props.fontFamily ?? "Inter");
  const fontSize = Number(props.fontSize ?? 64);
  const weight = Number(props.weight ?? 400);
  const lineHeight = Number(props.lineHeight ?? 1.2);
  const color = (props.fill as ColorOKLCH | undefined) ?? WHITE;

  // --- Rich text path ---
  const spans = props.spans as unknown as import("core").TextSpan[] | undefined;
  if (spans && Array.isArray(spans) && spans.length > 0) {
    const runs: GlyphRun[] = [];
    let lineIndex = 0;

    for (const span of spans) {
      const lines = span.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) lineIndex++; // each \n advances to the next line
        const lineText = lines[i];
        if (lineText === "") continue; // skip empty segments (pure line breaks)
        runs.push({
          text: lineText,
          x: 0,
          y: lineIndex * fontSize * lineHeight,
          fontFamily: span.fontFamily ?? fontFamily,
          fontSize: span.fontSize ?? fontSize,
          weight: span.weight ?? weight,
          color: span.color ?? color,
          italic: span.italic,
          underline: span.underline,
        });
      }
    }
    return runs;
  }

  // --- Plain text fallback ---
  const text = String(props.text ?? "");
  return text.split("\n").map((line, i) => ({
    text: line,
    x: 0,
    y: i * fontSize * lineHeight,
    fontFamily,
    fontSize,
    weight,
    color,
  }));
}

/**
 * Maps a timeline `frame` to the source-media frame to display, per the
 * node's `time.in` trim (Deliverable 10, video kind: "maps timeline frame →
 * source frame via trim"). `time.in` defaults to 0 (no trim).
 */
export function srcFrame(node: Node, frame: Frame): number {
  const inPoint = (node.time.in as number | undefined) ?? 0;
  return inPoint + ((frame as number) - (node.time.start as number));
}
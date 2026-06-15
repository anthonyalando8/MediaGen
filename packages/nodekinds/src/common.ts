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
 * Lays out `props.text` into one GlyphRun per line, stacked by
 * `fontSize * lineHeight`. This is intentionally minimal for Phase 1: real
 * shaping/measurement (for `align`, `tracking`, and wrapping) needs font
 * metrics that only the renderer has (Pixi's TextMetrics, Week 5) — the
 * renderer-webgl scene-graph adapter is expected to re-flow these runs using
 * `align`/`tracking` from `props` once it owns a loaded font.
 */
export function layout(props: Record<string, Scalar>): GlyphRun[] {
  const text = String(props.text ?? "");
  const fontFamily = String(props.fontFamily ?? "Inter");
  const fontSize = Number(props.fontSize ?? 64);
  const weight = Number(props.weight ?? 400);
  const lineHeight = Number(props.lineHeight ?? 1.2);
  const color = (props.fill as ColorOKLCH | undefined) ?? WHITE;

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
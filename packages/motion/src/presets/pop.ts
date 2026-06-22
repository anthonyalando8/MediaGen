import { createId, toFrame } from "core";
import type { Channel } from "core";
import type { MotionCtx, MotionPreset } from "../types";

export function pop(ctx: MotionCtx, options: Record<string, number | string> = {}): Channel[] {
  const overshoot = (options.overshoot as number) ?? 1.2;
  const settle    = (options.settle as number) ?? 0.6;   // fraction of span where it settles
  const { span, transform } = ctx;
  const s = span.start as number;
  const d = span.duration as number;
  const sx = transform.scale.x;
  const sy = transform.scale.y;

  return [{
    id: createId(), path: "transform.scale", type: "vec2",
    keys: [
      { frame: toFrame(s),                          value: { x: 0, y: 0 },                 interp: "bezier", outHandle: [0.2, 0.0] },
      { frame: toFrame(s + Math.round(d * 0.3)),    value: { x: sx * overshoot, y: sy * overshoot }, interp: "bezier", outHandle: [0.5, 1.0], inHandle: [0.5, 0.0] },
      { frame: toFrame(s + Math.round(d * settle)), value: { x: sx, y: sy },                interp: "hold" },
    ],
  }];
}

export const popPreset: MotionPreset = {
  id: "pop",
  label: "Pop",
  controls: [
    { type: "number", key: "overshoot", label: "Overshoot", default: 1.2, min: 1.0, max: 2.0, step: 0.05 },
    { type: "number", key: "settle",    label: "Settle at", default: 0.6, min: 0.3, max: 0.9, step: 0.05 },
  ],
  build: (opts) => (ctx) => pop(ctx, opts),
};

import { createId, toFrame } from "core";
import type { Channel } from "core";
import type { MotionCtx, MotionPreset } from "../types";

export function slamPunch(ctx: MotionCtx, options: Record<string, number | string> = {}): Channel[] {
  const distance = (options.distance as number) ?? 0.3;  // fraction of comp height
  const impact   = (options.impact as number)   ?? 0.15; // fraction of span for the slam
  const { span, size, transform } = ctx;
  const s = span.start as number;
  const d = span.duration as number;
  const px = transform.position.x;
  const py = transform.position.y;
  const sx = transform.scale.x;
  const sy = transform.scale.y;

  return [
    {
      id: createId(), path: "transform.position", type: "vec3",
      keys: [
        { frame: toFrame(s),                             value: { x: px, y: py - size.height * distance, z: 0 }, interp: "bezier", outHandle: [0.1, 0.0] },
        { frame: toFrame(s + Math.round(d * impact)),    value: { x: px, y: py + 8,  z: 0 }, interp: "bezier", outHandle: [0.5, 1.0], inHandle: [0.5, 0.0] },
        { frame: toFrame(s + Math.round(d * impact * 1.7)), value: { x: px, y: py - 4, z: 0 }, interp: "bezier", outHandle: [0.5, 1.0], inHandle: [0.5, 0.0] },
        { frame: toFrame(s + Math.round(d * impact * 2.4)), value: { x: px, y: py, z: 0 }, interp: "hold" },
      ],
    },
    {
      id: createId(), path: "transform.scale", type: "vec2",
      keys: [
        { frame: toFrame(s),                          value: { x: sx, y: sy },                    interp: "bezier", outHandle: [0.1, 0.0] },
        { frame: toFrame(s + Math.round(d * impact)), value: { x: sx * 1.05, y: sy * 0.95 }, interp: "bezier", outHandle: [0.5, 1.0], inHandle: [0.5, 0.0] },
        { frame: toFrame(s + Math.round(d * impact * 2.4)), value: { x: sx, y: sy },          interp: "hold" },
      ],
    },
  ];
}

export const slamPunchPreset: MotionPreset = {
  id: "slamPunch",
  label: "Slam Punch",
  controls: [
    { type: "number", key: "distance", label: "Slide distance", default: 0.3, min: 0.05, max: 1.0, step: 0.05 },
    { type: "number", key: "impact",   label: "Impact speed",   default: 0.15, min: 0.05, max: 0.4, step: 0.05 },
  ],
  build: (opts) => (ctx) => slamPunch(ctx, opts),
};
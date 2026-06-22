import { createId, toFrame } from "core";
import type { Channel } from "core";
import type { MotionCtx, MotionPreset } from "../types";

export function parallax(ctx: MotionCtx, options: Record<string, number | string> | number = {}): Channel[] {
  // Accept legacy numeric depth arg OR options object
  const opts = typeof options === "number" ? { depth: options } : options;
  const depth     = (opts.depth as number)     ?? 0.5;
  const direction = (opts.direction as string) ?? "horizontal";

  const { span, size, transform } = ctx;
  const s = span.start as number;
  const end = s + (span.duration as number);
  const drift = size.width * 0.1 * depth;
  const px = transform.position.x;
  const py = transform.position.y;

  return [{
    id: createId(), path: "transform.position", type: "vec3",
    keys: [
      { frame: toFrame(s),   value: { x: direction === "vertical" ? px : px + drift, y: direction === "vertical" ? py + drift : py, z: 0 }, interp: "linear" },
      { frame: toFrame(end), value: { x: direction === "vertical" ? px : px - drift, y: direction === "vertical" ? py - drift : py, z: 0 }, interp: "linear" },
    ],
  }];
}

export const parallaxPreset: MotionPreset = {
  id: "parallax",
  label: "Parallax",
  controls: [
    { type: "number", key: "depth",     label: "Depth",     default: 0.5, min: 0.1, max: 1.0, step: 0.1 },
    { type: "select", key: "direction", label: "Direction", default: "horizontal",
      options: [{ value: "horizontal", label: "Horizontal" }, { value: "vertical", label: "Vertical" }] },
  ],
  build: (opts) => (ctx) => parallax(ctx, opts),
};
import { createId, toFrame } from "core";
import type { Channel } from "core";
import type { MotionCtx, MotionPreset } from "../types";

export function kenBurns(ctx: MotionCtx, options: Record<string, number | string> = {}): Channel[] {
  const scale = (options.scale as number) ?? 1.15;
  const direction = (options.direction as string) ?? "in";
  const easing = (options.easing as string) ?? "ease-in-out";

  const { span, transform } = ctx;
  const start = span.start as number;
  const end = start + (span.duration as number);
  const sx = transform.scale.x;
  const sy = transform.scale.y;
  const px = transform.position.x;
  const py = transform.position.y;

  const handle: [number, number] = easing === "linear" ? [0.5, 0.5]
    : easing === "ease-in" ? [0.42, 0.0]
    : easing === "ease-out" ? [0.0, 0.58]
    : [0.42, 0.0]; // ease-in-out out handle; in handle below

  const inH: [number, number] = easing === "linear" ? [0.5, 0.5]
    : easing === "ease-in" ? [1.0, 1.0]
    : easing === "ease-out" ? [0.58, 1.0]
    : [0.58, 1.0];

  const startScale = direction === "in" ? { x: sx, y: sy } : { x: sx * scale, y: sy * scale };
  const endScale   = direction === "in" ? { x: sx * scale, y: sy * scale } : { x: sx, y: sy };

  return [
    {
      id: createId(), path: "transform.scale", type: "vec2",
      keys: [
        { frame: toFrame(start), value: startScale, interp: "bezier", outHandle: handle },
        { frame: toFrame(end),   value: endScale,   interp: "bezier", inHandle: inH },
      ],
    },
    {
      id: createId(), path: "transform.position", type: "vec3",
      keys: [
        { frame: toFrame(start), value: { x: px,      y: py,      z: 0 }, interp: "bezier", outHandle: handle },
        { frame: toFrame(end),   value: { x: px - 20, y: py - 10, z: 0 }, interp: "bezier", inHandle: inH },
      ],
    },
  ];
}

export const kenBurnsPreset: MotionPreset = {
  id: "kenBurns",
  label: "Ken Burns",
  controls: [
    { type: "number", key: "scale", label: "Scale", default: 1.15, min: 1.0, max: 2.0, step: 0.05 },
    { type: "select", key: "direction", label: "Direction", default: "in",
      options: [{ value: "in", label: "Zoom In" }, { value: "out", label: "Zoom Out" }] },
    { type: "select", key: "easing", label: "Easing", default: "ease-in-out",
      options: [
        { value: "linear", label: "Linear" },
        { value: "ease-in", label: "Ease In" },
        { value: "ease-out", label: "Ease Out" },
        { value: "ease-in-out", label: "Ease In-Out" },
      ]},
  ],
  build: (opts) => (ctx) => kenBurns(ctx, opts),
};
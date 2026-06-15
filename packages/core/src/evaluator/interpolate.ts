// packages/core/src/evaluator/interpolate.ts
//
// Per-ChannelType keyframe interpolation (Deliverable 07). `interpolate`
// finds the keyframe segment containing `frame`, applies the outgoing
// keyframe's `interp` mode (hold/linear/bezier), and mixes the two
// keyframe values per `channel.type`.

import type { ChannelType, Channel } from "../types/channel";
import type { ChannelValue, Keyframe } from "../types/keyframe";
import type { ColorOKLCH, PathData, Vec2, Vec3 } from "../types/primitives";
import type { Frame } from "../types/ids";

const DEFAULT_OUT_HANDLE: [number, number] = [1 / 3, 1 / 3];
const DEFAULT_IN_HANDLE: [number, number] = [2 / 3, 2 / 3];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lerps an angle (degrees) along its shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  const delta = (((b - a) % 360) + 540) % 360 - 180; // in (-180, 180]
  return a + delta * t;
}

/** Cubic Bezier component for control points p1/p2, with implicit P0=0, P3=1. */
export function bezierComponent(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierComponentDerivative(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/**
 * Solves cubic-bezier(x1,y1,x2,y2) for the eased progress `y` given a linear
 * progress `x`, via Newton-Raphson on the X component (8 iterations,
 * clamped each step — sufficient for the monotonic-in-x curves produced by
 * timeline tangent handles).
 */
export function solveBezier(outHandle: [number, number], inHandle: [number, number], x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1] = outHandle;
  const [x2, y2] = inHandle;
  let u = x;
  for (let i = 0; i < 8; i++) {
    const fx = bezierComponent(u, x1, x2) - x;
    const dfx = bezierComponentDerivative(u, x1, x2);
    if (Math.abs(dfx) < 1e-6) break;
    const next = u - fx / dfx;
    if (!Number.isFinite(next)) break;
    u = Math.min(1, Math.max(0, next));
  }
  return bezierComponent(u, y1, y2);
}

/** Mixes two channel values of `type` at progress `t` (0..1). */
export function mixValue<V extends ChannelValue>(type: ChannelType, a: V, b: V, t: number): V {
  switch (type) {
    case "scalar":
      return lerp(a as number, b as number, t) as V;
    case "angle":
      return lerpAngle(a as number, b as number, t) as V;
    case "vec2": {
      const av = a as Vec2;
      const bv = b as Vec2;
      return { x: lerp(av.x, bv.x, t), y: lerp(av.y, bv.y, t) } as V;
    }
    case "vec3": {
      const av = a as Vec3;
      const bv = b as Vec3;
      return { x: lerp(av.x, bv.x, t), y: lerp(av.y, bv.y, t), z: lerp(av.z, bv.z, t) } as V;
    }
    case "color": {
      const ac = a as ColorOKLCH;
      const bc = b as ColorOKLCH;
      const alpha =
        ac.alpha === undefined && bc.alpha === undefined
          ? undefined
          : lerp(ac.alpha ?? 1, bc.alpha ?? 1, t);
      return {
        l: lerp(ac.l, bc.l, t),
        c: lerp(ac.c, bc.c, t),
        h: lerpAngle(ac.h, bc.h, t),
        ...(alpha === undefined ? {} : { alpha }),
      } as V;
    }
    case "path":
      // P2 — path-typed channels are inert in Phase 1; hold the outgoing value.
      return a as PathData as V;
    default:
      return a;
  }
}

/**
 * Samples `channel` at `frame`. Clamps to the first/last keyframe outside
 * their range; within a segment, applies the outgoing keyframe's `interp`.
 */
export function interpolate<V extends ChannelValue>(channel: Channel<V>, frame: Frame): V {
  const keys = channel.keys;
  if (keys.length === 0) {
    throw new Error(`channel "${channel.path}" has no keyframes`);
  }
  if (keys.length === 1 || frame <= keys[0].frame) {
    return keys[0].value;
  }
  const last = keys[keys.length - 1];
  if (frame >= last.frame) {
    return last.value;
  }

  let k0: Keyframe<V> = keys[0];
  let k1: Keyframe<V> = keys[1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (keys[i].frame <= frame && frame < keys[i + 1].frame) {
      k0 = keys[i];
      k1 = keys[i + 1];
      break;
    }
  }

  if (k0.interp === "hold") {
    return k0.value;
  }

  const span = (k1.frame as number) - (k0.frame as number);
  let t = span === 0 ? 1 : ((frame as number) - (k0.frame as number)) / span;

  if (k0.interp === "bezier") {
    t = solveBezier(k0.outHandle ?? DEFAULT_OUT_HANDLE, k1.inHandle ?? DEFAULT_IN_HANDLE, t);
  }

  return mixValue(channel.type, k0.value, k1.value, t);
}

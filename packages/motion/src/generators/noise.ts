// packages/motion/src/generators/noise.ts
//
// Value noise generator — smooth pseudo-random oscillation.
// Uses a seeded hash to produce repeatable noise values.

import { createId, toFrame } from "core";
import type { Channel } from "core";
import type { MotionCtx } from "../types";

function hash(n: number): number {
  let x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

/** Smooth value noise at position t with seed. */
export function valueNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  // Smoothstep
  const u = f * f * (3 - 2 * f);
  const a = hash(i + seed * 127.1);
  const b = hash(i + 1 + seed * 127.1);
  return a + (b - a) * u;
}

export interface NoiseParams {
  amp: number;   // amplitude (default 1)
  freq: number;  // frequency in cycles per second (default 1)
  seed: number;  // random seed (default 0)
}

/** Returns a scalar Channel with noise generator attached (unbaked). */
export function noise(path: string, params: Partial<NoiseParams> = {}): (ctx: MotionCtx) => Channel[] {
  const { amp = 1, freq = 1, seed = 0 } = params;
  return (ctx: MotionCtx): Channel[] => {
    const channel: Channel<number> = {
      id: createId(),
      path,
      type: "scalar",
      keys: [
        { frame: toFrame(ctx.span.start as number), value: 0, interp: "linear" },
      ],
      generator: {
        id: "noise",
        params: { amp, freq, seed },
        baked: false,
      },
    };
    return [channel as Channel];
  };
}

/** Sample the noise generator at a given time (seconds). */
export function sampleNoise(t: number, params: NoiseParams): number {
  return (valueNoise(t * params.freq, params.seed) * 2 - 1) * params.amp;
}
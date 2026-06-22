// packages/motion/src/generators/spring.ts
//
// Spring generator — simulates a damped spring oscillating from 0→1.
// Returns a Channel with generator metadata and baked=false.
// Call bake() to step it frame-by-frame and write discrete keyframes.

import { createId, toFrame } from "core";
import type { Channel } from "core";
import type { MotionCtx } from "../types";

export interface SpringParams {
  stiffness: number; // spring constant k (e.g. 200)
  damping: number;   // damping coefficient c (e.g. 20)
  mass: number;      // mass (default 1)
}

/** Returns a scalar Channel [0..1] with a spring generator attached (unbaked). */
export function spring(path: string, params: Partial<SpringParams> = {}): (ctx: MotionCtx) => Channel[] {
  const { stiffness = 200, damping = 20, mass = 1 } = params;
  return (ctx: MotionCtx): Channel[] => {
    const channel: Channel<number> = {
      id: createId(),
      path,
      type: "scalar",
      keys: [
        { frame: toFrame(ctx.span.start as number), value: 0, interp: "linear" },
      ],
      generator: {
        id: "spring",
        params: { stiffness, damping, mass },
        baked: false,
      },
    };
    return [channel as Channel];
  };
}

/** Evaluates one spring step using semi-implicit Euler integration. */
export function stepSpring(
  position: number,
  velocity: number,
  target: number,
  dt: number,
  params: SpringParams
): { position: number; velocity: number } {
  const { stiffness, damping, mass } = params;
  const force = -stiffness * (position - target) - damping * velocity;
  const acceleration = force / mass;
  const newVelocity = velocity + acceleration * dt;
  const newPosition = position + newVelocity * dt;
  return { position: newPosition, velocity: newVelocity };
}

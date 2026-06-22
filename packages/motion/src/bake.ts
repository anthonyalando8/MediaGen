// packages/motion/src/bake.ts
//
// Phase 2 §9.1 — bake(channel, span, fps): converts a procedural generator
// channel into a fully discrete keyframe channel by stepping at dt=1/fps.
// "The generator stays on the channel {id,params,baked:true} so the user
// can re-dial + re-bake." — blueprint §9.1

import { toFrame } from "core";
import type { Channel, TimeSpan } from "core";
import { stepSpring } from "./generators/spring";
import { sampleNoise } from "./generators/noise";
import type { SpringParams } from "./generators/spring";
import type { NoiseParams } from "./generators/noise";

/**
 * Bakes a generator channel into discrete keyframes, stepping at `dt=1/fps`.
 * Returns a NEW Channel with `keys[]` fully populated and `generator.baked=true`.
 * The original channel is not mutated — consistent with the evaluator's pure convention.
 *
 * Supported generators: "spring", "noise".
 * Unknown generators return the channel unchanged.
 */
export function bake(channel: Channel, span: TimeSpan, fps: number): Channel {
  if (!channel.generator || channel.generator.baked) return channel;

  const start = span.start as number;
  const duration = span.duration as number;
  const dt = 1 / fps;
  const keys: Channel["keys"] = [];

  if (channel.generator.id === "spring") {
    const params = channel.generator.params as unknown as SpringParams;
    let position = 0;
    let velocity = 0;
    for (let i = 0; i <= duration; i++) {
      keys.push({ frame: toFrame(start + i), value: position, interp: "linear" });
      const next = stepSpring(position, velocity, 1.0, dt, params);
      position = next.position;
      velocity = next.velocity;
    }
  } else if (channel.generator.id === "noise") {
    const params = channel.generator.params as unknown as NoiseParams;
    for (let i = 0; i <= duration; i++) {
      const t = i / fps;
      keys.push({ frame: toFrame(start + i), value: sampleNoise(t, params), interp: "linear" });
    }
  } else {
    return channel; // unknown generator — leave unchanged
  }

  return {
    ...channel,
    keys,
    generator: { ...channel.generator, baked: true },
  };
}
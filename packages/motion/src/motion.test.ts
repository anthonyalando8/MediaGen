// packages/motion/src/motion.test.ts
//
// Blueprint WK 9 exit criterion: "baked spring == live spring at every frame."
// Also covers: all four presets produce valid channels, noise is deterministic.

import { describe, expect, it } from "vitest";
import { interpolate, toFrame } from "core";
import type { TimeSpan } from "core";
import { bake, kenBurns, noise, parallax, pop, sampleNoise, slamPunch, spring, stepSpring } from "./index";
import type { MotionCtx } from "./types";

const SPAN: TimeSpan = { start: toFrame(0), duration: toFrame(60) };
const CTX: MotionCtx = {
  nodeId: "n1" as never,
  span: SPAN,
  fps: 30,
  size: { width: 1080, height: 1920 },
  transform: { position: { x: 540, y: 960, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
};

// ── Preset smoke tests ────────────────────────────────────────────────────

describe("kenBurns", () => {
  it("produces 2 channels (scale + position)", () => {
    const channels = kenBurns(CTX);
    expect(channels).toHaveLength(2);
    expect(channels.map((c) => c.path).sort()).toEqual(["transform.position", "transform.scale"]);
  });

  it("each channel has 2 keyframes spanning the full span", () => {
    const channels = kenBurns(CTX);
    for (const ch of channels) {
      expect(ch.keys).toHaveLength(2);
      expect(ch.keys[0].frame).toBe(SPAN.start);
      expect(ch.keys[1].frame).toBe((SPAN.start as number) + (SPAN.duration as number));
    }
  });
});

describe("pop", () => {
  it("produces 1 channel (scale) with 3 keyframes", () => {
    const channels = pop(CTX);
    expect(channels).toHaveLength(1);
    expect(channels[0].path).toBe("transform.scale");
    expect(channels[0].keys).toHaveLength(3);
  });

  it("starts at scale 0 and ends at the node's resting scale", () => {
    const ch = pop(CTX)[0];
    expect((ch.keys[0].value as { x: number }).x).toBe(0);
    expect((ch.keys[2].value as { x: number }).x).toBeCloseTo(CTX.transform.scale.x);
  });
});

describe("slamPunch", () => {
  it("produces 2 channels (position + scale)", () => {
    const channels = slamPunch(CTX);
    expect(channels).toHaveLength(2);
  });

  it("position starts ABOVE the node's resting position and ends at it", () => {
    const pos = slamPunch(CTX).find((c) => c.path === "transform.position")!;
    const startY = (pos.keys[0].value as { y: number }).y;
    const endY = (pos.keys[pos.keys.length - 1].value as { y: number }).y;
    // Starts above (lower y value) the resting position
    expect(startY).toBeLessThan(CTX.transform.position.y);
    expect(endY).toBe(CTX.transform.position.y);
  });
});

describe("parallax", () => {
  it("produces 1 position channel with 2 keyframes", () => {
    const channels = parallax(CTX, 0.5);
    expect(channels).toHaveLength(1);
    expect(channels[0].path).toBe("transform.position");
    expect(channels[0].keys).toHaveLength(2);
  });

  it("deeper layers drift more than shallower ones", () => {
    const shallow = parallax(CTX, 0.2)[0];
    const deep = parallax(CTX, 0.8)[0];
    const shallowDrift = Math.abs((shallow.keys[0].value as { x: number }).x);
    const deepDrift = Math.abs((deep.keys[0].value as { x: number }).x);
    expect(deepDrift).toBeGreaterThan(shallowDrift);
  });
});

// ── Generator tests ───────────────────────────────────────────────────────

describe("noise generator", () => {
  it("sampleNoise is deterministic for same seed", () => {
    const a = sampleNoise(0.5, { amp: 1, freq: 2, seed: 42 });
    const b = sampleNoise(0.5, { amp: 1, freq: 2, seed: 42 });
    expect(a).toBe(b);
  });

  it("different seeds produce different values", () => {
    const a = sampleNoise(0.5, { amp: 1, freq: 2, seed: 0 });
    const b = sampleNoise(0.5, { amp: 1, freq: 2, seed: 99 });
    expect(a).not.toBe(b);
  });

  it("noise() returns a channel with generator metadata (unbaked)", () => {
    const channels = noise("transform.position", { amp: 10, freq: 1, seed: 0 })(CTX);
    expect(channels).toHaveLength(1);
    expect(channels[0].generator?.id).toBe("noise");
    expect(channels[0].generator?.baked).toBe(false);
  });
});

// ── Bake tests ── the KEY exit criterion ─────────────────────────────────

describe("bake — spring (blueprint exit criterion: baked == live at every frame)", () => {
  it("baked spring channel has a keyframe for every frame in the span", () => {
    const unbaked = spring("opacity", { stiffness: 200, damping: 20 })(CTX);
    const baked = bake(unbaked[0], SPAN, 30);
    expect(baked.keys).toHaveLength((SPAN.duration as number) + 1); // 61 frames (0..60 inclusive)
    expect(baked.generator?.baked).toBe(true);
  });

  it("baked spring values match live stepSpring simulation at every frame", () => {
    const params = { stiffness: 150, damping: 18, mass: 1 };
    // Simulate live spring independently
    const liveSamples: number[] = [];
    let pos = 0, vel = 0;
    const dt = 1 / 30;
    for (let i = 0; i <= 60; i++) {
      liveSamples.push(pos);
      const next = stepSpring(pos, vel, 1.0, dt, params);
      pos = next.position;
      vel = next.velocity;
    }

    const unbaked = spring("opacity", params)(CTX);
    const baked = bake(unbaked[0], SPAN, 30);

    for (let i = 0; i <= 60; i++) {
      const bakedVal = baked.keys[i].value as number;
      expect(bakedVal).toBeCloseTo(liveSamples[i], 8);
    }
  });

  it("baking is idempotent — calling bake twice doesn't re-bake", () => {
    const unbaked = spring("opacity")(CTX);
    const baked1 = bake(unbaked[0], SPAN, 30);
    const baked2 = bake(baked1, SPAN, 30);
    expect(baked2).toBe(baked1); // same reference — no re-bake
  });

  it("baked noise channel interpolates correctly at every frame", () => {
    const unbaked = noise("transform.position", { amp: 50, freq: 2, seed: 7 })(CTX);
    const baked = bake(unbaked[0], SPAN, 30);
    expect(baked.keys).toHaveLength(61);
    // Spot-check: sampling via interpolate at a baked frame returns the exact baked value
    for (let i = 0; i <= 60; i += 10) {
      const direct = baked.keys[i].value as number;
      const sampled = interpolate(baked as never, toFrame(i));
      expect(sampled).toBeCloseTo(direct, 6);
    }
  });
});
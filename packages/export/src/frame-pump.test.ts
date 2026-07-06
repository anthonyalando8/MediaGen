// packages/export/src/frame-pump.test.ts
import { describe, expect, it, vi } from "vitest";
import { pumpFrames } from "./frame-pump";

describe("pumpFrames", () => {
  it("calls onFrame once per frame, in order, awaiting each before the next", async () => {
    const order: number[] = [];
    const onFrame = vi.fn(async (index: number) => {
      order.push(index);
    });

    await pumpFrames({ frameCount: 5, onFrame, yieldToEventLoop: async () => {} });

    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(onFrame).toHaveBeenCalledTimes(5);
  });

  it("awaits each onFrame call before starting the next (no overlap)", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const onFrame = async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    };

    await pumpFrames({ frameCount: 10, onFrame, yieldToEventLoop: async () => {} });

    expect(maxConcurrent).toBe(1);
  });

  it("yields to the event loop every yieldEvery frames, and always after the last frame", async () => {
    const yieldToEventLoop = vi.fn(async () => {});
    await pumpFrames({ frameCount: 10, onFrame: async () => {}, yieldEvery: 3, yieldToEventLoop });

    // Yields after frame 3, 6, 9, and again after frame 10 (the final frame, even though 10 isn't a multiple of 3).
    expect(yieldToEventLoop).toHaveBeenCalledTimes(4);
  });

  it("reports progress at the same points it yields, with final call reporting completion", async () => {
    const progress: Array<[number, number]> = [];
    await pumpFrames({
      frameCount: 7,
      onFrame: async () => {},
      yieldEvery: 3,
      yieldToEventLoop: async () => {},
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress).toEqual([
      [3, 7],
      [6, 7],
      [7, 7],
    ]);
  });

  it("stops and rejects if onFrame rejects, without calling further frames", async () => {
    const seen: number[] = [];
    const onFrame = async (index: number) => {
      seen.push(index);
      if (index === 2) throw new Error("boom");
    };

    await expect(pumpFrames({ frameCount: 5, onFrame, yieldToEventLoop: async () => {} })).rejects.toThrow("boom");
    expect(seen).toEqual([0, 1, 2]);
  });

  it("does nothing for frameCount 0", async () => {
    const onFrame = vi.fn(async () => {});
    await pumpFrames({ frameCount: 0, onFrame, yieldToEventLoop: async () => {} });
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("rejects a negative frameCount", async () => {
    await expect(pumpFrames({ frameCount: -1, onFrame: async () => {} })).rejects.toThrow();
  });
});
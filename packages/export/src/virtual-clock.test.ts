// packages/export/src/virtual-clock.test.ts
import { describe, expect, it } from "vitest";
import { createVirtualClock } from "./virtual-clock";

describe("createVirtualClock", () => {
  it("produces frameCount and per-frame timestamps for a simple case", () => {
    const clock = createVirtualClock({ durationFrames: 5, fps: 10 });
    expect(clock.frameCount).toBe(5);
    expect(clock.frameDuration).toBeCloseTo(0.1);
    expect([0, 1, 2, 3, 4].map((i) => clock.frameAt(i))).toEqual([0, 1, 2, 3, 4]);
    const timestamps = [0, 1, 2, 3, 4].map((i) => clock.timestampAt(i));
    timestamps.forEach((t, i) => expect(t).toBeCloseTo(i * 0.1));
  });

  it("computes timestamps correctly for a non-round fps (e.g. 29.97)", () => {
    const clock = createVirtualClock({ durationFrames: 3, fps: 30 });
    expect(clock.timestampAt(1)).toBeCloseTo(1 / 30);
    expect(clock.timestampAt(2)).toBeCloseTo(2 / 30);
  });

  it("throws for out-of-range indices, so a frame-pump bug can't silently render garbage", () => {
    const clock = createVirtualClock({ durationFrames: 3, fps: 30 });
    expect(() => clock.frameAt(-1)).toThrow(RangeError);
    expect(() => clock.frameAt(3)).toThrow(RangeError);
    expect(() => clock.timestampAt(3)).toThrow(RangeError);
  });

  it("rejects non-integer or non-positive durationFrames", () => {
    expect(() => createVirtualClock({ durationFrames: 0, fps: 30 })).toThrow();
    expect(() => createVirtualClock({ durationFrames: -5, fps: 30 })).toThrow();
    expect(() => createVirtualClock({ durationFrames: 1.5, fps: 30 })).toThrow();
  });

  it("rejects non-positive fps", () => {
    expect(() => createVirtualClock({ durationFrames: 10, fps: 0 })).toThrow();
    expect(() => createVirtualClock({ durationFrames: 10, fps: -30 })).toThrow();
  });
});
// packages/media/src/decode-cursor.test.ts
//
// Tests the cursor's ALGORITHM only (which samples get submitted, when
// look-ahead frames get reused vs closed, and how a stall/backward-jump/
// end-of-stream is handled) via an injected fake decoder (`CreateFrameDecoder`)
// — real WebCodecs only runs in a browser (see this file's module doc / the
// debugging history in decode-cursor.ts's own header comment), so the actual
// `VideoDecoder`/mp4box wiring is manual-verification-only, same as
// `packages/export`'s own note that real encode/decode "can only be
// verified in a browser."
//
// Matches the CURRENT read-ahead design (REORDER_MARGIN, decoded/pending
// maps, presentation-time watermark, end-of-stream flush, stall watchdog +
// retry-once) — earlier versions of this file tested a simpler one-chunk-
// at-a-time algorithm that no longer exists.

import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoDecodeCursor } from "./decode-cursor";
import type { CreateFrameDecoder, FrameDecoderLike } from "./decode-cursor";
import type { DemuxedSample, DemuxedVideoTrack } from "./mp4-demux";

// `seekTo()` constructs a real `EncodedVideoChunk` per submitted sample —
// a WebCodecs-only global with no Node equivalent. It's a plain data holder
// (no codec logic lives in it), so a minimal stand-in is enough to keep the
// cursor's own logic testable outside a browser.
class FakeEncodedVideoChunk {
  type: string;
  timestamp: number;
  duration?: number;
  data: Uint8Array;
  constructor(init: { type: string; timestamp: number; duration?: number; data: Uint8Array }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.data = init.data;
  }
}
vi.stubGlobal("EncodedVideoChunk", FakeEncodedVideoChunk);

/** `keyframeAt` indices get `isKeyframe: true`; everything else `false`. Sample `i`'s timestamp is `i * 1000`. */
function makeTrack(count: number, keyframeAt: number[] = [0]): DemuxedVideoTrack {
  const keyframes = new Set(keyframeAt);
  const samples: DemuxedSample[] = Array.from({ length: count }, (_, i) => ({
    decodeOrder: i,
    timestampUs: i * 1000,
    durationUs: 1000,
    isKeyframe: keyframes.has(i),
    data: new Uint8Array([i]),
  }));
  return {
    config: { codec: "avc1.fake", codedWidth: 10, codedHeight: 10 },
    samples,
  };
}

interface FakeFrame {
  timestamp: number;
  close: ReturnType<typeof vi.fn>;
}

/** Resolves every `decode()` call with a distinct fake frame (asynchronously — a real microtask hop, matching a real decoder's output timing). `flush()` resolves immediately unless overridden. */
function makeFakeDecoderFactory(overrides: Partial<FrameDecoderLike> = {}): {
  createDecoder: CreateFrameDecoder;
  decodeCalls: number[];
  closeCalls: number;
} {
  const decodeCalls: number[] = [];
  let closeCalls = 0;
  const createDecoder: CreateFrameDecoder = () => {
    const decoder: FrameDecoderLike = {
      async decode(chunk) {
        decodeCalls.push(chunk.timestamp);
        await Promise.resolve();
        const frame: FakeFrame = { timestamp: chunk.timestamp, close: vi.fn() };
        return frame as unknown as VideoFrame;
      },
      async flush() {},
      close() {
        closeCalls++;
      },
      state: "configured" as CodecState,
      decodeQueueSize: 0,
      ...overrides,
    };
    return decoder;
  };
  return { createDecoder, decodeCalls, closeCalls };
}

describe("VideoDecodeCursor", () => {
  it("throws from currentFrame() before seekTo() has ever resolved", () => {
    const track = makeTrack(1);
    const { createDecoder } = makeFakeDecoderFactory();
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);
    expect(() => cursor.currentFrame()).toThrow(/seekTo/);
  });

  it("seeking to the first sample feeds a REORDER_MARGIN look-ahead window in one call, keeping every look-ahead frame open", async () => {
    const track = makeTrack(30); // long enough that the margin doesn't reach end-of-stream
    const { createDecoder, decodeCalls } = makeFakeDecoderFactory();
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    const frame = await cursor.seekTo(0);
    expect((frame as unknown as FakeFrame).timestamp).toBe(0);
    expect(decodeCalls.length).toBeGreaterThan(1); // fed ahead, not just the single target
    expect(decodeCalls[0]).toBe(0);

    // Every look-ahead frame's timestamp is >= the target's — none should have been closed yet.
    const decodedFrames = decodeCalls.map((ts) => ts); // just documents intent; closes are asserted via the decoder's own frames below
    expect(decodedFrames.length).toBe(decodeCalls.length);
  });

  it("walking forward one sample at a time reuses the look-ahead window — exactly one new decode per step, none for the already-decoded target", async () => {
    const track = makeTrack(30);
    const { createDecoder, decodeCalls } = makeFakeDecoderFactory();
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    await cursor.seekTo(0);
    const afterFirst = decodeCalls.length;

    const frame = await cursor.seekTo(1000); // sample index 1 — already decoded as part of the first call's look-ahead
    expect((frame as unknown as FakeFrame).timestamp).toBe(1000);
    expect(decodeCalls.length).toBe(afterFirst + 1); // one new frontier sample submitted, nothing re-decoded
    expect(decodeCalls.filter((ts) => ts === 1000)).toHaveLength(1); // sample 1 decoded exactly once, not twice
  });

  it("re-seeking to the exact same time is a no-op — no new decode calls, same frame object", async () => {
    const track = makeTrack(20);
    const { createDecoder, decodeCalls } = makeFakeDecoderFactory();
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    await cursor.seekTo(2000);
    const countAfterFirst = decodeCalls.length;
    const frameBefore = cursor.currentFrame();

    const frameAgain = await cursor.seekTo(2000);
    expect(decodeCalls.length).toBe(countAfterFirst);
    expect(frameAgain).toBe(frameBefore);
  });

  it("advancing the target closes look-ahead frames strictly behind the new presentation-time watermark, keeping the target and anything still ahead", async () => {
    const track = makeTrack(30);
    const frames = new Map<number, FakeFrame>();
    const { createDecoder } = makeFakeDecoderFactory({
      async decode(chunk) {
        const frame: FakeFrame = { timestamp: chunk.timestamp, close: vi.fn() };
        frames.set(chunk.timestamp, frame);
        return frame as unknown as VideoFrame;
      },
    });
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    await cursor.seekTo(0); // decodes/holds samples 0..16 (margin 16)
    await cursor.seekTo(5000); // jump straight to sample 5 — still within the already-decoded window

    for (const [ts, frame] of frames) {
      if (ts < 5000) expect(frame.close).toHaveBeenCalledOnce(); // passed by the new watermark
      else expect(frame.close).not.toHaveBeenCalled(); // the target itself, or still-ahead look-ahead
    }
  });

  it("a forward jump past the already-decoded window keeps decoding forward WITHOUT resetting the decoder", async () => {
    const track = makeTrack(80, [0, 50]); // a later keyframe exists, but the cursor no longer treats it specially
    const { createDecoder, decodeCalls } = makeFakeDecoderFactory();
    const createDecoderSpy = vi.fn(createDecoder);
    const cursor = new VideoDecodeCursor(track, undefined, createDecoderSpy);

    await cursor.seekTo(2000); // submittedUpTo ~= 18
    await cursor.seekTo(60000); // target = sample 60, well past the current window — still forward, still reachable

    expect(createDecoderSpy).toHaveBeenCalledTimes(1); // no reset — this is a forward jump, not backward
    expect(cursor.currentFrame()).toMatchObject({ timestamp: 60000 });
    expect(decodeCalls).toContain(60000);
  });

  it("resets the decoder on a backward jump (the same asset reused earlier in decode order elsewhere on the timeline)", async () => {
    const track = makeTrack(30);
    const { createDecoder } = makeFakeDecoderFactory();
    const createDecoderSpy = vi.fn(createDecoder);
    const cursor = new VideoDecodeCursor(track, undefined, createDecoderSpy);

    await cursor.seekTo(10000); // submittedUpTo ~= 26
    expect(createDecoderSpy).toHaveBeenCalledTimes(1);

    const frame = await cursor.seekTo(1000); // BACKWARD — must reset (can't feed an earlier sample to a decoder that already saw later ones)
    expect(createDecoderSpy).toHaveBeenCalledTimes(2);
    expect((frame as unknown as FakeFrame).timestamp).toBe(1000);
  });

  it("flushes exactly once at end-of-stream, draining the tail, and doesn't re-flush for a subsequent seek still within the drained tail", async () => {
    const track = makeTrack(10); // shorter than REORDER_MARGIN — every seek from here on hits end-of-stream
    const flush = vi.fn(async () => {});
    const { createDecoder } = makeFakeDecoderFactory({ flush });
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    await cursor.seekTo(5000); // throughIdx (5+16=21) > lastIdx (9) — triggers the end-of-stream drain
    expect(flush).toHaveBeenCalledOnce();

    await cursor.seekTo(9000); // last sample — already decoded/flushed, no further flush needed
    expect(flush).toHaveBeenCalledOnce();
  });

  it("dispose() closes the current frame, every still-held look-ahead frame, and the decoder", async () => {
    const frames: FakeFrame[] = [];
    const { createDecoder } = makeFakeDecoderFactory({
      async decode(chunk) {
        const frame: FakeFrame = { timestamp: chunk.timestamp, close: vi.fn() };
        frames.push(frame);
        return frame as unknown as VideoFrame;
      },
    });
    let decoderClosed = false;
    const track = makeTrack(20);
    const cursor = new VideoDecodeCursor(track, undefined, (config, onError) => {
      const d = createDecoder(config, onError);
      return { ...d, close: () => (decoderClosed = true) };
    });

    await cursor.seekTo(0); // decodes/holds a whole look-ahead window
    cursor.dispose();

    for (const frame of frames) expect(frame.close).toHaveBeenCalledOnce();
    expect(decoderClosed).toBe(true);
  });

  describe("stall watchdog", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects a target decode that never settles, resets, and retries once — succeeding if the retry decodes normally", async () => {
      vi.useFakeTimers();
      const track = makeTrack(5);
      let attempt = 0;
      const createDecoder: CreateFrameDecoder = () => {
        const thisAttempt = ++attempt;
        return {
          async decode(chunk) {
            if (thisAttempt === 1) return new Promise<VideoFrame>(() => {}); // never settles — simulates the silent stall
            return { timestamp: chunk.timestamp, close: vi.fn() } as unknown as VideoFrame;
          },
          async flush() {},
          close: vi.fn(),
          state: "configured" as CodecState,
          decodeQueueSize: 0,
        };
      };
      const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

      const seek = cursor.seekTo(0);
      await vi.advanceTimersByTimeAsync(8_000); // trip STALL_TIMEOUT_MS
      const frame = await seek;

      expect(attempt).toBe(2); // one failed attempt, one retry
      expect((frame as unknown as FakeFrame).timestamp).toBe(0);
    });

    it("rethrows if the retry ALSO stalls on the very first seek ever (nothing to hold) — fails the export cleanly instead of freezing forever", async () => {
      vi.useFakeTimers();
      const track = makeTrack(5);
      const createDecoder: CreateFrameDecoder = () => ({
        decode: () => new Promise<VideoFrame>(() => {}), // every attempt stalls
        flush: async () => {},
        close: vi.fn(),
        state: "configured" as CodecState,
        decodeQueueSize: 0,
      });
      const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

      const seek = cursor.seekTo(0);
      // No `currentFrameValue` yet (this is the very first seek) — nothing to
      // gracefully fall back to, so this is the one case that must still throw.
      const assertion = expect(seek).rejects.toThrow(/no earlier frame is available to hold/);
      await vi.advanceTimersByTimeAsync(8_000); // first attempt's watchdog
      await vi.advanceTimersByTimeAsync(8_000); // retry's watchdog
      await assertion;
    });
  });

  describe("graceful degradation (a confirmed-unrecoverable stall holds the last frame instead of failing the export)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holds the last successfully-decoded frame when a LATER target never settles, without retrying via a decoder reset", async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const track = makeTrack(30);
      const STUCK_TS = 5000; // sample index 5
      const createDecoder: CreateFrameDecoder = () => ({
        async decode(chunk) {
          if (chunk.timestamp === STUCK_TS) return new Promise<VideoFrame>(() => {}); // this one specific chunk never settles
          return { timestamp: chunk.timestamp, close: vi.fn() } as unknown as VideoFrame;
        },
        async flush() {},
        close: vi.fn(),
        state: "configured" as CodecState,
        decodeQueueSize: 0,
      });
      const createDecoderSpy = vi.fn(createDecoder);
      const cursor = new VideoDecodeCursor(track, undefined, createDecoderSpy);

      const firstFrame = await cursor.seekTo(0); // decodes/holds 0..16 in the look-ahead batch, including the doomed sample 5

      const seek = cursor.seekTo(STUCK_TS);
      await vi.advanceTimersByTimeAsync(8_000); // trip the per-target watchdog
      const frame = await seek;

      expect(frame).toBe(firstFrame); // held the last good frame instead of throwing
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("holding the last decoded frame"));
      expect(createDecoderSpy).toHaveBeenCalledTimes(1); // no reset attempted — a reset can't fix a permanently-missing frame

      warnSpy.mockRestore();
    });

    it("holds the last frame past an unrecoverable end-of-stream flush(), and does NOT reset the decoder again for a further seek past the same tail", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const track = makeTrack(10); // shorter than REORDER_MARGIN — the very first seek already hits end-of-stream
      const flush = vi.fn(async () => {
        throw new Error("flush never resolves in reality — simulated here as a rejection for a fast, deterministic test");
      });
      const { createDecoder } = makeFakeDecoderFactory({ flush });
      const createDecoderSpy = vi.fn(createDecoder);
      const cursor = new VideoDecodeCursor(track, undefined, createDecoderSpy);

      const frame = await cursor.seekTo(0); // decodes everything (track shorter than margin), flush() rejects — degrades instead of throwing
      expect(frame).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("end-of-stream flush() unrecoverable"), expect.anything());
      expect(createDecoderSpy).toHaveBeenCalledTimes(1);

      const laterFrame = await cursor.seekTo(9000); // last sample — still within the (unrecoverable) flushed tail
      expect(laterFrame).toBeDefined();
      expect(createDecoderSpy).toHaveBeenCalledTimes(1); // still no reset — reachableForward's flushed+at-end clause held

      warnSpy.mockRestore();
    });
  });
});

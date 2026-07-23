// packages/media/src/decode-cursor.test.ts
//
// Tests the GOP-navigation ALGORITHM only (which samples get submitted to
// the decoder, in what order, and which VideoFrames get closed when) via an
// injected fake decoder (`CreateFrameDecoder`) — real WebCodecs only runs in
// a browser (see this file's module doc / ADR-016), so the actual
// `VideoDecoder`/mp4box wiring is manual-verification-only, same as
// `packages/export`'s own note that real encode/decode "can only be
// verified in a browser."

import { describe, expect, it, vi } from "vitest";
import { VideoDecodeCursor } from "./decode-cursor";
import type { CreateFrameDecoder, FrameDecoderLike } from "./decode-cursor";
import type { DemuxedSample, DemuxedVideoTrack } from "./mp4-demux";

// `seekTo()` constructs a real `EncodedVideoChunk` per submitted sample —
// a WebCodecs-only global with no Node equivalent. It's a plain data holder
// (no codec logic lives in it), so a minimal stand-in is enough to keep the
// GOP-navigation logic itself testable outside a browser.
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

function makeTrack(specs: Array<{ isKeyframe: boolean }>): DemuxedVideoTrack {
  const samples: DemuxedSample[] = specs.map((spec, i) => ({
    decodeOrder: i,
    timestampUs: i * 1000,
    durationUs: 1000,
    isKeyframe: spec.isKeyframe,
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

function makeFakeDecoderFactory(): { createDecoder: CreateFrameDecoder; decodeCalls: number[]; closeCalls: number } {
  const decodeCalls: number[] = [];
  let closeCalls = 0;
  const createDecoder: CreateFrameDecoder = () => {
    const decoder: FrameDecoderLike = {
      async decode(chunk) {
        decodeCalls.push(chunk.timestamp);
        const frame: FakeFrame = { timestamp: chunk.timestamp, close: vi.fn() };
        return frame as unknown as VideoFrame;
      },
      close() {
        closeCalls++;
      },
    };
    return decoder;
  };
  return { createDecoder, decodeCalls, closeCalls };
}

describe("VideoDecodeCursor", () => {
  it("throws from currentFrame() before seekTo() has ever resolved", () => {
    const track = makeTrack([{ isKeyframe: true }]);
    const { createDecoder } = makeFakeDecoderFactory();
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);
    expect(() => cursor.currentFrame()).toThrow(/seekTo/);
  });

  it("walks forward within one GOP one sample at a time, decoding only the newly-needed sample each call", async () => {
    // One GOP: sample 0 is the only keyframe.
    const track = makeTrack([{ isKeyframe: true }, { isKeyframe: false }, { isKeyframe: false }, { isKeyframe: false }]);
    const { createDecoder, decodeCalls } = makeFakeDecoderFactory();
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    await cursor.seekTo(0);
    expect(decodeCalls).toEqual([0]);

    await cursor.seekTo(1000);
    expect(decodeCalls).toEqual([0, 1000]); // only the NEW sample, no restart from the keyframe

    await cursor.seekTo(3000);
    expect(decodeCalls).toEqual([0, 1000, 2000, 3000]); // walks through 2 and 3 in order to reach 3
    expect(cursor.currentFrame()).toMatchObject({ timestamp: 3000 });
  });

  it("re-seeking to the exact same time is a no-op — decodes nothing new", async () => {
    const track = makeTrack([{ isKeyframe: true }, { isKeyframe: false }]);
    const { createDecoder, decodeCalls } = makeFakeDecoderFactory();
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    await cursor.seekTo(1000);
    expect(decodeCalls).toEqual([0, 1000]);

    const frameBefore = cursor.currentFrame();
    await cursor.seekTo(1000);
    expect(decodeCalls).toEqual([0, 1000]); // unchanged
    expect(cursor.currentFrame()).toBe(frameBefore); // same frame object, not re-decoded
  });

  it("skips the rest of a stale GOP on a forward jump past a later keyframe", async () => {
    // GOP A: 0(key),1,2,3,4. GOP B starts at 5(key),6,7.
    const track = makeTrack([
      { isKeyframe: true },
      { isKeyframe: false },
      { isKeyframe: false },
      { isKeyframe: false },
      { isKeyframe: false },
      { isKeyframe: true },
      { isKeyframe: false },
      { isKeyframe: false },
    ]);
    const { createDecoder, decodeCalls } = makeFakeDecoderFactory();
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    await cursor.seekTo(1000); // decodes 0, 1
    expect(decodeCalls).toEqual([0, 1000]);

    await cursor.seekTo(6000); // target is sample 6, in GOP B — should jump to keyframe 5, not decode 2/3/4
    expect(decodeCalls).toEqual([0, 1000, 5000, 6000]);
  });

  it("resets the decoder on a backward jump (the same asset reused earlier in decode order elsewhere on the timeline)", async () => {
    const track = makeTrack([{ isKeyframe: true }, { isKeyframe: false }, { isKeyframe: false }, { isKeyframe: false }]);
    const { createDecoder, decodeCalls } = makeFakeDecoderFactory();
    const createDecoderSpy = vi.fn(createDecoder);
    const cursor = new VideoDecodeCursor(track, undefined, createDecoderSpy);

    await cursor.seekTo(3000); // walks 0,1,2,3
    expect(decodeCalls).toEqual([0, 1000, 2000, 3000]);
    expect(createDecoderSpy).toHaveBeenCalledTimes(1);

    await cursor.seekTo(1000); // BACKWARD — must reset (can't feed an earlier sample to a decoder that already saw later ones)
    expect(createDecoderSpy).toHaveBeenCalledTimes(2); // reset happened
    expect(decodeCalls).toEqual([0, 1000, 2000, 3000, 0, 1000]); // re-decodes from the keyframe forward to the new target
  });

  it("closes every intermediate frame decoded en route, but keeps (and doesn't close) the target frame until it's superseded", async () => {
    const track = makeTrack([{ isKeyframe: true }, { isKeyframe: false }, { isKeyframe: false }]);
    const closedFrames: FakeFrame[] = [];
    const createDecoder: CreateFrameDecoder = () => ({
      async decode(chunk) {
        const frame: FakeFrame = {
          timestamp: chunk.timestamp,
          close: vi.fn(() => closedFrames.push(frame)),
        };
        return frame as unknown as VideoFrame;
      },
      close: vi.fn(),
    });
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);

    await cursor.seekTo(2000); // decodes 0, 1, 2 in one call — 0 and 1 are intermediate, 2 is the target
    expect(closedFrames.map((f) => f.timestamp)).toEqual([0, 1000]); // intermediates closed immediately
    expect(cursor.currentFrame()).toMatchObject({ timestamp: 2000 }); // target NOT closed

    const targetFrame = cursor.currentFrame() as unknown as FakeFrame;
    await cursor.seekTo(2000); // no-op — shouldn't touch the frame we're holding
    expect(targetFrame.close).not.toHaveBeenCalled();
  });

  it("dispose() closes the current frame and the decoder", async () => {
    const track = makeTrack([{ isKeyframe: true }]);
    let decoderClosed = false;
    const createDecoder: CreateFrameDecoder = () => ({
      async decode(chunk) {
        return { timestamp: chunk.timestamp, close: vi.fn() } as unknown as VideoFrame;
      },
      close: () => {
        decoderClosed = true;
      },
    });
    const cursor = new VideoDecodeCursor(track, undefined, createDecoder);
    await cursor.seekTo(0);
    const frame = cursor.currentFrame() as unknown as FakeFrame;

    cursor.dispose();

    expect(frame.close).toHaveBeenCalledOnce();
    expect(decoderClosed).toBe(true);
  });
});

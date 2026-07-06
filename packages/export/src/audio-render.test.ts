// packages/export/src/audio-render.test.ts
//
// Tests the SCHEDULING math (what gets connected, when things start/stop,
// what gain automation is applied) via fakes that record calls — proving
// the orchestration is correct without needing a real browser
// OfflineAudioContext (unavailable in this test environment).

import { describe, expect, it, vi } from "vitest";
import { createId } from "core";
import type { AudioTrack, Composition } from "core";
import { renderCompositionAudio } from "./audio-render";
import type { AudioRenderDeps, OfflineAudioContextLike } from "./audio-render";

function track(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: createId(),
    assetId: "asset_1",
    name: "Track",
    startFrame: 0,
    trimIn: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    loop: false,
    muted: false,
    solo: false,
    lane: 0,
    ...overrides,
  };
}

function comp(overrides: Partial<Composition> = {}): Composition {
  return {
    id: createId(),
    name: "Main",
    size: { width: 1920, height: 1080 },
    fps: 30,
    duration: 300 as Composition["duration"], // 10s at 30fps
    root: [],
    audioTracks: [],
    ...overrides,
  };
}

interface RecordedGain {
  calls: Array<{ method: "setValueAtTime" | "linearRampToValueAtTime"; value: number; time: number }>;
}

function fakeGainNode(): GainNode & { __recorded: RecordedGain } {
  const recorded: RecordedGain = { calls: [] };
  return {
    __recorded: recorded,
    gain: {
      setValueAtTime: vi.fn((value: number, time: number) => {
        recorded.calls.push({ method: "setValueAtTime", value, time });
      }),
      linearRampToValueAtTime: vi.fn((value: number, time: number) => {
        recorded.calls.push({ method: "linearRampToValueAtTime", value, time });
      }),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as GainNode & { __recorded: RecordedGain };
}

interface RecordedSource {
  buffer?: AudioBuffer;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  startArgs?: [number, number, number | undefined];
  connectedTo?: unknown;
}

function fakeBufferSourceNode(recorded: RecordedSource): AudioBufferSourceNode {
  return {
    set buffer(v: AudioBuffer) {
      recorded.buffer = v;
    },
    set loop(v: boolean) {
      recorded.loop = v;
    },
    set loopStart(v: number) {
      recorded.loopStart = v;
    },
    set loopEnd(v: number) {
      recorded.loopEnd = v;
    },
    start: vi.fn((when: number, offset: number, duration?: number) => {
      recorded.startArgs = [when, offset, duration];
    }),
    connect: vi.fn((dest: unknown) => {
      recorded.connectedTo = dest;
    }),
  } as unknown as AudioBufferSourceNode;
}

function fakeAudioBuffer(duration: number): AudioBuffer {
  return { duration } as unknown as AudioBuffer;
}

/** Builds a fake OfflineAudioContext that records every source/gain it creates, keyed by creation order. */
function fakeContext(bufferDurationByUrl: Record<string, number> = {}) {
  const sources: RecordedSource[] = [];
  const gains: Array<GainNode & { __recorded: RecordedGain }> = [];
  const renderedBuffer = fakeAudioBuffer(0);
  const decodedUrls: string[] = [];

  const ctx: OfflineAudioContextLike = {
    destination: {} as AudioNode,
    async decodeAudioData(data) {
      // Route by a marker byte we stash the "url" in for the test (see fetchAudio below).
      const marker = new TextDecoder().decode(data);
      decodedUrls.push(marker);
      return fakeAudioBuffer(bufferDurationByUrl[marker] ?? 5);
    },
    createBufferSource() {
      const recorded: RecordedSource = {};
      sources.push(recorded);
      return fakeBufferSourceNode(recorded);
    },
    createGain() {
      const gain = fakeGainNode();
      gains.push(gain);
      return gain;
    },
    async startRendering() {
      return renderedBuffer;
    },
  };

  return { ctx, sources, gains, decodedUrls, renderedBuffer };
}

function depsFor(ctx: OfflineAudioContextLike): AudioRenderDeps {
  return {
    createContext: () => ctx,
    fetchAudio: async (url: string) => new TextEncoder().encode(url).buffer,
  };
}

describe("renderCompositionAudio", () => {
  it("returns undefined when the composition has no audio tracks", async () => {
    const { ctx } = fakeContext();
    const result = await renderCompositionAudio({ comp: comp({ audioTracks: [] }), resolveUrl: () => undefined }, depsFor(ctx));
    expect(result).toBeUndefined();
  });

  it("skips a track whose asset can't be resolved, without throwing", async () => {
    const { ctx, sources } = fakeContext();
    const c = comp({ audioTracks: [track({ assetId: "missing" })] });

    const result = await renderCompositionAudio({ comp: c, resolveUrl: () => undefined }, depsFor(ctx));

    expect(result).toBeDefined();
    expect(sources).toHaveLength(0);
  });

  it("schedules a single track at its own startFrame (not offset by any playhead)", async () => {
    const { ctx, sources } = fakeContext();
    const c = comp({ audioTracks: [track({ startFrame: 60, trimIn: 2 })] }); // starts at 2s into the timeline, per fps=30

    await renderCompositionAudio({ comp: c, resolveUrl: () => "url-a" }, depsFor(ctx));

    expect(sources).toHaveLength(1);
    const [when, offset, duration] = sources[0].startArgs!;
    expect(when).toBeCloseTo(2); // startFrame 60 / fps 30 = 2s
    expect(offset).toBeCloseTo(2); // trimIn
    expect(duration).toBeGreaterThan(0);
  });

  it("decodes each distinct asset once, even when multiple tracks share it", async () => {
    const { ctx, decodedUrls } = fakeContext();
    const c = comp({
      audioTracks: [track({ id: createId(), assetId: "shared" }), track({ id: createId(), assetId: "shared", startFrame: 30 })],
    });

    await renderCompositionAudio({ comp: c, resolveUrl: () => "shared-url" }, depsFor(ctx));

    expect(decodedUrls).toEqual(["shared-url"]); // decoded once, not twice
  });

  it("applies fade-in as a gain ramp from 0 to the track's volume", async () => {
    const { ctx, gains } = fakeContext();
    const c = comp({ audioTracks: [track({ volume: 0.8, fadeIn: 1 })] });

    await renderCompositionAudio({ comp: c, resolveUrl: () => "url" }, depsFor(ctx));

    const calls = gains[0].__recorded.calls;
    expect(calls[0]).toMatchObject({ method: "setValueAtTime", value: 0 });
    expect(calls[1]).toMatchObject({ method: "linearRampToValueAtTime", value: 0.8 });
  });

  it("mutes a track (gain 0 throughout) when muted:true, regardless of volume", async () => {
    const { ctx, gains } = fakeContext();
    const c = comp({ audioTracks: [track({ volume: 1, muted: true })] });

    await renderCompositionAudio({ comp: c, resolveUrl: () => "url" }, depsFor(ctx));

    const calls = gains[0].__recorded.calls;
    expect(calls.some((call) => call.value !== 0)).toBe(false);
  });

  it("silences non-solo tracks when any track is soloed", async () => {
    const { ctx, gains } = fakeContext();
    const c = comp({
      audioTracks: [track({ id: createId(), assetId: "a1", volume: 1, solo: true }), track({ id: createId(), assetId: "a2", volume: 1, solo: false })],
    });

    await renderCompositionAudio({ comp: c, resolveUrl: (id) => id }, depsFor(ctx));

    const soloedTrackGain = gains[0].__recorded.calls;
    const nonSoloTrackGain = gains[1].__recorded.calls;
    expect(soloedTrackGain.some((c) => c.value === 1)).toBe(true);
    expect(nonSoloTrackGain.every((c) => c.value === 0)).toBe(true);
  });

  it("connects source -> gain -> destination for every scheduled track", async () => {
    const { ctx, sources, gains } = fakeContext();
    const c = comp({ audioTracks: [track()] });

    await renderCompositionAudio({ comp: c, resolveUrl: () => "url" }, depsFor(ctx));

    expect(sources[0].connectedTo).toBe(gains[0]);
  });

  it("skips a track whose computed duration is <= 0 (e.g. endFrame at/before startFrame)", async () => {
    const { ctx, sources } = fakeContext();
    const c = comp({ audioTracks: [track({ startFrame: 100, endFrame: 100 })] });

    await renderCompositionAudio({ comp: c, resolveUrl: () => "url" }, depsFor(ctx));

    expect(sources).toHaveLength(0);
  });

  it("returns the rendered AudioBuffer from startRendering()", async () => {
    const { ctx, renderedBuffer } = fakeContext();
    const c = comp({ audioTracks: [track()] });

    const result = await renderCompositionAudio({ comp: c, resolveUrl: () => "url" }, depsFor(ctx));

    expect(result).toBe(renderedBuffer);
  });
});
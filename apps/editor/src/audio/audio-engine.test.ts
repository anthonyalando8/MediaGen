// apps/editor/src/audio/audio-engine.test.ts
//
// Regression coverage for a real reported bug: live preview audio sounded
// "dirty"/noisy while exported audio was clean. Root cause was seek()
// unconditionally calling stopAll()+scheduleAll() on EVERY playhead tick
// during playback (useAudioSync.ts subscribes to the whole store and
// calls seek() whenever `state.playhead` changes, which is continuous
// while playing) — abruptly stopping and restarting the AudioBufferSourceNode
// dozens of times per second, each stop/start pair an audible click. The
// fix: only reschedule when the incoming frame is a genuine discontinuous
// jump (scrub/loop/click-to-seek), not a normal per-frame advance.
//
// Uses a fake AudioContext (stubbed as the global constructor) since no
// real Web Audio implementation exists in this test environment — this
// tests the ENGINE's scheduling decisions (when does it call stop+start
// vs. leave things alone), not actual audio output.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio-engine";
import type { AudioTrackState } from "./audio-engine";

class FakeGainParam {
  calls: Array<{ method: string; value: number; time: number }> = [];
  setValueAtTime(value: number, time: number) {
    this.calls.push({ method: "setValueAtTime", value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: "linearRampToValueAtTime", value, time });
  }
}

class FakeGainNode {
  gain = new FakeGainParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeBufferSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  startArgs: [number, number, number | undefined] | null = null;
  stopped = false;
  connect = vi.fn();
  disconnect = vi.fn();
  start(when: number, offset: number, duration?: number) {
    this.startArgs = [when, offset, duration];
  }
  stop() {
    this.stopped = true;
  }
}

class FakeAudioContext {
  currentTime = 0;
  state: "running" | "suspended" = "running";
  destination = {};
  createdSources: FakeBufferSourceNode[] = [];
  createdGains: FakeGainNode[] = [];

  resume() {
    return Promise.resolve();
  }
  createBufferSource() {
    const node = new FakeBufferSourceNode();
    this.createdSources.push(node);
    return node as unknown as AudioBufferSourceNode;
  }
  createGain() {
    const node = new FakeGainNode();
    this.createdGains.push(node);
    return node as unknown as GainNode;
  }
  decodeAudioData(_data: ArrayBuffer): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 10 } as unknown as AudioBuffer);
  }
}

function track(overrides: Partial<AudioTrackState> = {}): AudioTrackState {
  return {
    id: "t1",
    assetId: "a1",
    startFrame: 0,
    trimIn: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    loop: false,
    muted: false,
    solo: false,
    ...overrides,
  };
}

describe("AudioEngine", () => {
  let ctx: FakeAudioContext;

  beforeEach(() => {
    ctx = new FakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(() => ctx)
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function engineWithLoadedTrack(fps = 30): Promise<AudioEngine> {
    const engine = new AudioEngine();
    await engine.loadAsset({ id: "a1", url: "http://x/a1.mp3", kind: "audio" });
    engine.update([track()], () => "http://x/a1.mp3");
    engine.setPlaying(true);
    return engine;
  }

  it("does NOT reschedule (stop+restart) when seek() is called with the natural next frame during ordinary playback", async () => {
    const engine = await engineWithLoadedTrack();
    expect(ctx.createdSources).toHaveLength(1);
    const firstSource = ctx.createdSources[0];

    // Simulate real elapsed time and the RAF loop reporting the frame that
    // matches it exactly — this is what a normal playback tick looks like.
    ctx.currentTime = 1 / 30; // one frame's worth of real time has passed
    engine.seek(1, 30);

    expect(firstSource.stopped).toBe(false);
    expect(ctx.createdSources).toHaveLength(1); // no new source created
  });

  it("tolerates small RAF jitter without rescheduling", async () => {
    const engine = await engineWithLoadedTrack();
    const firstSource = ctx.createdSources[0];

    // Real elapsed time corresponds to frame 10, but the reported frame is
    // off by 1 (jitter) — should still be treated as normal playback.
    ctx.currentTime = 10 / 30;
    engine.seek(11, 30);

    expect(firstSource.stopped).toBe(false);
    expect(ctx.createdSources).toHaveLength(1);
  });

  it("DOES reschedule when the frame is a genuine discontinuous jump (scrub/loop/click-to-seek)", async () => {
    const engine = await engineWithLoadedTrack();
    const firstSource = ctx.createdSources[0];

    // Only a tiny bit of real time has passed, but the reported frame jumps
    // far ahead — e.g. the user clicked elsewhere on the timeline.
    ctx.currentTime = 0.01;
    engine.seek(150, 30); // 5 seconds ahead (within the fake 10s buffer) — nowhere near where natural playback would be

    expect(firstSource.stopped).toBe(true);
    expect(ctx.createdSources).toHaveLength(2); // old one stopped, a new one scheduled
  });

  it("does nothing when paused — just records position, no scheduling at all", async () => {
    const engine = new AudioEngine();
    await engine.loadAsset({ id: "a1", url: "http://x/a1.mp3", kind: "audio" });
    engine.update([track()], () => "http://x/a1.mp3");
    // Deliberately never calling setPlaying(true).

    engine.seek(50, 30);

    expect(ctx.createdSources).toHaveLength(0);
  });

  it("reschedules on a fps change even if the frame number alone would look like natural advance", async () => {
    const engine = await engineWithLoadedTrack(30);
    const firstSource = ctx.createdSources[0];

    ctx.currentTime = 1 / 30;
    engine.seek(1, 60); // same frame delta as a "natural" 30fps tick, but fps itself changed

    expect(firstSource.stopped).toBe(true);
    expect(ctx.createdSources).toHaveLength(2);
  });

  // Regression coverage for the "importing a second scene still plays the
  // FIRST scene's voice-over" bug. scene_export.py names VO assets
  // positionally ("vo_0", "vo_1", ...) — the SAME ids across every separate
  // generation, pointing at completely different audio each time. Since
  // loadAsset()/update() only fetch an id they haven't cached yet, a second
  // scene reusing "vo_0" silently kept playing the FIRST scene's decoded
  // buffer forever, with no error, unless the cache is explicitly cleared
  // on a document swap — which is what reset() (called from
  // useAudioSync.ts's viewport-reset-epoch subscription) now does.
  describe("reset()", () => {
    it("clears the decoded-buffer cache, so re-loading a REUSED asset id actually re-fetches instead of silently keeping the old buffer", async () => {
      const engine = new AudioEngine();
      const fetchMock = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }));
      vi.stubGlobal("fetch", fetchMock);

      await engine.loadAsset({ id: "vo_0", url: "http://x/scene-A-vo0.mp3", kind: "audio" });
      expect(engine.isReady("vo_0")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Without reset(), this second call for the SAME id would no-op —
      // exactly the bug: a different scene's "vo_0" never gets loaded.
      await engine.loadAsset({ id: "vo_0", url: "http://x/scene-B-vo0.mp3", kind: "audio" });
      expect(fetchMock).toHaveBeenCalledTimes(1); // confirms the cache-skip this bug depends on

      engine.reset();
      expect(engine.isReady("vo_0")).toBe(false);

      await engine.loadAsset({ id: "vo_0", url: "http://x/scene-B-vo0.mp3", kind: "audio" });
      expect(fetchMock).toHaveBeenCalledTimes(2); // now actually re-fetched the new scene's audio
      expect(fetchMock).toHaveBeenLastCalledWith("http://x/scene-B-vo0.mp3");
    });

    it("stops any currently scheduled/playing sources", async () => {
      const engine = await engineWithLoadedTrack();
      const firstSource = ctx.createdSources[0];
      expect(firstSource.stopped).toBe(false);

      engine.reset();

      expect(firstSource.stopped).toBe(true);
    });

    it("does not throw when called on a fresh engine with nothing loaded or playing", () => {
      const engine = new AudioEngine();
      expect(() => engine.reset()).not.toThrow();
    });
  });
});
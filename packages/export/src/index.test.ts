// packages/export/src/index.test.ts
//
// Tests exportToMp4's ORCHESTRATION: right frames evaluated in order, right
// timestamps handed to the video source, audio only added when the comp
// has tracks, output lifecycle (start -> ... -> finalize) respected,
// renderer always destroyed (even on failure), and the resulting Blob
// wraps whatever bytes the muxer produced. All via fakes — real
// WebCodecs/OfflineAudioContext/WebGL can't run in this test environment;
// see this package's other test files for what those fakes stand in for.

import { describe, expect, it, vi } from "vitest";
import { createId, NodeKindRegistry } from "core";
import type { Composition, Node } from "core";
import type { Renderer, MediaService } from "renderer-webgl";
import { exportToMp4 } from "./index";
import type { ExportDeps, MuxerOutput, VideoSourceLike, AudioSourceLike } from "./index";

function comp(overrides: Partial<Composition> = {}): Composition {
  return {
    id: createId(),
    name: "Main",
    size: { width: 100, height: 50 },
    fps: 10,
    duration: 3 as Composition["duration"],
    root: [] as Node[],
    ...overrides,
  };
}

function fakeRenderer(): Renderer & { renderCalls: Array<{ playing: boolean; frame: number; wallTime?: number }>; prepareFrameCalls: number; destroyed: boolean } {
  const renderCalls: Array<{ playing: boolean; frame: number; wallTime?: number }> = [];
  let prepareFrameCalls = 0;
  return {
    renderCalls,
    get prepareFrameCalls() {
      return prepareFrameCalls;
    },
    destroyed: false,
    async prepareFrame() {
      prepareFrameCalls++;
    },
    render(_tree, playing = false, frame = 0, wallTime?: number) {
      renderCalls.push({ playing, frame, wallTime });
    },
    resize() {},
    setFps() {},
    setViewport() {},
    setCompSize() {},
    destroy() {
      this.destroyed = true;
    },
  };
}

function fakeMuxer(bytes = new Uint8Array([1, 2, 3]).buffer) {
  const videoAddCalls: Array<{ timestamp: number; duration?: number }> = [];
  const audioAddCalls: AudioBuffer[] = [];
  const calls: string[] = [];

  const output: MuxerOutput = {
    addVideoTrack: () => calls.push("addVideoTrack"),
    addAudioTrack: () => calls.push("addAudioTrack"),
    async start() {
      calls.push("start");
    },
    async finalize() {
      calls.push("finalize");
    },
    get finalBuffer() {
      return calls.includes("finalize") ? bytes : null;
    },
  };

  const videoSource: VideoSourceLike = {
    async add(timestamp, duration) {
      videoAddCalls.push({ timestamp, duration });
    },
  };

  const audioSource: AudioSourceLike = {
    async add(buffer) {
      audioAddCalls.push(buffer);
    },
  };

  return { output, videoSource, audioSource, videoAddCalls, audioAddCalls, calls };
}

function baseDeps(overrides: Partial<ExportDeps> = {}): { deps: ExportDeps; renderer: ReturnType<typeof fakeRenderer>; muxer: ReturnType<typeof fakeMuxer> } {
  const renderer = fakeRenderer();
  const muxer = fakeMuxer();
  const media: MediaService = { resolveAsset: () => undefined };

  const deps: ExportDeps = {
    createCanvas: () => ({}) as HTMLCanvasElement,
    createRenderer: () => renderer,
    createMuxer: (_canvas, options) => ({
      output: muxer.output,
      videoSource: muxer.videoSource,
      audioSource: options.hasAudio ? muxer.audioSource : undefined,
    }),
    media,
    audioRenderDeps: {
      createContext: () => {
        throw new Error("audioRenderDeps.createContext should not be called when the comp has no audio tracks");
      },
      fetchAudio: async () => new ArrayBuffer(0),
    },
    ...overrides,
  };

  return { deps, renderer, muxer };
}

describe("exportToMp4", () => {
  it("calls prepareFrame() once per frame before render() — this is what makes video textures land on the right frame before capture", async () => {
    const { deps, renderer } = baseDeps();
    const registry = new NodeKindRegistry();

    await exportToMp4({ comp: comp({ duration: 4 as Composition["duration"] }), registry }, deps);

    expect(renderer.prepareFrameCalls).toBe(4);
  });

  it("renders every frame in order and passes matching timestamps to the video source", async () => {
    const { deps, renderer, muxer } = baseDeps();
    const registry = new NodeKindRegistry();

    await exportToMp4({ comp: comp({ duration: 3 as Composition["duration"] }), registry }, deps);

    expect(renderer.renderCalls.map((c) => c.frame)).toEqual([0, 1, 2]);
    expect(renderer.renderCalls.every((c) => c.playing === false)).toBe(true);
    expect(muxer.videoAddCalls.map((c) => c.timestamp)).toEqual([0, 0.1, 0.2]);
    muxer.videoAddCalls.forEach((c) => expect(c.duration).toBeCloseTo(0.1));
  });

  it("calls output.start() before any frame is rendered, and finalize() after the last", async () => {
    const { deps, renderer, muxer } = baseDeps();
    const registry = new NodeKindRegistry();
    const order: string[] = [];
    const originalRender = renderer.render.bind(renderer);
    renderer.render = (...args) => {
      order.push(`render:${args[2]}`);
      originalRender(...args);
    };
    const originalStart = muxer.output.start.bind(muxer.output);
    muxer.output.start = async () => {
      order.push("start");
      await originalStart();
    };
    const originalFinalize = muxer.output.finalize.bind(muxer.output);
    muxer.output.finalize = async () => {
      order.push("finalize");
      await originalFinalize();
    };

    await exportToMp4({ comp: comp({ duration: 2 as Composition["duration"] }), registry }, deps);

    expect(order).toEqual(["start", "render:0", "render:1", "finalize"]);
  });

  it("does not add an audio track when the composition has no audioTracks", async () => {
    const { deps, muxer } = baseDeps();
    const registry = new NodeKindRegistry();

    await exportToMp4({ comp: comp({ audioTracks: [] }), registry }, deps);

    expect(muxer.audioAddCalls).toHaveLength(0);
  });

  it("renders and adds audio when the composition has audioTracks and resolveAudioUrl is provided", async () => {
    const fakeAudioBuffer = {} as AudioBuffer;
    const { deps, muxer } = baseDeps({
      audioRenderDeps: {
        createContext: () => ({
          destination: {} as AudioNode,
          decodeAudioData: async () => fakeAudioBuffer,
          createBufferSource: () => ({ connect: () => {}, start: () => {} }) as unknown as AudioBufferSourceNode,
          createGain: () => ({ gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }) as unknown as GainNode,
          startRendering: async () => fakeAudioBuffer,
        }),
        fetchAudio: async () => new ArrayBuffer(0),
      },
    });
    const registry = new NodeKindRegistry();
    const withAudio = comp({
      audioTracks: [
        {
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
        },
      ],
    });

    await exportToMp4({ comp: withAudio, registry, resolveAudioUrl: () => "some-url" }, deps);

    expect(muxer.audioAddCalls).toEqual([fakeAudioBuffer]);
  });

  it("returns a Blob wrapping the muxer's final bytes with a video/mp4 mime type", async () => {
    const bytes = new Uint8Array([9, 9, 9]).buffer;
    const { deps } = baseDeps();
    (deps as { createMuxer: ExportDeps["createMuxer"] }).createMuxer = (_canvas, options) => {
      const m = fakeMuxer(bytes);
      return { output: m.output, videoSource: m.videoSource, audioSource: options.hasAudio ? m.audioSource : undefined };
    };
    const registry = new NodeKindRegistry();

    const blob = await exportToMp4({ comp: comp(), registry }, deps);

    expect(blob.type).toBe("video/mp4");
    expect(blob.size).toBe(3);
  });

  it("destroys the renderer even if the frame loop throws", async () => {
    const { deps, renderer } = baseDeps();
    renderer.render = () => {
      throw new Error("render exploded");
    };
    const registry = new NodeKindRegistry();

    await expect(exportToMp4({ comp: comp(), registry }, deps)).rejects.toThrow("render exploded");
    expect(renderer.destroyed).toBe(true);
  });
});
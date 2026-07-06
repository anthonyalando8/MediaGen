// packages/export/src/index.ts
//
// Client-side MP4 export (Phase 2 blueprint, Deliverable 11.2 — the
// CLIENT half only; see this file's own doc below for what's deferred).
//
// PIPELINE
// --------
// virtual-clock (frame/time sequence) -> frame-pump (per-frame loop) ->
// evaluateComposition (core, unchanged) -> renderer.render (renderer-webgl,
// unchanged) -> Mediabunny's CanvasSource (captures + encodes the canvas)
// -> Mediabunny's Output (muxes into an MP4) -> Blob.
//
// Audio (if the composition has any AudioTrack) is rendered separately,
// in one pass, via audio-render.ts's OfflineAudioContext-based renderer,
// then handed to Mediabunny's AudioBufferSource as a single buffer.
//
// WHY MAIN THREAD, NOT A WORKER (blueprint's "runs in a worker on
// OffscreenCanvas")
// ------------------------------------------------------------------------
// `createWebGLRenderer` (renderer-webgl/renderer.ts) is typed to accept an
// `HTMLCanvasElement`, the same type the live preview uses — broadening
// that to `HTMLCanvasElement | OffscreenCanvas` (and the worker
// message-passing to get a Composition + assets into a worker context) is
// real, separate scope that risks the renderer used by live playback.
// Exporting on the main thread means it visibly busies the tab for the
// export's duration — an acceptable, disclosed tradeoff for this pass, not
// a hidden limitation. Revisit this file's `createCanvas`/`createRenderer`
// deps if/when the worker path gets built; the rest of this pipeline
// (virtual-clock, frame-pump, audio-render, the Mediabunny wiring) doesn't
// need to change to move into a worker later — only where the canvas comes
// from does.

import { evaluateComposition } from "core";
import type { Composition, EvalCtx, Frame, NodeKindRegistry } from "core";
import { createWebGLRenderer } from "renderer-webgl";
import type { MediaService, Renderer } from "renderer-webgl";
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, QUALITY_HIGH } from "mediabunny";
import type { Quality } from "mediabunny";
import { createVirtualClock } from "./virtual-clock";
import { pumpFrames } from "./frame-pump";
import { renderCompositionAudio } from "./audio-render";
import type { AudioRenderDeps } from "./audio-render";

export interface ExportOptions {
  comp: Composition;
  registry: NodeKindRegistry;
  /** Same shape/purpose as evaluateComposition's 4th argument (evaluate-composition.ts) — resolves an asset's natural dimensions for layout. */
  resolveAsset?: EvalCtx["resolveAsset"];
  /** Same shape/purpose as evaluateComposition's 5th argument — required only if `comp` contains comp-node instances (Phase 2 precompose). Omit for a comp with no nested compositions. */
  resolveComp?: EvalCtx["resolveComp"];
  /** Resolves an AudioTrack's assetId to a fetchable URL for audio rendering. Omit if the comp has no audio tracks. */
  resolveAudioUrl?: (assetId: string) => string | undefined;
  /** Video bitrate in bits/sec, or a Mediabunny Quality constant. Default: QUALITY_HIGH. */
  videoBitrate?: number | Quality;
  onProgress?: (framesCompleted: number, frameCount: number) => void;
}

/** MediaService for the renderer, resolving to full-quality `master` (NOT `proxy`) — export wants the real asset, proxy is a preview-only performance shortcut (see apps/api/src/transcode/worker.ts's own "master — full quality, used only at export time" note). */
export interface ExportMediaService extends MediaService {}

/**
 * The minimal surface `exportToMp4` needs from Mediabunny's `Output` +
 * whatever `target` it was built with. Narrowed on purpose (not just
 * re-exporting Mediabunny's real `Output` type) so a test fake only has to
 * implement 4 methods + 1 getter, not Mediabunny's full class shape.
 */
export interface MuxerOutput {
  addVideoTrack(source: VideoSourceLike, metadata?: { frameRate?: number }): void;
  addAudioTrack(source: AudioSourceLike): void;
  start(): Promise<void>;
  finalize(): Promise<void>;
  /** The finished file's bytes — `null` until `finalize()` resolves. */
  readonly finalBuffer: ArrayBuffer | null;
}

export interface VideoSourceLike {
  add(timestamp: number, duration?: number): Promise<void>;
}

export interface AudioSourceLike {
  add(buffer: AudioBuffer): Promise<void>;
}

export interface ExportDeps {
  /** Creates the (hidden) canvas the renderer draws into. Real default: a detached `<canvas>` sized to `comp.size`. */
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  /** Real default: renderer-webgl's `createWebGLRenderer`. Injectable so orchestration is testable without a real GL context. */
  createRenderer: (canvas: HTMLCanvasElement, media: MediaService) => Renderer;
  media: ExportMediaService;
  audioRenderDeps: AudioRenderDeps;
  /**
   * Constructs the muxer/encoder backend. Real default wraps Mediabunny's
   * `Output` + `Mp4OutputFormat` + `BufferTarget` + `CanvasSource` +
   * `AudioBufferSource` — none of which can run in this test environment
   * (they need real WebCodecs). Injecting the whole backend behind this
   * one seam is what makes `exportToMp4`'s ORCHESTRATION (call order,
   * timestamps passed, when audio is/isn't added, finalize+cleanup)
   * testable with a fake here, even though the real encode/mux can only
   * be verified in a browser.
   */
  createMuxer: (canvas: HTMLCanvasElement, options: { videoBitrate: number | Quality; fps: number; hasAudio: boolean }) => { output: MuxerOutput; videoSource: VideoSourceLike; audioSource?: AudioSourceLike };
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function defaultCreateMuxer(canvas: HTMLCanvasElement, options: { videoBitrate: number | Quality; fps: number; hasAudio: boolean }): { output: MuxerOutput; videoSource: VideoSourceLike; audioSource?: AudioSourceLike } {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: options.videoBitrate });
  output.addVideoTrack(videoSource, { frameRate: options.fps });

  const audioSource = options.hasAudio ? new AudioBufferSource({ codec: "aac", bitrate: QUALITY_HIGH }) : undefined;
  if (audioSource) output.addAudioTrack(audioSource);

  return {
    output: {
      addVideoTrack: () => {}, // already added above — Output.addVideoTrack can only be called once per source
      addAudioTrack: () => {},
      start: () => output.start(),
      finalize: () => output.finalize(),
      get finalBuffer() {
        return target.buffer;
      },
    },
    videoSource,
    audioSource,
  };
}

/** Real-browser defaults for every injectable dependency except `media` (there's no sensible default — the caller always knows how to resolve its own project's assets, see Viewport.tsx's `createMediaService` for the pattern to mirror). */
export function defaultExportDeps(media: ExportMediaService): ExportDeps {
  return {
    createCanvas: defaultCreateCanvas,
    createRenderer: createWebGLRenderer,
    createMuxer: defaultCreateMuxer,
    media,
    audioRenderDeps: {
      createContext: (channels, length, sampleRate) => new OfflineAudioContext(channels, length, sampleRate),
      fetchAudio: (url) => fetch(url).then((r) => r.arrayBuffer()),
    },
  };
}

/**
 * Exports `comp` to an MP4 `Blob`. Renders every frame at full resolution
 * (no proxy substitution — see `ExportMediaService`'s doc), encodes via
 * Mediabunny, muxes audio if present, and resolves once the file is
 * complete and ready to download.
 */
export async function exportToMp4(options: ExportOptions, deps: ExportDeps): Promise<Blob> {
  const { comp, registry, resolveAsset, resolveComp, resolveAudioUrl, videoBitrate = QUALITY_HIGH, onProgress } = options;

  const canvas = deps.createCanvas(comp.size.width, comp.size.height);
  const renderer = deps.createRenderer(canvas, deps.media);
  renderer.setFps(comp.fps);
  renderer.setCompSize(comp.size.width, comp.size.height);
  renderer.setViewport(1, 0, 0);

  try {
    const hasAudio = (comp.audioTracks?.length ?? 0) > 0;
    const { output, videoSource, audioSource } = deps.createMuxer(canvas, { videoBitrate, fps: comp.fps, hasAudio });

    await output.start();

    // Add audio EARLY (right after start, before the video loop): it's a
    // single `add()` call handing the whole rendered buffer at once, so
    // audio packets covering the full timeline are available to the muxer
    // immediately — avoiding the "hold all video frames in memory waiting
    // for audio" packet-buffering risk Mediabunny's own docs warn about
    // for multi-track outputs where one track's data lags far behind
    // the other's.
    if (audioSource && resolveAudioUrl) {
      const audioBuffer = await renderCompositionAudio({ comp, resolveUrl: resolveAudioUrl }, deps.audioRenderDeps);
      if (audioBuffer) await audioSource.add(audioBuffer);
    }

    const clock = createVirtualClock({ durationFrames: comp.duration, fps: comp.fps });
    await pumpFrames({
      frameCount: clock.frameCount,
      onProgress,
      async onFrame(index) {
        const frame = clock.frameAt(index) as Frame;
        const tree = evaluateComposition(comp, frame, registry, resolveAsset, resolveComp);
        // MUST be awaited before render(): live playback's RAF loop can rely
        // on TextureManager.get()'s fire-and-forget video seek eventually
        // catching up between ticks, but export renders exactly once per
        // output frame with no further chances to catch up — without this,
        // the exported video shows the same stale frame for its entire
        // duration (see Renderer.prepareFrame's doc).
        await renderer.prepareFrame(tree, comp.fps);
        renderer.render(tree, false, frame, clock.timestampAt(index));
        await videoSource.add(clock.timestampAt(index), clock.frameDuration);
      },
    });

    await output.finalize();

    const buffer = output.finalBuffer;
    if (!buffer) throw new Error("exportToMp4: Output finalized but finalBuffer is null");
    return new Blob([buffer], { type: "video/mp4" });
  } finally {
    renderer.destroy();
  }
}

export { createVirtualClock } from "./virtual-clock";
export type { VirtualClock, VirtualClockOptions } from "./virtual-clock";
export { pumpFrames } from "./frame-pump";
export type { FramePumpOptions } from "./frame-pump";
export { renderCompositionAudio } from "./audio-render";
export type { AudioRenderDeps, AudioRenderOptions, OfflineAudioContextLike } from "./audio-render";
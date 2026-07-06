// packages/export/src/audio-render.ts
//
// Renders every AudioTrack on a Composition into ONE AudioBuffer spanning
// the full export duration, via OfflineAudioContext — the export
// equivalent of `apps/editor/src/audio/audio-engine.ts`'s real-time
// scheduling. The fade/trim/loop/mute/solo math below is deliberately the
// same math as that file's `scheduleAll()`, with one anchor change: live
// playback schedules relative to "now" (`ctx.currentTime`, the moment the
// user hit play, at the CURRENT playhead), while export renders the WHOLE
// timeline in one pass from t=0 — so `startAt`/`endAt` are anchored at the
// track's own `startFrame`/`endFrame` directly, not offset from a playhead.
// If audio-engine.ts's scheduling math ever changes, this should change
// with it — divergence here is exactly the kind of client-preview-vs-export
// mismatch Phase 2's render model was designed to prevent (§5's "WHY THE
// EVALUATOR STAYS PURE" note, same principle applied to audio).
//
// Real `OfflineAudioContext`/`decodeAudioData`/fetch are browser-only —
// this file takes them as injectable dependencies (`AudioRenderDeps`) so
// the scheduling math itself is unit-testable in Node with fakes; the
// actual decode/render can only be verified in a browser.

import type { AudioTrack, Composition } from "core";

/** The subset of `OfflineAudioContext`'s surface this module needs — real browsers' `OfflineAudioContext` satisfies this structurally. */
export interface OfflineAudioContextLike {
  readonly destination: AudioNode;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioBufferSourceNode;
  createGain(): GainNode;
  startRendering(): Promise<AudioBuffer>;
}

export interface AudioRenderDeps {
  /** Creates the offline context to render into. Real default: `new OfflineAudioContext(channels, length, sampleRate)`. */
  createContext: (channels: number, length: number, sampleRate: number) => OfflineAudioContextLike;
  /** Fetches an audio asset's raw bytes by URL. Real default: `fetch(url).then(r => r.arrayBuffer())`. */
  fetchAudio: (url: string) => Promise<ArrayBuffer>;
}

export interface AudioRenderOptions {
  comp: Composition;
  /** Resolves an AudioTrack's `assetId` to a fetchable URL (prefer `asset.master` for export — full quality, not the preview `proxy`; see `apps/api/src/transcode/worker.ts`'s own "master — full quality, used only at export time" note). Returns `undefined` for a track whose asset can't be resolved; that track is silently skipped rather than failing the whole export. */
  resolveUrl: (assetId: string) => string | undefined;
  /** Output sample rate. Default 44100 (CD-quality, universally supported). */
  sampleRate?: number;
  /** Output channel count. Default 2 (stereo). */
  channels?: number;
}

/**
 * Renders `comp.audioTracks` into one AudioBuffer covering
 * `[0, comp.duration / comp.fps)` seconds. Returns `undefined` (rather
 * than a silent AudioBuffer) if the composition has no audio tracks at
 * all — callers should skip adding an audio track to the export entirely
 * in that case rather than muxing a silent one.
 */
export async function renderCompositionAudio(options: AudioRenderOptions, deps: AudioRenderDeps): Promise<AudioBuffer | undefined> {
  const { comp, resolveUrl, sampleRate = 44100, channels = 2 } = options;
  const tracks = comp.audioTracks ?? [];
  if (tracks.length === 0) return undefined;

  const totalDurationSec = comp.duration / comp.fps;
  const length = Math.max(1, Math.ceil(totalDurationSec * sampleRate));
  const ctx = deps.createContext(channels, length, sampleRate);

  const hasSolo = tracks.some((t) => t.solo && !t.muted);

  // Decode every referenced asset once, even if multiple tracks share one
  // (mirrors audio-engine.ts's per-assetId buffer cache) — fetch/decode
  // are the expensive steps; scheduling the decoded buffer is cheap.
  const bufferCache = new Map<string, AudioBuffer>();
  async function decodedBufferFor(track: AudioTrack): Promise<AudioBuffer | undefined> {
    const cached = bufferCache.get(track.assetId);
    if (cached) return cached;
    const url = resolveUrl(track.assetId);
    if (!url) return undefined;
    const bytes = await deps.fetchAudio(url);
    const buffer = await ctx.decodeAudioData(bytes);
    bufferCache.set(track.assetId, buffer);
    return buffer;
  }

  for (const track of tracks) {
    const buffer = await decodedBufferFor(track);
    if (!buffer) continue; // asset unresolvable — skip this track, don't fail the export

    const effectiveMute = track.muted || (hasSolo && !track.solo);

    const trackStartSec = track.startFrame / comp.fps;
    const trackEndSec = track.endFrame !== undefined ? track.endFrame / comp.fps : trackStartSec + (track.trimOut ?? buffer.duration) - track.trimIn;

    const duration = trackEndSec - trackStartSec;
    if (duration <= 0) continue;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = track.loop;
    if (track.loop && track.trimOut !== undefined) {
      source.loopStart = track.trimIn;
      source.loopEnd = track.trimOut;
    }

    const gain = ctx.createGain();
    const targetGain = effectiveMute ? 0 : track.volume;

    // Anchored at the TRACK'S OWN timeline position, not a playhead offset
    // — this is the one deliberate divergence from audio-engine.ts's
    // scheduleAll(), documented at the top of this file.
    const startAt = trackStartSec;
    const endAt = trackEndSec;

    if (track.fadeIn > 0 && !effectiveMute) {
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(targetGain, startAt + track.fadeIn);
    } else {
      gain.gain.setValueAtTime(targetGain, startAt);
    }

    if (track.fadeOut > 0 && !effectiveMute) {
      gain.gain.setValueAtTime(targetGain, endAt - track.fadeOut);
      gain.gain.linearRampToValueAtTime(0, endAt);
    }

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(startAt, track.trimIn, track.loop ? undefined : duration);
  }

  return ctx.startRendering();
}
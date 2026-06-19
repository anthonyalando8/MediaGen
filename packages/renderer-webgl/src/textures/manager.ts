// packages/renderer-webgl/src/textures/manager.ts
//
// "Resolve TexRef → Pixi Texture via media; LRU cache; video frame upload"
// (Deliverable 08).

import { Texture, VideoSource } from "pixi.js";
import { loadTexture as defaultLoadTexture } from "media";
import type { MediaAssetRef, TextureSource as MediaTextureSource } from "media";
import type { TexRef } from "contract";

/**
 * What the editor hands to `createWebGLRenderer` (Deliverable 08:
 * `createWebGLRenderer(canvas, media: MediaService)`). Maps a RenderNode's
 * `tex.assetId` to the fetchable asset. The editor builds this from
 * `Project.assets` (core's `AssetRef`) — see the design note in
 * `media/src/texture-source.ts` — so `renderer-webgl` never needs to depend
 * on `core` (Deliverable 12.1: "renderer-webgl → core ❌").
 */
export interface MediaService {
  resolveAsset(assetId: string): MediaAssetRef | undefined;
}

function defaultCreateTexture(source: MediaTextureSource): Texture {
  if (source.kind === "video") {
    // `Texture.from(videoElement)` creates a VideoSource with `autoPlay: true`
    // by default — Pixi's VideoSource calls `element.play()` immediately,
    // starting the video independently of the timeline. Instead, construct the
    // VideoSource explicitly with `autoPlay: false` so the timeline is the
    // single source of truth for playback state (Viewport.tsx's RAF loop drives
    // playhead; TextureManager.get drives seeks/play/pause from there).
    return new Texture(new VideoSource({ resource: source.element, autoPlay: false }));
  }
  return Texture.from(source.bitmap);
}

export interface TextureManagerOptions {
  /** Max distinct assets kept decoded; least-recently-used entries are evicted beyond this. */
  maxEntries?: number;
  /** Overridable for testing — defaults to `media`'s `loadTexture`. */
  loadTexture?: (asset: MediaAssetRef) => Promise<MediaTextureSource>;
  /** Overridable for testing — defaults to `Texture.from(bitmap | videoElement)`. */
  createTexture?: (source: MediaTextureSource) => Texture;
}

interface CacheEntry {
  source: MediaTextureSource;
  texture: Texture;
  lastUsed: number;
}

export class TextureManager {
  private cache = new Map<string, CacheEntry>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private clock = 0;
  private readonly maxEntries: number;
  private readonly loadTextureFn: (asset: MediaAssetRef) => Promise<MediaTextureSource>;
  private readonly createTextureFn: (source: MediaTextureSource) => Texture;

  constructor(
    private readonly media: MediaService,
    options: TextureManagerOptions = {}
  ) {
    this.maxEntries = options.maxEntries ?? 32;
    this.loadTextureFn = options.loadTexture ?? defaultLoadTexture;
    this.createTextureFn = options.createTexture ?? defaultCreateTexture;
  }

  /**
   * Returns the current Pixi Texture for `tex`. If the asset isn't decoded
   * yet, kicks off an async load (deduped by assetId) and returns
   * `Texture.EMPTY` — the next `render()` call (the editor's RAF loop
   * re-renders every frame, Deliverable 09) will pick up the real texture
   * once it resolves. For video assets with `tex.frame` set, drives
   * playback via one of two paths:
   *
   * 1. SEQUENTIAL PLAYBACK (frame is close to the element's current decoded
   *    position): the element is already playing naturally at the right rate;
   *    just push the latest decoded frame to the GPU via `texture.source.update()`
   *    without touching `currentTime`. Calling `seek()` every RAF tick at 60fps
   *    fires a codec seek every ~16ms, stacking up `seeked` event handlers and
   *    causing ~1s freezes at clip/loop boundaries (the decoder can't keep up).
   *
   * 2. LARGE JUMP (scrubbing, loop restart, clip skip): the element's current
   *    decoded position differs from the requested frame by more than a small
   *    tolerance, so a real codec seek is needed. The element is paused before
   *    seeking and resumed after (or left paused if the store says not playing)
   *    to avoid the browser fighting between the seek and its own natural playback.
   *
   * A load that REJECTS (decode error, unresolvable asset, network
   * failure) is logged once via `console.error` and remembered in
   * `failed` — without this, the rejection from `void this.load(...)`
   * would be an unhandled promise rejection (easy to miss in devtools and
   * gives no indication of WHY a texture stayed blank/black), and without
   * `failed`, `get()` would retry the same failing load every frame
   * (~60/s), spamming the console.
   */
  get(tex: TexRef, fps: number, playing = false): Texture {
    const entry = this.cache.get(tex.assetId);
    if (entry) {
      entry.lastUsed = ++this.clock;
      if (entry.source.kind === "video" && tex.frame !== undefined) {
        const el = entry.source.element;
        const targetTime = tex.frame / fps;
        const halfFrame = 1 / (fps * 2);
        const delta = Math.abs(el.currentTime - targetTime);
        // SEQUENTIAL PLAYBACK: element is already close to the right position —
        // let it play naturally, just push the decoded frame to the GPU.
        if (delta <= halfFrame * 4) {
          if (playing && el.paused) void el.play();
          else if (!playing && !el.paused) el.pause();
          entry.texture.source.update();
        } else {
          // LARGE JUMP (scrubbing/loop/skip): pause first so the browser isn't
          // fighting between the seek and its own natural playback advance, then
          // seek, then resume if the timeline is playing.
          el.pause();
          void entry.source.seek(tex.frame, fps).then(() => {
            entry.texture.source.update();
            if (playing) void el.play();
          });
        }
      }
      return entry.texture;
    }

    if (this.failed.has(tex.assetId)) return Texture.EMPTY;

    if (!this.pending.has(tex.assetId)) {
      this.pending.add(tex.assetId);
      void this.load(tex.assetId)
        .catch((err) => {
          this.failed.add(tex.assetId);
          console.error(`TextureManager: failed to load asset "${tex.assetId}":`, err);
        })
        .finally(() => this.pending.delete(tex.assetId));
    }
    return Texture.EMPTY;
  }

  private async load(assetId: string): Promise<void> {
    const asset = this.media.resolveAsset(assetId);
    if (!asset) {
      throw new Error(`TextureManager: unknown asset "${assetId}" (MediaService.resolveAsset returned undefined)`);
    }
    const source = await this.loadTextureFn(asset);
    const texture = this.createTextureFn(source);
    this.evictIfNeeded();
    this.cache.set(assetId, { source, texture, lastUsed: ++this.clock });
  }

  private evictIfNeeded(): void {
    while (this.cache.size >= this.maxEntries) {
      let oldestId: string | undefined;
      let oldest = Infinity;
      for (const [id, entry] of this.cache) {
        if (entry.lastUsed < oldest) {
          oldest = entry.lastUsed;
          oldestId = id;
        }
      }
      if (oldestId === undefined) break;
      this.evict(oldestId);
    }
  }

  private evict(assetId: string): void {
    const entry = this.cache.get(assetId);
    if (!entry) return;
    entry.texture.destroy(true);
    entry.source.dispose();
    this.cache.delete(assetId);
  }

  /** Releases every cached texture and its underlying media source. */
  destroy(): void {
    for (const assetId of [...this.cache.keys()]) this.evict(assetId);
    this.pending.clear();
    this.failed.clear();
  }
}
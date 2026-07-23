// packages/media/src/texture-source.ts
//
// "AssetRef → ImageBitmap / VideoFrame" (Deliverable 02 directory listing).
//
// DESIGN NOTE — `media` depends only on `contract` (§2.1 dep table), not
// `core`. Core's `AssetRef` (packages/core/src/types/project.ts) is the
// document-level registry entry (content-addressed, `master`/`proxy` paths).
// `MediaAssetRef` below is the resolved, fetchable form the editor builds
// from it when constructing the `MediaService` it hands to the renderer
// (Deliverable 08: `createWebGLRenderer(canvas, media: MediaService)`):
// roughly `{ id: assetRef.id, kind: assetRef.kind, url: assetRef.proxy ??
// assetRef.master }`. Keeping this mapping in the editor (which already
// depends on both `core` and `media`) keeps `media` decoupled from the
// project document shape.
//
// ── FIX IN THIS REVISION: video seek can no longer DEADLOCK an export ────────
// `seek()` previously had two UNBOUNDED awaits: the "seeked" event and
// `requestVideoFrameCallback`. A client export (packages/export) awaits a
// seek for EVERY output frame while the tab is saturated, and either await
// could hang forever:
//   • "seeked" only fires if the seek actually MOVES the position. The first
//     frame of a video clip frequently maps to a time the element is already
//     parked on (currentTime 0), so setting currentTime to (nearly) the same
//     value fires NO "seeked" — and the await never resolves. That is the
//     "freezes at ~49% the moment the video starts, can't even cancel"
//     report: the frame-pump awaits this seek, so the next frame (where the
//     export's cancel flag is checked) never runs.
//   • `requestVideoFrameCallback` can stall for a paused, offscreen element
//     under decoder pressure.
// Both waits are now bounded (resolve-when-already-parked + a timeout race),
// so a stalled seek degrades to a possibly-repeated frame instead of a hard
// freeze, and Cancel takes effect on the following frame. Live playback is
// unaffected — it uses TextureManager.get()'s fire-and-forget path, not this
// awaited one, except for large-jump seeks which only benefit from the same
// robustness.

import { demuxVideoTrack } from "./mp4-demux";
import { VideoDecodeCursor } from "./decode-cursor";

export interface MediaAssetRef {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
}

export interface ImageTextureSource {
  kind: "image";
  assetId: string;
  width: number;
  height: number;
  bitmap: ImageBitmap;
  dispose(): void;
}

/**
 * MVP shortcut (v1.0 doc, §"video textures"): Phase 1 preview uploads frames
 * from a hidden `<video>` element rather than the frame-accurate WebCodecs
 * path (see decoder.ts, wired in Phase 2 for export). The `TexRef{assetId,
 * frame}` contract doesn't change — only this implementation, and only the
 * renderer's TextureManager (Week 5) needs to know about it.
 */
export interface VideoTextureSource {
  kind: "video";
  assetId: string;
  readonly width: number;
  readonly height: number;
  element: HTMLVideoElement;
  /** Seeks to `frame` (at `fps`) and resolves once that frame is decoded and ready to draw — or once a short timeout elapses, so a stalled decode can never hang an awaiting caller (see module doc). */
  seek(frame: number, fps: number): Promise<void>;
  /** The currently-decoded frame as a drawable/uploadable image source. */
  currentFrame(): CanvasImageSource;
  dispose(): void;
}

/**
 * EXPORT-ONLY (ADR-016's real fix): a WebCodecs demux+decode source producing
 * `VideoFrame`s directly, instead of a hidden `<video>` element's `currentTime`
 * seeks. Same `TexRef{assetId, frame}` contract as `VideoTextureSource` — only
 * `renderer-webgl`'s `TextureManager` (manager.ts) needs to know the difference,
 * and only `packages/export`'s deps ever construct one (see `loadTextureForExport`
 * below; live preview keeps using `createVideoTexture`/`loadTexture`, untouched).
 */
export interface VideoFrameTextureSource {
  kind: "video-frames";
  assetId: string;
  readonly width: number;
  readonly height: number;
  /** Advances (or, on a backward jump, resets and re-decodes from) the cursor to the frame at `frame/fps`, resolving once that frame is decoded. */
  seek(frame: number, fps: number): Promise<void>;
  /** The most recently decoded frame. Do NOT call `.close()` on this yourself — the underlying cursor owns its lifecycle (see `VideoDecodeCursor`'s doc). */
  currentFrame(): VideoFrame;
  dispose(): void;
}

export type TextureSource = ImageTextureSource | VideoTextureSource | VideoFrameTextureSource;

/** Decodes an image asset into an ImageBitmap ready for GPU upload. */
export async function loadImageTexture(asset: MediaAssetRef): Promise<ImageTextureSource> {
  const response = await fetch(asset.url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  return {
    kind: "image",
    assetId: asset.id,
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
    dispose: () => bitmap.close(),
  };
}

/** One frame's tolerance is `1/(fps)` seconds; "already parked" uses a fraction of that so genuinely distinct export frames are never collapsed, but a no-op re-seek to the current position doesn't wait for a "seeked" that will never fire. */
const PARKED_EPSILON_SEC = 0.001;
/** Upper bound on how long a single seek waits for "seeked" before giving up and proceeding with whatever frame is decoded. Generous enough for a real seek on a busy tab, short enough that a genuine stall doesn't look like a freeze. */
const SEEK_TIMEOUT_MS = 3000;
/** Upper bound on the wait for a freshly-decoded frame to be PRESENTED (rVFC) after the seek resolves. */
const PRESENT_TIMEOUT_MS = 1000;

/**
 * Sets `el.currentTime = time` and resolves when the seek completes — but
 * NEVER hangs. Resolves immediately when the element is already parked at
 * `time` and not mid-seek (a no-op re-seek fires no "seeked" event), and
 * races the "seeked" wait against a timeout for a decoder stall.
 */
function waitForSeek(el: HTMLVideoElement, time: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!el.seeking && Math.abs(el.currentTime - time) <= PARKED_EPSILON_SEC) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      el.removeEventListener("seeked", finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, SEEK_TIMEOUT_MS);
    el.addEventListener("seeked", finish);
    try {
      el.currentTime = time;
    } catch {
      finish();
    }
  });
}

/**
 * Waits for a newly-decoded frame to be presented — `requestVideoFrameCallback`
 * where available (resolves only once a new frame is actually on screen, so an
 * upload right after "seeked" doesn't grab the PREVIOUS frame), else a single
 * rAF settle. Bounded by a timeout so a stalled callback can't hang the caller.
 */
function waitForPresentedFrame(el: HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, PRESENT_TIMEOUT_MS);
    if (typeof el.requestVideoFrameCallback === "function") {
      el.requestVideoFrameCallback(() => finish());
    } else {
      requestAnimationFrame(() => finish());
    }
  });
}

/**
 * Creates a hidden `<video>`-backed texture source for `asset` (MVP
 * shortcut — see above). ASYNC, unlike a bare `new HTMLVideoElement()`
 * call would be: resolves only once the element has decoded at least one
 * PAINTABLE frame (`loadeddata`), not merely `loadedmetadata` (which only
 * guarantees `videoWidth`/`videoHeight`/`duration` are known, NOT that a
 * frame exists to read pixels from). `TextureManager.load` (manager.ts)
 * calls `Texture.from(source.element)` on whatever this returns — calling
 * that before a frame is decoded creates a texture backed by an empty/
 * blank video element, which uploads as solid black and is never
 * refreshed again, since nothing re-triggers a GPU re-upload once the
 * first real frame eventually does arrive.
 */
export async function createVideoTexture(asset: MediaAssetRef): Promise<VideoTextureSource> {
  const element = document.createElement("video");

  // MUST be set before `src` — the browser decides whether a media
  // element is "tainted" for canvas/WebGL reads at the moment `src` is
  // assigned, based on `crossOrigin` as it stood at that instant. Setting
  // it after has no effect. Previously every URL this function ever saw
  // was same-origin (`blob:`/`data:`), so this was never needed; Week 12's
  // server-hosted `asset.master`/`proxy` (`http://localhost:3001/...`) is
  // genuinely cross-origin from the editor's `:5173`, so without this,
  // `texImage2D` throws `SecurityError: ... contains cross-origin data`
  // even though the server sends correct CORS headers on the bytes
  // themselves — the video element's own flag is a separate gate.
  element.crossOrigin = "anonymous";

  // `data:` URLs are what `AssetRef.master` persists for an uploaded asset
  // (asset-upload.ts — they survive JSON/localStorage round-trips, unlike
  // `blob:` URLs, satisfying exit criterion 10). But `<video src="data:..."`
  // has poor cross-browser support for `currentTime` SEEKING — the
  // `seeked` event (which `seek()` below awaits) may never fire, leaving
  // the element's decoded frame black indefinitely. Re-wrap the SAME bytes
  // as a `blob:` object URL for the `<video>` element itself, which has
  // normal seek support; `objectUrl` is revoked in `dispose()`.
  const objectUrl = asset.url.startsWith("data:") ? dataUrlToObjectUrl(asset.url) : undefined;
  element.src = objectUrl ?? asset.url;
  element.muted = true;
  element.playsInline = true;
  element.preload = "auto";

  const ready = new Promise<void>((resolve, reject) => {
    element.addEventListener("loadedmetadata", () => resolve(), { once: true });
    element.addEventListener(
      "error",
      () => reject(new Error(`failed to load video asset "${asset.id}" from ${asset.url}`)),
      { once: true }
    );
  });

  // Awaited HERE (not just inside `seek()`) so `loadTexture` — and thus
  // `TextureManager.load` — only resolves once a frame actually exists.
  await new Promise<void>((resolve, reject) => {
    element.addEventListener("loadeddata", () => resolve(), { once: true });
    element.addEventListener(
      "error",
      () => reject(new Error(`failed to load video asset "${asset.id}" from ${asset.url}`)),
      { once: true }
    );
  });

  return {
    kind: "video",
    assetId: asset.id,
    get width() {
      return element.videoWidth;
    },
    get height() {
      return element.videoHeight;
    },
    element,
    async seek(frame, fps) {
      await ready;
      const time = frame / fps;

      // Park the element on `time` (bounded — never hangs; see waitForSeek's
      // doc for why a strict "seeked"-only wait deadlocked exports on the
      // first video frame), then wait for the decoded frame to be presented
      // before returning so the caller uploads the RIGHT frame, not the
      // previous one.
      await waitForSeek(element, time);
      await waitForPresentedFrame(element as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number });
    },
    currentFrame() {
      return element;
    },
    dispose() {
      element.pause();
      element.removeAttribute("src");
      element.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  };
}

/** Decodes a `data:<mime>;base64,<data>` URL into a `blob:` object URL with the same bytes/MIME type. */
export function dataUrlToObjectUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(5, comma); // "<mime>;base64"
  const mime = header.slice(0, header.indexOf(";")) || "application/octet-stream";
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** Loads `asset` into a TextureSource, dispatching on `asset.kind`. */
export async function loadTexture(asset: MediaAssetRef): Promise<TextureSource> {
  switch (asset.kind) {
    case "image":
      return loadImageTexture(asset);
    case "video":
      return createVideoTexture(asset);
    default:
      throw new Error(`unsupported asset kind for texture loading: "${asset.kind}"`);
  }
}

/**
 * EXPORT-ONLY: demuxes `asset` (via mp4-demux.ts) and decodes it with a
 * `VideoDecodeCursor` (decode-cursor.ts) instead of a hidden `<video>`
 * element — the real fix ADR-016 scoped. Seeks the cursor to frame 0 before
 * resolving, mirroring `createVideoTexture`'s "resolves only once a frame
 * actually exists" contract, so `currentFrame()` is valid the instant this
 * returns (`TextureManager.load`, manager.ts, immediately builds a GPU
 * texture from it).
 */
export async function createVideoFrameTexture(asset: MediaAssetRef): Promise<VideoFrameTextureSource> {
  const track = await demuxVideoTrack(asset.url);
  // Without this, a decode error (any codec-level issue in this specific
  // asset — decoder.ts's default `onError` is a silent no-op) would surface
  // nowhere: the export would just freeze on whatever frame triggered it,
  // with no indication why (decoder.ts's own doc now explains the promise
  // side of this; this is the visibility side).
  const cursor = new VideoDecodeCursor(track, (error) => {
    console.error(`createVideoFrameTexture: decode error on asset "${asset.id}" (${asset.url}):`, error);
  });
  await cursor.seekTo(0);

  return {
    kind: "video-frames",
    assetId: asset.id,
    width: track.config.codedWidth ?? 0,
    height: track.config.codedHeight ?? 0,
    async seek(frame, fps) {
      await cursor.seekTo((1e6 * frame) / fps);
    },
    currentFrame() {
      return cursor.currentFrame();
    },
    dispose() {
      cursor.dispose();
    },
  };
}

/**
 * Same dispatch as `loadTexture`, except video assets route through the
 * WebCodecs demux path (`createVideoFrameTexture`) instead of the hidden
 * `<video>` element. Images are unchanged. This is the one seam
 * `packages/export`'s `defaultExportDeps` injects to gate the new path to
 * export only — live preview keeps calling `loadTexture` (via
 * `createWebGLRenderer`'s default), completely untouched.
 */
export async function loadTextureForExport(asset: MediaAssetRef): Promise<TextureSource> {
  switch (asset.kind) {
    case "image":
      return loadImageTexture(asset);
    case "video":
      return createVideoFrameTexture(asset);
    default:
      throw new Error(`unsupported asset kind for texture loading: "${asset.kind}"`);
  }
}

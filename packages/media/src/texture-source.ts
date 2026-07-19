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
  /** Seeks to `frame` (at `fps`) and resolves once that frame is decoded and ready to draw. */
  seek(frame: number, fps: number): Promise<void>;
  /** The currently-decoded frame as a drawable/uploadable image source. */
  currentFrame(): CanvasImageSource;
  dispose(): void;
}

export type TextureSource = ImageTextureSource | VideoTextureSource;

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
  // `blob:` URLs, satisfying exit criterion 10). But `<video src="data:...">`
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

      // Deliberately NO "already close enough, skip the seek" early-return
      // here. That optimization belongs ONLY to live playback's
      // fire-and-forget path in TextureManager.get() (which calls the video
      // element directly, not this method, during sequential playback).
      // When something AWAITS this seek() — i.e. a client export preparing
      // one exact frame at a time — it needs the element genuinely parked on
      // `time`, every time. The old tolerance check read the post-seek
      // `currentTime` (which lands slightly off the requested time due to
      // keyframe snapping + float imprecision), so two consecutive export
      // frames 1/fps apart could fall within half-a-frame tolerance and the
      // second seek was silently skipped — capturing the SAME frame twice,
      // or freezing on one frame for the whole export.
      if (element.currentTime !== time) {
        await new Promise<void>((resolve) => {
          const onSeeked = (): void => {
            element.removeEventListener("seeked", onSeeked);
            resolve();
          };
          element.addEventListener("seeked", onSeeked);
          element.currentTime = time;
        });
      }

      // The "seeked" event fires when the seek POSITION is set — NOT when
      // the frame at that position has been decoded and is ready to sample
      // into a texture. Uploading right after "seeked" can grab the
      // PREVIOUS frame's pixels. `requestVideoFrameCallback` resolves only
      // once a new frame has actually been presented, closing that gap.
      // Not universally available (Firefox lacks it as of writing), so fall
      // back to a microtask+rAF settle, which is empirically enough for the
      // decode to land in Chromium/Edge/WebKit where it IS the export target.
      const el = element as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (typeof el.requestVideoFrameCallback === "function") {
        await new Promise<void>((resolve) => {
          el.requestVideoFrameCallback!(() => resolve());
        });
      } else {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
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
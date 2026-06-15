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

/** Creates a hidden `<video>`-backed texture source for `asset` (MVP shortcut — see above). */
export function createVideoTexture(asset: MediaAssetRef): VideoTextureSource {
  const element = document.createElement("video");

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
      const halfFrame = 1 / (fps * 2);
      if (Math.abs(element.currentTime - time) < halfFrame) return; // already at/near this frame
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          element.removeEventListener("seeked", onSeeked);
          resolve();
        };
        element.addEventListener("seeked", onSeeked);
        element.currentTime = time;
      });
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
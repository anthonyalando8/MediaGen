// apps/editor/src/persistence/asset-upload.ts
//
// File -> AssetRef (core's content-addressed asset reference, project.ts)
// for exit criterion 02 ("User adds an image from upload"). Reads `file` as
// a `data:` URL — NOT `URL.createObjectURL` — because `blob:` URLs don't
// survive a page reload, and exit criterion 10 requires the project to
// "persist and re-render identically" after reload: a `data:` URL
// round-trips through `JSON.stringify`/`ProjectSchema` in
// persistence/local-storage.ts unchanged, so `AssetRef.master` stays valid.
//
// P1 TRADEOFF: localStorage has a ~5-10MB/origin quota, so this works for a
// handful of small images/clips but isn't a real asset library —
// `apps/api`'s asset routes (Week 8) are the P2 path for that (`AssetRef`
// already supports `proxy`/`master` as separate URLs for exactly this kind
// of swap).

import { createId } from "core";
import type { AssetRef } from "core";

const ASSET_KIND_BY_MIME_PREFIX: Partial<Record<string, AssetRef["kind"]>> = {
  image: "image",
  video: "video",
  audio: "audio",
};

/**
 * Upload progress, reported via `fileToAssetRef`'s `onProgress` callback —
 * MediaPalette's upload button surfaces this as a progress bar, so a large
 * video doesn't appear to "do nothing" for several seconds before suddenly
 * appearing.
 *
 * `"reading"` has a real byte-level `fraction` (FileReader's `onprogress`).
 * `"detecting-dimensions"` does not — there's no meaningful percentage for
 * "decode one frame of a video to read its dimensions" — so the UI should
 * show this stage as indeterminate (e.g. an animated/striped bar) rather
 * than try to interpolate a fake number.
 */
export type UploadProgress = { stage: "reading"; fraction: number } | { stage: "detecting-dimensions" } | { stage: "saving" };

/** Maps a File's MIME type (`"image/png"` -> `"image"`) to an AssetRef.kind. Throws for unsupported types (e.g. documents, fonts — fonts use a separate import path, not this one). */
export function assetKindForFile(file: File): AssetRef["kind"] {
  const prefix = file.type.split("/")[0];
  const kind = ASSET_KIND_BY_MIME_PREFIX[prefix];
  if (!kind) throw new Error(`assetKindForFile: unsupported file type "${file.type || "(unknown)"}"`);
  return kind;
}

/**
 * Reads `file` into a `data:` URL, reporting byte-level progress via
 * `onProgress`. Uses `FileReader.readAsArrayBuffer` (NOT `file.arrayBuffer()`)
 * specifically because `FileReader` fires `progress` events as bytes are
 * read — `file.arrayBuffer()` is a single opaque Promise with no
 * intermediate signal at all, which is exactly why uploads previously
 * looked frozen for large files. Falls back to the no-progress
 * `arrayBuffer()` path when `FileReader` isn't available (vitest's default
 * Node test environment).
 */
function readAsDataURL(file: File, onProgress?: (fraction: number) => void): Promise<string> {
  if (typeof FileReader === "undefined") {
    return file.arrayBuffer().then((buffer) => `data:${file.type};base64,${arrayBufferToBase64(buffer)}`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    reader.onload = () => {
      onProgress?.(1);
      resolve(reader.result as string); // readAsDataURL already produces a "data:<mime>;base64,..." string
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/** `ArrayBuffer` -> base64. Uses `Buffer` under Node (vitest's default test environment, where `FileReader`/`btoa` aren't global) via a structural lookup — `@types/node` isn't part of this project's `tsconfig` `lib`, so `Buffer` can't be referenced by name; falls back to `btoa` in the browser. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const nodeBuffer = (globalThis as { Buffer?: { from(b: ArrayBuffer): { toString(encoding: string): string } } }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(buffer).toString("base64");
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Cheap non-cryptographic hash (djb2) of `data` — `AssetRef.hash` (v1.0
 * §12, "content-addressed") just needs a stable string here. P1 doesn't
 * dedupe re-uploads of the same file by hash.
 */
function djb2(data: string): string {
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = (hash * 33) ^ data.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Week 12 (Asset Pipeline) — real server-backed upload, as an alternative
 * to `fileToAssetRef`'s local `data:` URL path below. POSTs the raw file
 * to `apps/api`'s `POST /assets/upload` (Deliverable 05 §5.1.2), then polls
 * `GET /assets/:id` until the transcode worker flips it from `"pending"` to
 * `"ready"` (or `"failed"`) — see `apps/api/src/transcode/worker.ts` for
 * what populates `proxy`/`poster`/`waveform` along the way.
 *
 * This function is intentionally NOT wired into `fileToAssetRef` itself:
 * that function's `data:` URL behavior is depended on directly by existing
 * tests and by every current call site (`MediaPalette`, `AudioUploadPanel`,
 * `CompSetupPanel`), and it's the correct fallback when no backend is
 * reachable at all (see `fileToAssetRefViaServerOrLocal` below, which picks
 * between the two). Callers that specifically want real content-addressed
 * storage + ffmpeg derivatives (proxy/poster/waveform, not the fake CSS
 * waveform mask) should call this directly once their panel is ready to
 * handle a `"pending" -> "ready"` transition in the UI.
 */
export type ServerUploadProgress = { stage: "uploading" } | { stage: "transcoding" } | { stage: "ready" };

export interface UploadToServerOptions {
  /** Base URL of `apps/api`, e.g. `"http://localhost:3001"`. No trailing slash. */
  apiBaseUrl: string;
  onProgress?: (progress: ServerUploadProgress) => void;
  /** Poll interval while waiting for the transcode job, in ms. Default 500. */
  pollIntervalMs?: number;
  /** Give up waiting for "ready" after this many ms and throw — default 60s, generous for a single-worker in-process queue (see `transcode/queue.ts`) under load. */
  timeoutMs?: number;
}

/** Thrown when the transcode worker marks the asset `"failed"` — `err.message` is `AssetRef.meta.error` from `transcodeAsset()`'s catch block. */
export class AssetTranscodeError extends Error {}

/**
 * `apps/api`'s responses use paths relative to the API's own origin
 * (`/assets/:id/object/:variant`) — correct for the API to emit, since it
 * doesn't know what origin the editor is served from, but wrong for the
 * editor to use directly: a bare `/assets/...` resolves against the
 * editor's own origin (e.g. Vite's `:5173`), not the API's (e.g. `:3001`),
 * which are different origins in normal local dev. Rewritten once here so
 * every downstream consumer (the store, the renderer's TexRef resolution,
 * `AudioEngine`) can treat `master`/`proxy`/`poster`/`waveform` as ordinary
 * fetchable URLs without needing to know `apiBaseUrl` itself.
 */
function resolveAssetUrls(asset: AssetRef, apiBaseUrl: string): AssetRef {
  const resolve = (url: string | undefined): string | undefined => (url?.startsWith("/") ? `${apiBaseUrl}${url}` : url);
  return { ...asset, master: resolve(asset.master) ?? asset.master, proxy: resolve(asset.proxy), poster: resolve(asset.poster), waveform: resolve(asset.waveform) };
}

/** Uploads `file`'s real bytes to `apps/api` and waits for derivatives. Returns the `"ready"` `AssetRef` (with `proxy`/`poster`/`waveform` populated where applicable, and every URL absolute) — not a `data:` URL. */
export async function uploadAssetToServer(file: File, options: UploadToServerOptions): Promise<AssetRef> {
  const { apiBaseUrl, onProgress, pollIntervalMs = 500, timeoutMs = 60_000 } = options;

  onProgress?.({ stage: "uploading" });
  const body = new FormData();
  body.append("file", file, file.name);

  const uploadRes = await fetch(`${apiBaseUrl}/assets/upload`, { method: "POST", body });
  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => "");
    throw new Error(`uploadAssetToServer: upload failed (${uploadRes.status}) ${detail}`);
  }
  const pending = (await uploadRes.json()) as AssetRef;

  onProgress?.({ stage: "transcoding" });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const statusRes = await fetch(`${apiBaseUrl}/assets/${pending.id}`);
    if (!statusRes.ok) throw new Error(`uploadAssetToServer: polling failed (${statusRes.status})`);
    const asset = (await statusRes.json()) as AssetRef;
    const status = asset.meta?.status;

    if (status === "ready") {
      onProgress?.({ stage: "ready" });
      return resolveAssetUrls(asset, apiBaseUrl);
    }
    if (status === "failed") {
      throw new AssetTranscodeError(typeof asset.meta?.error === "string" ? asset.meta.error : "transcode failed");
    }
    if (Date.now() > deadline) {
      throw new Error(`uploadAssetToServer: timed out waiting for asset "${pending.id}" to finish transcoding`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Tries the real server upload first, falls back to the local `data:` URL
 * path (`fileToAssetRef`) if the backend isn't reachable at all (network
 * error — e.g. `apps/api` isn't running, which is still the common case
 * during editor-only local dev). Does NOT fall back on a slow/failed
 * transcode once the upload itself succeeded — a `"failed"` status or
 * timeout is a real error the caller should surface, not silently swallow
 * into a degraded local copy.
 */
export async function fileToAssetRefViaServerOrLocal(file: File, apiBaseUrl: string, onProgress?: (progress: UploadProgress | ServerUploadProgress) => void): Promise<AssetRef> {
  try {
    return await uploadAssetToServer(file, { apiBaseUrl, onProgress });
  } catch (err) {
    if (err instanceof AssetTranscodeError) throw err; // real backend error — don't mask it with a degraded local copy
    if (err instanceof Error && err.message.startsWith("uploadAssetToServer: upload failed")) throw err; // backend reachable but rejected the file — surface it
    return fileToAssetRef(file, onProgress); // backend unreachable — fall back to local-only P1 behavior
  }
}

/** Builds an `AssetRef` from an uploaded `File` — MediaPalette's file input calls this, then `store.addAsset(...)`. */
export async function fileToAssetRef(file: File, onProgress?: (progress: UploadProgress) => void): Promise<AssetRef> {
  const kind = assetKindForFile(file);
  const dataUrl = await readAsDataURL(file, (fraction) => onProgress?.({ stage: "reading", fraction }));
  onProgress?.({ stage: "detecting-dimensions" });
  const dims = await detectDimensions(kind, dataUrl);
  return {
    id: createId(),
    hash: djb2(dataUrl),
    kind,
    master: dataUrl,
    provenance: "upload",
    ...dims,
  };
}

/**
 * Decodes `dataUrl` just far enough to read native pixel dimensions —
 * stored on the resulting `AssetRef` (see its doc) so `image.ts`/
 * `video.ts`'s `imageBox` can size `RenderNode.box` to the asset's actual
 * aspect ratio instead of falling back to the composition's frame.
 *
 * Gracefully returns `{}` (no dimensions) outside a browser — e.g. under
 * vitest's default Node test environment, which has neither
 * `createImageBitmap` nor `document.createElement("video")` — so tests for
 * the surrounding upload flow don't need a DOM. In that case `imageBox`
 * simply keeps its P1 composition-frame fallback, same as before this
 * feature existed.
 */
async function detectDimensions(kind: AssetRef["kind"], dataUrl: string): Promise<{ width?: number; height?: number }> {
  if (kind === "image" && typeof createImageBitmap === "function") {
    const blob = await fetch(dataUrl).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  }

  if (kind === "video" && typeof document !== "undefined") {
    return new Promise((resolve) => {
      const element = document.createElement("video");
      const cleanup = (): void => {
        element.removeAttribute("src");
        element.load();
      };
      element.addEventListener(
        "loadedmetadata",
        () => {
          const dims = { width: element.videoWidth, height: element.videoHeight };
          cleanup();
          resolve(dims);
        },
        { once: true }
      );
      element.addEventListener(
        "error",
        () => {
          cleanup();
          resolve({}); // dimension detection is best-effort — fall back to imageBox's P1 default rather than fail the whole upload
        },
        { once: true }
      );
      element.src = dataUrl;
    });
  }

  return {};
}
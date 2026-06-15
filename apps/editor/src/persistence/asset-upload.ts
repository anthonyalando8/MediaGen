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

/** Maps a File's MIME type (`"image/png"` -> `"image"`) to an AssetRef.kind. Throws for unsupported types (e.g. documents, fonts — fonts use a separate import path, not this one). */
export function assetKindForFile(file: File): AssetRef["kind"] {
  const prefix = file.type.split("/")[0];
  const kind = ASSET_KIND_BY_MIME_PREFIX[prefix];
  if (!kind) throw new Error(`assetKindForFile: unsupported file type "${file.type || "(unknown)"}"`);
  return kind;
}

function readAsDataURL(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => `data:${file.type};base64,${arrayBufferToBase64(buffer)}`);
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

/** Builds an `AssetRef` from an uploaded `File` — MediaPalette's file input calls this, then `store.addAsset(...)`. */
export async function fileToAssetRef(file: File): Promise<AssetRef> {
  const kind = assetKindForFile(file);
  const dataUrl = await readAsDataURL(file);
  return {
    id: createId(),
    hash: djb2(dataUrl),
    kind,
    master: dataUrl,
    provenance: "upload",
  };
}
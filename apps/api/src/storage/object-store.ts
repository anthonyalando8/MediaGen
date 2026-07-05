// apps/api/src/storage/object-store.ts
//
// Content-addressed object storage (Week 12, Deliverable 05 §5.1.1). The
// blueprint's `infra/docker-compose.yml` calls for MinIO — out of scope for
// this sandbox (no object storage service available), so this is a
// disk-backed CAS behind the same swap pattern as `db/schema.ts`'s
// `ProjectStore`/`AssetStore`: `buildApp()` takes an `ObjectStore` via
// options, so an S3/MinIO-backed implementation of this interface drops in
// later without touching `routes/upload.ts` or the transcode worker.
//
// Real SHA-256 (not `asset-upload.ts`'s client-side djb2) so re-uploads of
// the same bytes dedupe — closes the gap that file's comment flags: "P1
// doesn't dedupe re-uploads of the same file by hash."

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ObjectStore {
  /** Hashes `bytes` (SHA-256), writes it if not already present, and returns the hash. Idempotent — re-putting the same bytes is a cheap no-op after the first write. */
  put(bytes: Buffer): Promise<string>;
  /** Reads bytes by hash. Throws if the object doesn't exist — callers that need existence-checking should call `has()` first. */
  get(hash: string): Promise<Buffer>;
  has(hash: string): Promise<boolean>;
  /** Absolute path an object would live at, for tools (ffmpeg) that need a real file path rather than a Buffer. Does not guarantee the file exists — pair with `has()`. */
  pathFor(hash: string): string;
}

function hashOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Disk-backed CAS under `<root>/<hash[0:2]>/<hash>` — sharded by hash prefix so a single directory never accumulates thousands of entries. */
export function createDiskObjectStore(root: string): ObjectStore {
  const pathFor = (hash: string): string => join(root, hash.slice(0, 2), hash);

  return {
    pathFor,

    async has(hash) {
      try {
        await stat(pathFor(hash));
        return true;
      } catch {
        return false;
      }
    },

    async put(bytes) {
      const hash = hashOf(bytes);
      const path = pathFor(hash);
      if (await this.has(hash)) return hash; // dedup: identical bytes already stored
      await mkdir(join(root, hash.slice(0, 2)), { recursive: true });
      await writeFile(path, bytes);
      return hash;
    },

    async get(hash) {
      return readFile(pathFor(hash));
    },
  };
}

/** In-memory variant for tests — same interface, no filesystem, so route/queue tests don't need a tmp dir per run. */
export function createInMemoryObjectStore(): ObjectStore {
  const objects = new Map<string, Buffer>();

  return {
    pathFor(hash) {
      // No real path exists for the in-memory store; callers that need a
      // filesystem path (the ffmpeg transcode step) must use the disk
      // store in any environment that actually shells out to ffmpeg.
      throw new Error("createInMemoryObjectStore: pathFor() is unsupported — use createDiskObjectStore for ffmpeg-backed tests");
    },
    async has(hash) {
      return objects.has(hash);
    },
    async put(bytes) {
      const hash = hashOf(bytes);
      if (!objects.has(hash)) objects.set(hash, bytes);
      return hash;
    },
    async get(hash) {
      const bytes = objects.get(hash);
      if (!bytes) throw new Error(`createInMemoryObjectStore: no object for hash "${hash}"`);
      return bytes;
    },
  };
}
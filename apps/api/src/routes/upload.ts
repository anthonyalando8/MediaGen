// apps/api/src/routes/upload.ts
//
// Real byte upload + transcode kickoff (Week 12, Deliverable 05 §5.1.2).
// Complements `routes/asset.ts`'s existing `POST /assets`, which only ever
// accepted pre-built `AssetRef` *metadata* (comment: "actual file bytes go
// to object storage ... out of sandbox scope"). This route is that missing
// half: it accepts the raw file, stores it by hash, creates a `pending`
// `AssetRef`, enqueues a transcode job, and returns immediately — the
// blueprint's "returns immediately with a pending AssetRef" shape.
//
// `GET /assets/:id/object/:variant` is the read side: serves whichever
// derivative (`master`/`proxy`/`poster`/`waveform`) is ready, resolved via
// `AssetRef.meta.objects` (see `transcode/worker.ts`).

import type { FastifyInstance } from "fastify";
import { createId } from "core";
import type { AssetRef } from "core";
import type { AssetStore } from "../db/schema";
import type { ObjectStore } from "../storage/object-store";
import type { TranscodeQueue } from "../transcode/queue";
import { defaultMimeFor } from "../transcode/worker";

const KIND_BY_MIME_PREFIX: Partial<Record<string, AssetRef["kind"]>> = {
  image: "image",
  video: "video",
  audio: "audio",
  font: "font",
};

function kindForMime(mime: string): AssetRef["kind"] {
  const prefix = mime.split("/")[0];
  const kind = KIND_BY_MIME_PREFIX[prefix];
  if (!kind) throw new Error(`upload: unsupported mime type "${mime}"`);
  return kind;
}

export interface UploadRouteDeps {
  assetStore: AssetStore;
  objectStore: ObjectStore;
  queue: TranscodeQueue;
}

export function registerUploadRoutes(app: FastifyInstance, deps: UploadRouteDeps): void {
  const { assetStore, objectStore, queue } = deps;

  app.post("/assets/upload", async (req, reply) => {
    const data = await req.file();
    if (!data) {
      reply.code(400);
      return { error: "no file in request (expected multipart/form-data with a single file field)" };
    }

    let kind: AssetRef["kind"];
    try {
      kind = kindForMime(data.mimetype);
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }

    const bytes = await data.toBuffer();
    const originalHash = await objectStore.put(bytes);
    const assetId = createId();

    const asset: AssetRef = {
      id: assetId,
      hash: originalHash,
      kind,
      master: `/assets/${assetId}/object/master`, // resolvable immediately: transcodeAsset() sets "master" = original passthrough for every kind
      provenance: "upload",
      meta: {
        status: "pending",
        objects: { original: { hash: originalHash, mime: data.mimetype } },
      },
    };
    assetStore.put(asset);
    queue.enqueue({ assetId });

    reply.code(202);
    return asset;
  });

  app.get("/assets/:id/object/:variant", async (req, reply) => {
    const { id, variant } = req.params as { id: string; variant: string };
    const asset = assetStore.get(id);
    if (!asset) {
      reply.code(404);
      return { error: `asset "${id}" not found` };
    }

    const objects = (asset.meta?.objects ?? {}) as Record<string, { hash: string; mime: string } | undefined>;
    const record = objects[variant];
    if (!record) {
      reply.code(404);
      return { error: `asset "${id}" has no "${variant}" object (status: ${(asset.meta?.status as string) ?? "unknown"})` };
    }

    const bytes = await objectStore.get(record.hash);
    reply.header("content-type", record.mime || defaultMimeFor(asset.kind));
    // HTTP Range support is REQUIRED for <video>/<audio> seeking against
    // these URLs. Browsers seek server-hosted media by issuing
    // `Range: bytes=start-` requests for the target position; a server
    // that ignores Range and always replies 200 + full body makes
    // `element.currentTime = t` effectively a no-op for any not-yet-buffered
    // position — the element keeps decoding the same frame. Observed as:
    // exported video frozen on a single frame whenever the asset's `master`
    // was a server URL (the export's frame-by-frame `prepare()` seek never
    // actually moved), while the same export worked fine for videos on the
    // local `data:`/`blob:` path (blob URLs seek without HTTP entirely).
    reply.header("accept-ranges", "bytes");

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      const size = bytes.length;
      if (match && (match[1] !== "" || match[2] !== "")) {
        let start: number;
        let end: number;
        if (match[1] === "") {
          // Suffix form "bytes=-N": the LAST N bytes.
          const suffixLength = parseInt(match[2], 10);
          start = Math.max(0, size - suffixLength);
          end = size - 1;
        } else {
          start = parseInt(match[1], 10);
          end = match[2] === "" ? size - 1 : Math.min(parseInt(match[2], 10), size - 1);
        }

        if (start >= size || start > end) {
          reply.code(416); // Range Not Satisfiable
          reply.header("content-range", `bytes */${size}`);
          return reply.send();
        }

        reply.code(206);
        reply.header("content-range", `bytes ${start}-${end}/${size}`);
        return reply.send(bytes.subarray(start, end + 1));
      }
      // Malformed Range header — per RFC 7233 a server MAY ignore it; fall
      // through to a plain 200 full response.
    }

    return reply.send(bytes);
  });
}
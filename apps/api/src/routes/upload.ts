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
    return reply.send(bytes);
  });
}
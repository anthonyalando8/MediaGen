// apps/api/src/index.ts
//
// Fastify app factory (Deliverable 11: "Fastify ... project CRUD + asset
// upload (P1)"). `buildApp()` is the unit under test — it builds a fresh
// app with its own in-memory stores (db/schema.ts) and never binds a port,
// so route tests use Fastify's `.inject()` directly (no network needed in
// this sandbox). `start()` is the real entrypoint, not exercised by tests.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { registerAssetRoutes } from "./routes/asset";
import { registerProjectRoutes } from "./routes/project";
import { registerUploadRoutes } from "./routes/upload";
import { createInMemoryAssetStore, createInMemoryProjectStore } from "./db/schema";
import type { AssetStore, ProjectStore } from "./db/schema";
import { createDiskObjectStore } from "./storage/object-store";
import type { ObjectStore } from "./storage/object-store";
import { createInProcessQueue } from "./transcode/queue";
import type { TranscodeQueue } from "./transcode/queue";
import { transcodeAsset } from "./transcode/worker";

export interface BuildAppOptions {
  projectStore?: ProjectStore;
  assetStore?: AssetStore;
  objectStore?: ObjectStore;
  /** Injectable for tests that want to observe/await jobs without going through ffmpeg — defaults to a real ffmpeg-backed queue wired to `objectStore`. */
  queue?: TranscodeQueue;
  /** Root directory for the default disk object store. Defaults to `<cwd>/data/objects`, mirroring `infra/docker-compose.yml`'s dev-local philosophy (real MinIO is P2). */
  objectStoreRoot?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify();
  const projectStore = options.projectStore ?? createInMemoryProjectStore();
  const assetStore = options.assetStore ?? createInMemoryAssetStore();
  const objectStore = options.objectStore ?? createDiskObjectStore(options.objectStoreRoot ?? join(process.cwd(), "data", "objects"));
  const queue = options.queue ?? createInProcessQueue((job) => transcodeAsset(job.assetId, assetStore, objectStore));

  app.register(cors, { origin: true }); // dev-only: reflects any origin — apps/editor runs on a different port (5173 vs 3001)
  app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

  registerProjectRoutes(app, projectStore);
  registerAssetRoutes(app, assetStore);
  registerUploadRoutes(app, { assetStore, objectStore, queue });

  return app;
}

export async function start(port = 3001): Promise<void> {
  const app = buildApp();
  // host must be explicit: Fastify's listen() defaults to 127.0.0.1, which
  // is unreachable from outside a container (the docker/api.Dockerfile
  // healthcheck runs inside the container so it passes regardless — only
  // requests routed in through Docker's port mapping notice).
  await app.listen({ port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`);
}

// Only start the server when this file is run directly (`tsx src/index.ts`
// via the "dev" script) — not when imported by tests, which call
// buildApp() themselves and never touch start(). Uses `pathToFileURL`
// rather than manual string interpolation because on Windows
// `process.argv[1]` is a backslash path (`D:\...`) while `import.meta.url`
// is always forward-slash `file:///D:/...` — a naive
// `file://${process.argv[1]}` comparison never matches on Windows, so
// start() silently never ran (that was the actual bug: no crash, no log,
// tsx watch just sat there with nothing listening).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    console.error("[api] failed to start:", err);
    process.exit(1);
  });
}
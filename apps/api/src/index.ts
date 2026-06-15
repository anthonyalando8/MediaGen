// apps/api/src/index.ts
//
// Fastify app factory (Deliverable 11: "Fastify ... project CRUD + asset
// upload (P1)"). `buildApp()` is the unit under test — it builds a fresh
// app with its own in-memory stores (db/schema.ts) and never binds a port,
// so route tests use Fastify's `.inject()` directly (no network needed in
// this sandbox). `start()` is the real entrypoint, not exercised by tests.

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerAssetRoutes } from "./routes/asset";
import { registerProjectRoutes } from "./routes/project";
import { createInMemoryAssetStore, createInMemoryProjectStore } from "./db/schema";
import type { AssetStore, ProjectStore } from "./db/schema";

export interface BuildAppOptions {
  projectStore?: ProjectStore;
  assetStore?: AssetStore;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify();
  const projectStore = options.projectStore ?? createInMemoryProjectStore();
  const assetStore = options.assetStore ?? createInMemoryAssetStore();

  registerProjectRoutes(app, projectStore);
  registerAssetRoutes(app, assetStore);

  return app;
}

export async function start(port = 3001): Promise<void> {
  const app = buildApp();
  await app.listen({ port });
}
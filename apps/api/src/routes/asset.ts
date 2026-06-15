// apps/api/src/routes/asset.ts
//
// Asset registry (Deliverable 11: "... + asset upload (P1)"). P1 scope here
// is the `AssetRef` *metadata* registry only — actual file bytes go to
// object storage (`infra/docker-compose.yml`'s MinIO, P2/out of sandbox
// scope); `master`/`proxy`/`poster` are pre-signed-URL-shaped strings the
// client already has by the time it POSTs here. `apps/editor`'s
// add-media palette (MediaPalette.tsx, Week 7) consumes `AssetRef[]` from
// `project.assets` — this registry is how those entries would be populated
// once upload exists.

import type { FastifyInstance } from "fastify";
import { AssetRefSchema } from "schema";
import type { AssetRef } from "core";
import type { AssetStore } from "../db/schema";

export function registerAssetRoutes(app: FastifyInstance, store: AssetStore): void {
  app.get("/assets", async () => store.list());

  app.get("/assets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = store.get(id);
    if (!asset) {
      reply.code(404);
      return { error: `asset "${id}" not found` };
    }
    return asset;
  });

  app.post("/assets", async (req, reply) => {
    const result = AssetRefSchema.safeParse(req.body);
    if (!result.success) {
      reply.code(400);
      return { error: "invalid asset", issues: result.error.issues };
    }
    const asset = result.data as unknown as AssetRef;
    store.put(asset);
    reply.code(201);
    return asset;
  });
}
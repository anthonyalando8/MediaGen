// apps/api/src/routes/project.ts
//
// Project CRUD (Deliverable 11: "Fastify ... project CRUD + asset upload
// (P1)"). `PUT /projects/:id` validates the request body against
// `ProjectSchema` (Deliverable 05's schema package) before storing — the
// same schema `apps/editor`'s local-storage persistence
// (persistence/local-storage.ts) validates against on load, so a project
// round-tripped through either path is guaranteed schema-valid. This is the
// server-side half of exit criterion 10 ("User reloads; project persists
// and re-renders identically") for a future multi-device/P2 setup; P1's
// editor uses the local-storage path by default.

import type { FastifyInstance } from "fastify";
import { ProjectSchema } from "schema";
import type { Project } from "core";
import type { ProjectStore } from "../db/schema";

export function registerProjectRoutes(app: FastifyInstance, store: ProjectStore): void {
  app.get("/projects", async () => store.list());

  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = store.get(id);
    if (!project) {
      reply.code(404);
      return { error: `project "${id}" not found` };
    }
    return project;
  });

  app.put("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ProjectSchema.safeParse(req.body);
    if (!result.success) {
      reply.code(400);
      return { error: "invalid project", issues: result.error.issues };
    }
    if (result.data.id !== id) {
      reply.code(400);
      return { error: `body.id ("${result.data.id}") does not match URL :id ("${id}")` };
    }
    const project = result.data as unknown as Project;
    store.put(project);
    return project;
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.delete(id)) {
      reply.code(404);
      return { error: `project "${id}" not found` };
    }
    return { deleted: id };
  });
}
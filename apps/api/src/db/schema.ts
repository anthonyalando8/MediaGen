// apps/api/src/db/schema.ts
//
// "minimal persistence" (Deliverable 11 folder tree: apps/api/src/db/
// schema.ts). The blueprint's `infra/docker-compose.yml` calls for
// Postgres + MinIO — out of scope for this sandbox (no DB/object storage
// available). Both stores below are Map-based and swappable: `buildApp()`
// (index.ts) takes a `ProjectStore`/`AssetStore` via its options, so a P2
// Postgres-backed implementation of the same interfaces drops in without
// touching the routes. Each `buildApp()` call gets its own fresh stores —
// no module-level singleton (mirrors NodeKindRegistry's instancing note).

import type { AssetRef, Project } from "core";

export interface ProjectStore {
  get(id: string): Project | undefined;
  put(project: Project): void;
  list(): Project[];
  delete(id: string): boolean;
}

export interface AssetStore {
  get(id: string): AssetRef | undefined;
  put(asset: AssetRef): void;
  list(): AssetRef[];
}

export function createInMemoryProjectStore(): ProjectStore {
  const projects = new Map<string, Project>();
  return {
    get(id) {
      return projects.get(id);
    },
    put(project) {
      projects.set(project.id, project);
    },
    list() {
      return [...projects.values()];
    },
    delete(id) {
      return projects.delete(id);
    },
  };
}

export function createInMemoryAssetStore(): AssetStore {
  const assets = new Map<string, AssetRef>();
  return {
    get(id) {
      return assets.get(id);
    },
    put(asset) {
      assets.set(asset.id, asset);
    },
    list() {
      return [...assets.values()];
    },
  };
}
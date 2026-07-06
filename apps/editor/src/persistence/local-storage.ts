// apps/editor/src/persistence/local-storage.ts
//
// "api save/load" + exit criterion 10 ("User reloads; project persists and
// re-renders identically") for Phase 1's single-user SPA: the `Project`
// document (Deliverable 05's `ProjectSchema`) IS the persisted format —
// there is no separate "Scene JSON" (exit criterion 11). `main.tsx` loads
// this on boot and subscribes to Tier 1 (`document.project`) changes to
// save it back automatically.
//
// `apps/api`'s project/asset routes (Week 8) are the multi-user/server-side
// persistence path for a future P2 — this module is the P1 local path and
// doesn't depend on it.

import { ProjectSchema } from "schema";
import type { Project } from "core";

const STORAGE_KEY = "seabytes:project";

/** Minimal subset of the DOM `Storage` interface — lets tests inject an in-memory fake instead of `window.localStorage`. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): KeyValueStorage | undefined {
  return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
}

/** Serializes `project` to JSON and writes it to `storage`. No-op if `storage` is unavailable (e.g. SSR/tests with no DOM and no fake provided). */
export function saveProject(project: Project, storage: KeyValueStorage | undefined = defaultStorage()): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify(project));
}

/**
 * Reads + validates the persisted project. Returns `undefined` if nothing
 * is stored, the JSON is corrupt, or it fails `ProjectSchema` — callers
 * should fall back to `createBlankProject()` (bootstrap/create-project.ts)
 * in any of those cases.
 */
export function loadProject(storage: KeyValueStorage | undefined = defaultStorage()): Project | undefined {
  const raw = storage?.getItem(STORAGE_KEY);
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const result = ProjectSchema.safeParse(parsed);
  if (!result.success) return undefined;
  return dedupeAssetsById(result.data as Project);
}

/**
 * Collapses duplicate-id entries in `project.assets` to the LAST one for
 * each id (same "most recent write wins" semantics as `document.ts`'s
 * `addAsset` upsert). Belt-and-suspenders: `addAsset` itself no longer
 * produces duplicates, but this heals any project that was saved to
 * localStorage BEFORE that fix landed — without this, a project corrupted
 * once keeps replaying the same React "duplicate key" warning and doubled
 * list entry on every load, forever, with no way to self-correct.
 */
function dedupeAssetsById(project: Project): Project {
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
  if (byId.size === project.assets.length) return project; // fast path: nothing to heal
  return { ...project, assets: [...byId.values()] };
}

export function clearProject(storage: KeyValueStorage | undefined = defaultStorage()): void {
  storage?.removeItem(STORAGE_KEY);
}
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
//
// QUOTA NOTE: an AI-generated / imported scene embeds its media (voiceover +
// stock images) as data: URLs, so a single project can be several MB — well
// past localStorage's ~5 MB budget. `saveProject` therefore treats a quota
// failure as NON-FATAL: the project stays live in memory (the user can edit
// and export normally), it just isn't auto-persisted across a reload. Without
// this guard the setItem throw propagated out of the Tier-1 store subscription
// and surfaced as a bogus unrelated error in the UI.

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

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED" || // Firefox
      e.code === 22 ||
      e.code === 1014)
  );
}

let _warnedQuota = false;

/**
 * Serializes `project` to JSON and writes it to `storage`. No-op if `storage`
 * is unavailable (SSR/tests). A quota overflow (large embedded-media project)
 * is caught and logged once — the in-memory document is unaffected; only
 * auto-persist-across-reload is skipped. Other errors are re-thrown.
 */
export function saveProject(project: Project, storage: KeyValueStorage | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (e) {
    if (isQuotaError(e)) {
      if (!_warnedQuota) {
        _warnedQuota = true;
        // eslint-disable-next-line no-console
        console.warn(
          "[persistence] Project too large for localStorage (embedded media) — " +
            "keeping it in memory but NOT auto-saving across reload. Use File ▸ Save to write a .seabytes file."
        );
      }
      return;
    }
    throw e;
  }
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
 * `addAsset` upsert).
 */
function dedupeAssetsById(project: Project): Project {
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
  if (byId.size === project.assets.length) return project;
  return { ...project, assets: [...byId.values()] };
}

export function clearProject(storage: KeyValueStorage | undefined = defaultStorage()): void {
  storage?.removeItem(STORAGE_KEY);
}

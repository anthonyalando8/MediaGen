// apps/editor/src/persistence/project-file.ts
//
// Save the current project to an EXTERNAL file, and open one back — the
// portable sibling of local-storage.ts (which is the same `Project` document,
// just parked in localStorage). A `.seabytes` file IS the `Project` JSON:
//
//   • Save  → JSON.stringify(project) → download `<name>.seabytes`.
//   • Open  → read text → JSON.parse → migrateProject → ProjectSchema → load.
//
// SELF-CONTAINED BY DEFAULT: an uploaded asset persists its bytes as a `data:`
// URL in `AssetRef.master` (asset-upload.ts), so the media travels inside the
// file — open it on any machine and the images/video/audio resolve with no
// re-linking. (Assets that instead reference a dev-server URL —
// `http://localhost:3001/...` proxy/master — are the one exception; those are
// machine-local and won't resolve elsewhere. Uploads are data URLs, so this
// only affects server-transcoded proxies.)
//
// Versioning is already handled: `migrateProject` walks an older document
// forward to CURRENT_SCHEMA_VERSION and throws `UnknownSchemaVersionError` for
// a file written by a NEWER build than this one — surfaced here as a friendly
// message rather than a crash.

import { migrateProject, ProjectSchema } from "schema";
import type { AssetRef, Project } from "core";

export const PROJECT_FILE_EXT = "seabytes";
export const PROJECT_FILE_MIME = "application/json";

/** Thrown for any user-facing open failure (bad JSON, wrong shape, future version). `message` is safe to show in an alert/toast. */
export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFileError";
  }
}

/** Pretty-printed JSON (2-space) — diff-friendly if a project ever lands in version control. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/** Serializes `project` and triggers a browser download of `<name>.seabytes`. */
export function downloadProjectFile(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: PROJECT_FILE_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = (project.name || "project").trim().replace(/[^\w.-]+/g, "_") || "project";
  a.href = url;
  a.download = `${safeName}.${PROJECT_FILE_EXT}`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parses + validates project JSON text into a trusted `Project`, migrating
 * older schema versions forward. Throws `ProjectFileError` (with a
 * user-friendly message) on any failure.
 */
export function parseProjectJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError("This file isn't valid JSON — it may be corrupt or not a SeaBytes project.");
  }

  let migrated: unknown;
  try {
    migrated = migrateProject(raw);
  } catch (err) {
    // e.g. UnknownSchemaVersionError — file from a newer build.
    throw new ProjectFileError(err instanceof Error ? err.message : "Unsupported project version.");
  }

  const result = ProjectSchema.safeParse(migrated);
  if (!result.success) {
    throw new ProjectFileError("This doesn't look like a SeaBytes project file.");
  }
  return dedupeAssetsById(result.data as Project);
}

/** Reads a picked `File` and parses it (see `parseProjectJson`). */
export async function readProjectFile(file: File): Promise<Project> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new ProjectFileError("Could not read the file.");
  }
  return parseProjectJson(text);
}

/**
 * Opens the OS file picker for a `.seabytes` (or `.json`) project and resolves
 * with the chosen `File`, or `null` if the user cancelled. Pair with
 * `readProjectFile` + the store's `loadProjectDocument`.
 */
export function pickProjectFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.${PROJECT_FILE_EXT},application/json,.json`;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Some browsers need the input in the DOM for the dialog to fire reliably.
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => input.remove(), { once: true });
    input.click();
  });
}

/**
 * Collapses duplicate-id `assets` to the LAST entry per id — identical to
 * local-storage.ts's healer, applied here so a hand-edited or older file with
 * duplicate asset ids doesn't spam React "duplicate key" warnings after open.
 */
function dedupeAssetsById(project: Project): Project {
  const byId = new Map<string, AssetRef>(project.assets.map((a) => [a.id, a]));
  if (byId.size === project.assets.length) return project;
  return { ...project, assets: [...byId.values()] };
}

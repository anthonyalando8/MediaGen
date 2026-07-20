// apps/editor/src/persistence/scene-generate.ts
//
// Client for the Python scene API (server.py). Kicks off AI scene generation,
// polls progress, fetches the finished self-contained scene.json, and hands it
// to the SAME compiler the manual "Import Scene…" path uses — so a generated
// scene and an imported one become the identical editable project.
//
// The scene the server returns is self-contained (voiceover + stock images
// embedded as data: URLs), so there's nothing else to fetch or re-link.

import { compileSceneToProject } from "./scene-import";
import type { Project } from "core";

/** Base URL of the Python scene API. Override via VITE_SCENE_API if you host it elsewhere. */
export const SCENE_API_BASE =
  (import.meta as any).env?.VITE_SCENE_API ?? "http://localhost:8000";

export interface GenerateProgress {
  state: "queued" | "running" | "done" | "error";
  step: number;
  total_steps: number;
  label: string;
  pct: number;
  error?: string;
  title?: string;
}

export class SceneGenerateError extends Error {}

interface GenerateOptions {
  topic: string;
  resolveVisuals?: boolean;
  onProgress?: (p: GenerateProgress) => void;
  signal?: AbortSignal;
  /** Poll interval ms (default 1200). */
  pollMs?: number;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json())?.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new SceneGenerateError(detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Runs the full generate → poll → fetch flow and returns a ready-to-load
 * `Project`. Reject reasons: server error, job error, or abort.
 */
export async function generateScene(opts: GenerateOptions): Promise<{ project: Project; title?: string }> {
  const { topic, resolveVisuals = true, onProgress, signal, pollMs = 1200 } = opts;

  const { job_id } = await j<{ job_id: string }>(
    await fetch(`${SCENE_API_BASE}/api/scene/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, resolve_visuals: resolveVisuals }),
      signal,
    })
  );

  // Poll until done / error / abort.
  let title: string | undefined;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
    const p = await j<GenerateProgress>(
      await fetch(`${SCENE_API_BASE}/api/scene/status/${job_id}`, { signal })
    );
    onProgress?.(p);
    title = p.title ?? title;
    if (p.state === "error") throw new SceneGenerateError(p.error || "Generation failed");
    if (p.state === "done") break;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  const scene = await j<Record<string, unknown>>(
    await fetch(`${SCENE_API_BASE}/api/scene/result/${job_id}`, { signal })
  );

  const project = compileSceneToProject(scene as any);
  return { project, title };
}

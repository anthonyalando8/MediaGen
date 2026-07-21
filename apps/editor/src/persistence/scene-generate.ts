// apps/editor/src/persistence/scene-generate.ts
//
// Client for the Python scene API (server.py). Kicks off AI scene generation,
// polls progress (with per-step detail), and returns the finished
// self-contained scene.json RAW — so the modal can show a storyboard preview
// BEFORE committing. Importing is a separate, synchronous step
// (`compileGeneratedScene`) the caller runs on user confirm, using the SAME
// compiler as manual Import Scene… / Open….

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
  /** Human sub-detail within a step, e.g. "voice 3/6", "visuals 2/6". */
  detail?: string;
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
 * Runs generate → poll → fetch and resolves with the RAW scene document (not
 * yet compiled). The caller previews it, then calls `compileGeneratedScene`
 * on confirm. Rejects on server error, job error, or abort.
 */
export async function generateScene(opts: GenerateOptions): Promise<{ scene: any; title?: string }> {
  const { topic, resolveVisuals = true, onProgress, signal, pollMs = 1200 } = opts;

  const { job_id } = await j<{ job_id: string }>(
    await fetch(`${SCENE_API_BASE}/api/scene/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, resolve_visuals: resolveVisuals }),
      signal,
    })
  );

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
  return { scene, title };
}

/** Compile a previously-generated raw scene into a ready-to-load Project (same compiler as Import Scene…). */
export function compileGeneratedScene(scene: any): Project {
  return compileSceneToProject(scene);
}

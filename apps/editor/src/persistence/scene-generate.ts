// apps/editor/src/persistence/scene-generate.ts
//
// Client for the Python scene API (server.py). Kicks off AI scene generation,
// polls progress (with per-step detail), and returns the finished
// self-contained scene.json RAW — so the modal can show a storyboard preview
// BEFORE committing. Importing is a separate, synchronous step
// (`compileGeneratedScene`) the caller runs on user confirm, using the SAME
// compiler as manual Import Scene… / Open….
//
// `format` selects a video-format recipe on the server (prompt + validation
// profile). `listFormats()` fetches the picker options so the UI stays in sync
// with whatever formats exist under prompts/formats/ — no hardcoded enum.

import { compileSceneToProject } from "./scene-import";
import type { Project } from "core";

/** Base URL of the Python scene API. Override via VITE_SCENE_API if you host it elsewhere. */
export const SCENE_API_BASE =
  (import.meta as any).env?.VITE_SCENE_API ?? "http://localhost:8000";

/** Server default when no format is passed — mirrors formats.DEFAULT_FORMAT. */
export const DEFAULT_FORMAT = "shortform_tiktok";

export interface SceneFormat {
  id: string;
  label: string;
  description: string;
  default_resolve_visuals?: boolean;
  /** Short, server-derived description of what the format's profile actually
   * does — shown under the format chip in the picker. */
  profile_summary?: { voice: string; motion: string; media: string };
}

export type MediaMode = "auto" | "image" | "video" | "hybrid";

/** How to interpret pasted/uploaded `sourceText` — mirrors ingest.py's
 * `_NORMALIZERS` keys. "plain_text" for an article/blog paste, "markdown"
 * for a doc with #/## headings, "script" for the user's own draft narration
 * (kept line-for-line rather than summarized). */
export type SourceKind = "plain_text" | "markdown" | "script";

/** One English voice option for the picker (GET /api/voice/list). */
export interface VoiceOption {
  id: string;
  label: string;
  accent: "American" | "British";
  gender: "female" | "male";
}

/** A beat's resolved visual (scene.json v2 shape) — what the asset-review step displays/edits. */
export interface SceneVisual {
  asset_id: string;
  kind: "image" | "video";
  role?: string;
  fit?: string;
  opacity?: number;
  relevance?: number;
  query?: string;
  alternatives?: string[];
}

export interface SceneAsset {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
  width?: number;
  height?: number;
  duration_ms?: number;
}

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
  format?: string;
}

export class SceneGenerateError extends Error {}

interface GenerateOptions {
  /** A short topic phrase. Required UNLESS `sourceText`/`sourcePdfBase64` is
   * given — an ingested source takes priority over `topic` server-side (see
   * server.py's `_ingest_source`), so this is optional in content mode. */
  topic?: string;
  /** Existing content to generate from instead of a bare topic — an article,
   * blog post, markdown doc, or the user's own draft script (see
   * `sourceKind`). Mutually exclusive with `sourcePdfBase64` (send at most
   * one); if both are set the server ignores `sourceText`. */
  sourceText?: string;
  sourceKind?: SourceKind;
  /** A PDF, base64-encoded client-side (binary can't ride in JSON text).
   * Extracted + normalized server-side the same as `sourceText`. */
  sourcePdfBase64?: string;
  /** Format recipe id (folder under prompts/formats/). Omit to let the
   * server decide: today's flat default, OR — when a source is given —
   * ingest's own length-based suggestion (see ingest._suggest_format). */
  format?: string;
  resolveVisuals?: boolean;
  /** Override the format's own media.mode for this generation. Omitted = format's own choice. */
  mediaMode?: MediaMode;
  /** Explicit voice pick (id from listVoices()) for this generation. Omitted = "Automatic" (today's genre/LLM-driven choice). */
  voiceId?: string;
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
 * Fetch the available video formats for the picker. Returns [] (and never
 * throws) if the server is unreachable, so the modal can fall back to a single
 * default option and still let the user generate.
 */
export async function listFormats(signal?: AbortSignal): Promise<SceneFormat[]> {
  try {
    return await j<SceneFormat[]>(
      await fetch(`${SCENE_API_BASE}/api/scene/formats`, { signal })
    );
  } catch {
    return [];
  }
}

/**
 * Runs generate → poll → fetch and resolves with the RAW scene document (not
 * yet compiled). The caller previews it, then calls `compileGeneratedScene`
 * on confirm. Rejects on server error, job error, or abort.
 */
export async function generateScene(opts: GenerateOptions): Promise<{ scene: any; title?: string; jobId: string }> {
  const {
    topic,
    sourceText,
    sourceKind,
    sourcePdfBase64,
    format,
    resolveVisuals = true,
    mediaMode,
    voiceId,
    onProgress,
    signal,
    pollMs = 1200,
  } = opts;

  const hasSource = !!(sourcePdfBase64 || (sourceText && sourceText.trim()));
  if (!hasSource && !(topic && topic.trim())) {
    throw new SceneGenerateError("topic is required (or provide sourceText / sourcePdfBase64)");
  }

  const { job_id } = await j<{ job_id: string }>(
    await fetch(`${SCENE_API_BASE}/api/scene/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic ?? "", resolve_visuals: resolveVisuals,
        ...(format ? { format } : {}),
        ...(mediaMode ? { media_mode: mediaMode } : {}),
        ...(voiceId ? { voice_id: voiceId } : {}),
        // At most one of these two — sourcePdfBase64 takes priority
        // server-side if somehow both were set.
        ...(sourcePdfBase64 ? { source_pdf_base64: sourcePdfBase64 } : {}),
        ...(!sourcePdfBase64 && sourceText?.trim() ? { source_text: sourceText, source_kind: sourceKind ?? "plain_text" } : {}),
      }),
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
  return { scene, title, jobId: job_id };
}

/** Compile a previously-generated raw scene into a ready-to-load Project (same compiler as Import Scene…). */
export function compileGeneratedScene(scene: any): Project {
  return compileSceneToProject(scene);
}

/**
 * Fetch the English voice catalog for the picker. Returns [] (and never
 * throws) if the server is unreachable — same fallback-friendly shape as
 * listFormats().
 */
export async function listVoices(signal?: AbortSignal): Promise<VoiceOption[]> {
  try {
    return await j<VoiceOption[]>(
      await fetch(`${SCENE_API_BASE}/api/voice/list`, { signal })
    );
  } catch {
    return [];
  }
}

/** Synthesise a short sample of one voice — sub-second, no job/poll needed. */
export async function previewVoice(voiceId: string, signal?: AbortSignal): Promise<{ url: string }> {
  return j(
    await fetch(`${SCENE_API_BASE}/api/voice/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_id: voiceId }),
      signal,
    })
  );
}

/**
 * Re-resolve one beat's visual (the asset-review step's ↺ Reroll / → Video /
 * → Image actions). Excludes everything already shown for that beat
 * server-side, so this never just hands back the same candidate.
 */
export async function rerollVisual(
  jobId: string,
  beatIndex: number,
  mode?: "image" | "video",
  signal?: AbortSignal,
): Promise<{ beat_index: number; visual: SceneVisual; asset: SceneAsset }> {
  return j(
    await fetch(`${SCENE_API_BASE}/api/scene/reroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, beat_index: beatIndex, ...(mode ? { mode } : {}) }),
      signal,
    })
  );
}

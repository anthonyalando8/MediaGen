// apps/api/src/transcode/worker.ts
//
// ffmpeg-driven derivative generation (Week 12, Deliverable 05 §5.1.3).
// Produces `proxy` / `master` / `poster` / `waveform` for a `pending`
// `AssetRef`, per the fields already declared inert on `AssetRef` (no
// schema change needed — see `packages/core/src/types/project.ts`).
//
// Derivatives are themselves stored in the `ObjectStore` (CAS by hash), and
// the mapping from logical variant name ("master"/"proxy"/"poster"/
// "waveform") -> `{ hash, mime }` lives in `AssetRef.meta.objects` — chosen
// over adding new top-level `AssetRef` fields to keep this additive-only,
// same discipline as the rest of Phase 2's domain extensions.
//
// Requires a disk-backed `ObjectStore` (`pathFor()` must return a real
// filesystem path) because ffmpeg shells out against real files — the
// in-memory store is for route/queue tests that don't exercise ffmpeg.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AssetRef } from "core";
import type { AssetStore } from "../db/schema";
import type { ObjectStore } from "../storage/object-store";

const run = promisify(execFile);

type ObjectRecord = { hash: string; mime: string };
type ObjectsMeta = Partial<Record<"original" | "master" | "proxy" | "poster" | "waveform", ObjectRecord>>;

const MIME_BY_KIND: Record<AssetRef["kind"], string> = {
  video: "video/mp4",
  image: "image/jpeg",
  audio: "audio/mp4",
  font: "application/octet-stream",
  lottie: "application/json",
  rig: "application/octet-stream",
  glb: "model/gltf-binary",
  svg: "image/svg+xml",
};

function objectsMetaOf(asset: AssetRef): ObjectsMeta {
  return (asset.meta?.objects as ObjectsMeta | undefined) ?? {};
}

/** Runs ffmpeg/ffprobe derivative generation for one pending asset and writes the result back via `store.put()`. Exported standalone (not just as a queue handler) so it's directly unit-testable without going through the queue. */
export async function transcodeAsset(assetId: string, store: AssetStore, objects: ObjectStore): Promise<void> {
  const asset = store.get(assetId);
  if (!asset) throw new Error(`transcodeAsset: no asset "${assetId}"`);

  const originalMeta = objectsMetaOf(asset).original;
  if (!originalMeta) throw new Error(`transcodeAsset: asset "${assetId}" has no original object recorded`);

  const workdir = await mkdtemp(join(tmpdir(), "seabytes-transcode-"));
  try {
    const inputPath = objects.pathFor(originalMeta.hash);
    const objectsOut: ObjectsMeta = { original: originalMeta };

    if (asset.kind === "video") {
      objectsOut.master = originalMeta; // passthrough — full-quality original, per §11.2's "master, used only at export time"
      objectsOut.proxy = await ffmpegToObject(inputPath, workdir, "proxy.mp4", ["-vf", "scale=640:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"], "video/mp4", objects);
      objectsOut.poster = await ffmpegToObject(inputPath, workdir, "poster.jpg", ["-ss", "00:00:00.5", "-frames:v", "1"], "image/jpeg", objects);
    } else if (asset.kind === "audio") {
      objectsOut.master = originalMeta;
      // "-vn": many MP3s carry an embedded cover image as an attached-picture
      // video stream (ffprobe reports it as a real Stream #0:1). Without
      // "-vn", ffmpeg auto-maps that stream too and tries to encode it into
      // the M4A container per this command's OTHER flags (-c:a aac), which
      // fails outright ("Could not find tag for codec h264 in stream #0,
      // codec not currently supported in container") because there's no
      // matching video codec/container configuration for it — this command
      // only ever wanted the audio.
      objectsOut.proxy = await ffmpegToObject(inputPath, workdir, "proxy.m4a", ["-vn", "-ar", "22050", "-c:a", "aac", "-b:a", "96k"], "audio/mp4", objects);
      objectsOut.waveform = await waveformToObject(inputPath, workdir, objects);
    } else if (asset.kind === "image") {
      objectsOut.master = originalMeta;
      objectsOut.proxy = await ffmpegToObject(inputPath, workdir, "proxy.jpg", ["-vf", "scale=640:-2"], "image/jpeg", objects);
    } else {
      // font/lottie/rig/glb/svg — no derivative pipeline yet; original serves as both master and proxy.
      objectsOut.master = originalMeta;
    }

    const updated: AssetRef = {
      ...asset,
      master: `/assets/${assetId}/object/master`,
      proxy: objectsOut.proxy ? `/assets/${assetId}/object/proxy` : undefined,
      poster: objectsOut.poster ? `/assets/${assetId}/object/poster` : undefined,
      waveform: objectsOut.waveform ? `/assets/${assetId}/object/waveform` : undefined,
      meta: { ...asset.meta, status: "ready", objects: objectsOut },
    };
    store.put(updated);
  } catch (err) {
    store.put({ ...asset, meta: { ...asset.meta, status: "failed", error: err instanceof Error ? err.message : String(err) } });
    throw err;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

/** Runs ffmpeg with `args` against `inputPath`, writes `outputName` into `workdir`, stores the result bytes in `objects`, and returns its `{ hash, mime }` record. */
async function ffmpegToObject(inputPath: string, workdir: string, outputName: string, args: string[], mime: string, objects: ObjectStore): Promise<ObjectRecord> {
  const outputPath = join(workdir, outputName);
  await run("ffmpeg", ["-y", "-i", inputPath, ...args, outputPath]);
  const bytes = await readFile(outputPath);
  const hash = await objects.put(bytes);
  return { hash, mime };
}

/** Decodes audio to raw mono PCM at a low sample rate, then downsamples further in JS into a peaks array — a real waveform (min/max per bucket), not the decorative CSS mask `AudioTrackClips` currently falls back to. */
async function waveformToObject(inputPath: string, workdir: string, objects: ObjectStore): Promise<ObjectRecord> {
  const pcmPath = join(workdir, "waveform.pcm");
  const sampleRate = 3000; // low enough that decoding+peak-picking is cheap, high enough for a reasonable-looking waveform
  await run("ffmpeg", ["-y", "-i", inputPath, "-vn", "-f", "s16le", "-ac", "1", "-ar", String(sampleRate), pcmPath]);

  const pcm = await readFile(pcmPath);
  const sampleCount = pcm.length / 2;
  const targetBuckets = 1000;
  const samplesPerBucket = Math.max(1, Math.floor(sampleCount / targetBuckets));
  const peaks: number[] = [];

  for (let bucketStart = 0; bucketStart < sampleCount; bucketStart += samplesPerBucket) {
    let max = 0;
    const bucketEnd = Math.min(bucketStart + samplesPerBucket, sampleCount);
    for (let i = bucketStart; i < bucketEnd; i++) {
      const sample = Math.abs(pcm.readInt16LE(i * 2));
      if (sample > max) max = sample;
    }
    peaks.push(Math.round((max / 32768) * 1000) / 1000); // normalized 0..1, 3 decimal places
  }

  const bytes = Buffer.from(JSON.stringify({ sampleRate, samplesPerBucket, peaks }));
  const hash = await objects.put(bytes);
  return { hash, mime: "application/json" };
}

/** Default MIME to serve a variant with if `meta.objects` somehow lacks one (shouldn't happen post-transcode, but keeps `routes/asset.ts`'s serve handler total). */
export function defaultMimeFor(kind: AssetRef["kind"]): string {
  return MIME_BY_KIND[kind];
}

/** Writes `bytes` as the "original" object for a freshly uploaded, not-yet-transcoded asset. Split out from `transcodeAsset` so `routes/upload.ts` can call it synchronously before enqueueing. */
export async function storeOriginal(bytes: Buffer, mime: string, objects: ObjectStore): Promise<ObjectRecord> {
  const hash = await objects.put(bytes);
  return { hash, mime };
}

// Re-exported for tests that want to write a real temp fixture file without duplicating the tmpdir dance.
export async function withTempFile<T>(name: string, bytes: Buffer, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "seabytes-fixture-"));
  const path = join(dir, name);
  try {
    await writeFile(path, bytes);
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
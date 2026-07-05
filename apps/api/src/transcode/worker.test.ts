// apps/api/src/transcode/worker.test.ts
//
// Uses real ffmpeg (confirmed available in this environment) against tiny
// synthetically-generated fixtures (`ffmpeg -f lavfi`) rather than mocking
// the transcode step — the whole point of Week 12 is real derivatives, not
// a stub that always "succeeds".

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createId } from "core";
import type { AssetRef } from "core";
import { createInMemoryAssetStore } from "../db/schema";
import type { AssetStore } from "../db/schema";
import { createDiskObjectStore } from "../storage/object-store";
import type { ObjectStore } from "../storage/object-store";
import { transcodeAsset } from "./worker";

const run = promisify(execFile);

async function generateFixture(kind: "video" | "audio" | "image", outPath: string): Promise<void> {
  if (kind === "video") {
    // 1s, tiny, silent-but-has-audio-track test video (color bars + a tone), so it exercises both video and audio derivative paths.
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-shortest", outPath]);
  } else if (kind === "audio") {
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", outPath]);
  } else {
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1", outPath]);
  }
}

describe("transcodeAsset", () => {
  let root: string;
  let objectStore: ObjectStore;
  let assetStore: AssetStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "seabytes-worker-test-"));
    objectStore = createDiskObjectStore(root);
    assetStore = createInMemoryAssetStore();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function putPendingAsset(kind: AssetRef["kind"], fixturePath: string, mime: string): Promise<string> {
    const bytes = await readFile(fixturePath);
    const originalHash = await objectStore.put(bytes);
    const id = createId();
    assetStore.put({
      id,
      hash: originalHash,
      kind,
      master: `/assets/${id}/object/master`,
      meta: { status: "pending", objects: { original: { hash: originalHash, mime } } },
    });
    return id;
  }

  it("produces master, proxy, and poster for a video asset", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "seabytes-fixture-"));
    const fixturePath = join(fixtureDir, "in.mp4");
    await generateFixture("video", fixturePath);

    const assetId = await putPendingAsset("video", fixturePath, "video/mp4");
    await transcodeAsset(assetId, assetStore, objectStore);

    const asset = assetStore.get(assetId)!;
    expect(asset.meta?.status).toBe("ready");
    expect(asset.master).toBe(`/assets/${assetId}/object/master`);
    expect(asset.proxy).toBe(`/assets/${assetId}/object/proxy`);
    expect(asset.poster).toBe(`/assets/${assetId}/object/poster`);

    const objects = asset.meta?.objects as Record<string, { hash: string; mime: string }>;
    expect(await objectStore.has(objects.proxy.hash)).toBe(true);
    expect(await objectStore.has(objects.poster.hash)).toBe(true);
    // proxy should be smaller than or comparable to the tiny fixture — mainly proving it's a real, distinct, non-empty file.
    const proxyBytes = await objectStore.get(objects.proxy.hash);
    expect(proxyBytes.length).toBeGreaterThan(0);
    const posterBytes = await objectStore.get(objects.poster.hash);
    expect(posterBytes.length).toBeGreaterThan(0);

    await rm(fixtureDir, { recursive: true, force: true });
  }, 30000);

  it("produces master, proxy, and a real waveform for an audio asset", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "seabytes-fixture-"));
    const fixturePath = join(fixtureDir, "in.wav");
    await generateFixture("audio", fixturePath);

    const assetId = await putPendingAsset("audio", fixturePath, "audio/wav");
    await transcodeAsset(assetId, assetStore, objectStore);

    const asset = assetStore.get(assetId)!;
    expect(asset.meta?.status).toBe("ready");
    expect(asset.waveform).toBe(`/assets/${assetId}/object/waveform`);

    const objects = asset.meta?.objects as Record<string, { hash: string; mime: string }>;
    const waveformBytes = await objectStore.get(objects.waveform.hash);
    const waveform = JSON.parse(waveformBytes.toString("utf-8"));
    expect(Array.isArray(waveform.peaks)).toBe(true);
    expect(waveform.peaks.length).toBeGreaterThan(0);
    // A 440Hz sine tone should produce non-zero peaks, not a silent/flat waveform.
    expect(Math.max(...waveform.peaks)).toBeGreaterThan(0);
    expect(waveform.peaks.every((p: number) => p >= 0 && p <= 1)).toBe(true);

    await rm(fixtureDir, { recursive: true, force: true });
  }, 30000);

  it("produces master and proxy for an image asset", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "seabytes-fixture-"));
    const fixturePath = join(fixtureDir, "in.png");
    await generateFixture("image", fixturePath);

    const assetId = await putPendingAsset("image", fixturePath, "image/png");
    await transcodeAsset(assetId, assetStore, objectStore);

    const asset = assetStore.get(assetId)!;
    expect(asset.meta?.status).toBe("ready");
    expect(asset.proxy).toBe(`/assets/${assetId}/object/proxy`);

    await rm(fixtureDir, { recursive: true, force: true });
  }, 30000);

  it("marks the asset failed (without throwing past the caller's try/catch) when ffmpeg fails", async () => {
    const id = createId();
    const bogusHash = await objectStore.put(Buffer.from("not a real media file"));
    assetStore.put({
      id,
      hash: bogusHash,
      kind: "video",
      master: `/assets/${id}/object/master`,
      meta: { status: "pending", objects: { original: { hash: bogusHash, mime: "video/mp4" } } },
    });

    await expect(transcodeAsset(id, assetStore, objectStore)).rejects.toThrow();

    const asset = assetStore.get(id)!;
    expect(asset.meta?.status).toBe("failed");
    expect(typeof asset.meta?.error).toBe("string");
  }, 30000);
});
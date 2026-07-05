// apps/api/src/routes/upload.test.ts
//
// Exercises the full path: multipart upload -> object store -> pending
// AssetRef -> queued transcode -> ready AssetRef with real derivatives ->
// GET .../object/:variant serves the bytes. Uses a synthetic ffmpeg
// fixture and a disk object store under a per-test tmp dir (real ffmpeg,
// not mocked) plus an in-process queue so `queue.drain()` gives a
// deterministic point to assert after, instead of polling.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../index";
import { createInMemoryAssetStore } from "../db/schema";
import { createDiskObjectStore } from "../storage/object-store";
import { createInProcessQueue } from "../transcode/queue";
import { transcodeAsset } from "../transcode/worker";

const run = promisify(execFile);

function buildMultipartBody(fieldName: string, filename: string, contentType: string, bytes: Buffer, boundary: string): Buffer {
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([Buffer.from(header, "utf-8"), bytes, Buffer.from(footer, "utf-8")]);
}

describe("upload routes", () => {
  let root: string;
  let fixtureDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "seabytes-upload-test-"));
    fixtureDir = await mkdtemp(join(tmpdir(), "seabytes-upload-fixture-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("uploads an image, transcodes it, and serves the proxy derivative", async () => {
    const fixturePath = join(fixtureDir, "in.png");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=green:s=32x32:d=1", "-frames:v", "1", fixturePath]);
    const fileBytes = await readFile(fixturePath);

    const assetStore = createInMemoryAssetStore();
    const objectStore = createDiskObjectStore(root);
    const queue = createInProcessQueue((job) => transcodeAsset(job.assetId, assetStore, objectStore));
    const app = buildApp({ assetStore, objectStore, queue });

    const boundary = "----seabytesTestBoundary";
    const body = buildMultipartBody("file", "in.png", "image/png", fileBytes, boundary);

    const uploadRes = await app.inject({
      method: "POST",
      url: "/assets/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(uploadRes.statusCode).toBe(202);
    const pending = uploadRes.json();
    expect(pending.kind).toBe("image");
    expect(pending.meta.status).toBe("pending");

    await queue.drain();

    const readyRes = await app.inject({ method: "GET", url: `/assets/${pending.id}` });
    const ready = readyRes.json();
    expect(ready.meta.status).toBe("ready");
    expect(ready.proxy).toBe(`/assets/${pending.id}/object/proxy`);

    const proxyRes = await app.inject({ method: "GET", url: ready.proxy });
    expect(proxyRes.statusCode).toBe(200);
    expect(proxyRes.headers["content-type"]).toContain("image/jpeg");
    expect(proxyRes.rawPayload.length).toBeGreaterThan(0);
  }, 30000);

  it("400s when the request has no file", async () => {
    const app = buildApp({ assetStore: createInMemoryAssetStore(), objectStore: createDiskObjectStore(root), queue: createInProcessQueue(async () => {}) });
    const boundary = "----seabytesEmptyBoundary";
    const emptyBody = Buffer.from(`--${boundary}--\r\n`, "utf-8");

    const res = await app.inject({
      method: "POST",
      url: "/assets/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: emptyBody,
    });

    expect(res.statusCode).toBe(400);
  });

  it("404s when requesting a variant that isn't ready yet", async () => {
    const assetStore = createInMemoryAssetStore();
    const objectStore = createDiskObjectStore(root);
    // Queue that never actually runs the handler, so the asset stays pending.
    const queue = { enqueue: () => {}, drain: async () => {} };
    const app = buildApp({ assetStore, objectStore, queue });

    const fixturePath = join(fixtureDir, "in2.png");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=yellow:s=16x16:d=1", "-frames:v", "1", fixturePath]);
    const fileBytes = await readFile(fixturePath);
    const boundary = "----seabytesPendingBoundary";
    const body = buildMultipartBody("file", "in2.png", "image/png", fileBytes, boundary);

    const uploadRes = await app.inject({
      method: "POST",
      url: "/assets/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    const pending = uploadRes.json();

    const proxyRes = await app.inject({ method: "GET", url: `/assets/${pending.id}/object/proxy` });
    expect(proxyRes.statusCode).toBe(404);
  });
});
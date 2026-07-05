// apps/api/src/storage/object-store.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiskObjectStore } from "./object-store";
import type { ObjectStore } from "./object-store";

describe("createDiskObjectStore", () => {
  let root: string;
  let store: ObjectStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "seabytes-object-store-test-"));
    store = createDiskObjectStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores and retrieves bytes by hash", async () => {
    const bytes = Buffer.from("hello seabytes");
    const hash = await store.put(bytes);

    expect(await store.has(hash)).toBe(true);
    expect(await store.get(hash)).toEqual(bytes);
  });

  it("dedupes identical bytes to the same hash", async () => {
    const bytes = Buffer.from("identical content");
    const hashA = await store.put(bytes);
    const hashB = await store.put(bytes);

    expect(hashA).toBe(hashB);
  });

  it("produces different hashes for different bytes", async () => {
    const hashA = await store.put(Buffer.from("content A"));
    const hashB = await store.put(Buffer.from("content B"));

    expect(hashA).not.toBe(hashB);
  });

  it("has() returns false for an object never stored", async () => {
    expect(await store.has("deadbeef".repeat(8))).toBe(false);
  });

  it("get() throws for a missing object", async () => {
    await expect(store.get("0".repeat(64))).rejects.toThrow();
  });
});
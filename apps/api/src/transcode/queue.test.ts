// apps/api/src/transcode/queue.test.ts
import { describe, expect, it, vi } from "vitest";
import { createInProcessQueue } from "./queue";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createInProcessQueue", () => {
  it("runs an enqueued job", async () => {
    const seen: string[] = [];
    const queue = createInProcessQueue(async (job) => {
      seen.push(job.assetId);
    });

    queue.enqueue({ assetId: "a" });
    await queue.drain();

    expect(seen).toEqual(["a"]);
  });

  it("runs jobs one at a time, in FIFO order", async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    const queue = createInProcessQueue(async (job) => {
      if (job.assetId === "a") await gate.promise; // hold "a" open so we can prove "b" waits
      order.push(job.assetId);
    });

    queue.enqueue({ assetId: "a" });
    queue.enqueue({ assetId: "b" });

    // "b" hasn't run yet — "a" is still holding the queue.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);

    gate.resolve();
    await queue.drain();

    expect(order).toEqual(["a", "b"]);
  });

  it("swallows a failing job so the queue keeps processing", async () => {
    const seen: string[] = [];
    const handler = vi.fn(async (job: { assetId: string }) => {
      if (job.assetId === "bad") throw new Error("boom");
      seen.push(job.assetId);
    });
    const queue = createInProcessQueue(handler);

    queue.enqueue({ assetId: "bad" });
    queue.enqueue({ assetId: "good" });
    await queue.drain();

    expect(seen).toEqual(["good"]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("drain() resolves immediately when nothing is queued", async () => {
    const queue = createInProcessQueue(async () => {});
    await expect(queue.drain()).resolves.toBeUndefined();
  });
});
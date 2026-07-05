// apps/api/src/transcode/queue.ts
//
// Job queue for asset transcoding (Week 12, Deliverable 05 §5.1.2). The
// blueprint's "transcode job (ffmpeg, queued)" assumed a real broker
// (Redis/BullMQ per `infra/docker-compose.yml`'s eventual P2 shape) — none
// exists in this sandbox, so this is an in-process async queue behind a
// `TranscodeQueue` interface. Same swap story as `ObjectStore`: routes and
// the worker only see this interface, so a Redis-backed queue drops in
// later without touching `routes/upload.ts`.
//
// Concurrency is intentionally 1 (single in-flight ffmpeg job at a time) —
// this is a dev/single-node sandbox, not a farm. Bumping concurrency later
// is a one-line change (see `runNext`), not an interface change.

export interface TranscodeJob {
  assetId: string;
}

export type JobHandler = (job: TranscodeJob) => Promise<void>;

export interface TranscodeQueue {
  enqueue(job: TranscodeJob): void;
  /** Resolves once every job enqueued so far (including ones enqueued by handlers, if any) has finished — tests await this instead of polling/sleeping. */
  drain(): Promise<void>;
}

/** In-process FIFO queue. `handler` runs one job at a time; failures are swallowed (logged) so one bad transcode doesn't wedge the queue — the asset stays in `"failed"` status for the caller to inspect via `AssetStore`. */
export function createInProcessQueue(handler: JobHandler): TranscodeQueue {
  const pending: TranscodeJob[] = [];
  let draining: Promise<void> = Promise.resolve();
  let running = false;

  function runNext(): void {
    if (running) return;
    const job = pending.shift();
    if (!job) return;
    running = true;
    draining = handler(job)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[transcode-queue] job failed for asset ${job.assetId}:`, err);
      })
      .finally(() => {
        running = false;
        runNext();
      });
  }

  return {
    enqueue(job) {
      pending.push(job);
      runNext();
    },
    async drain() {
      // Loop because `handler` may enqueue nothing new, but a job in
      // flight when drain() is called means `draining` needs to settle,
      // then we re-check for anything queued behind it.
      while (running || pending.length > 0) {
        await draining;
      }
    },
  };
}
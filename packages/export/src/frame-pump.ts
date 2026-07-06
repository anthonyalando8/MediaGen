// packages/export/src/frame-pump.ts
//
// Drives `onFrame` once per output frame of a VirtualClock, in order,
// awaiting each call before starting the next (so a caller doing
// evaluate -> render -> CanvasSource.add(...) per frame naturally applies
// backpressure — Mediabunny's `add()` resolves once the encoder is ready
// for more input; see this package's index.ts).
//
// Yields control back to the event loop every `yieldEvery` frames so a
// long client-side export doesn't fully freeze the tab for its entire
// duration — this is a MAIN-THREAD export (see index.ts's doc for why the
// worker/OffscreenCanvas path is deferred), so this is the only relief
// valve available for now.

export interface FramePumpOptions {
  frameCount: number;
  /** Called once per output frame, in order, with the 0-indexed output frame number. Awaited before advancing. */
  onFrame: (index: number) => Promise<void>;
  /** Yield to the event loop after this many frames. Default 4 — frequent enough to keep the tab responsive, infrequent enough not to dominate export time with scheduling overhead. */
  yieldEvery?: number;
  /** Called after each yield point (i.e. roughly every `yieldEvery` frames) with the count of frames completed so far — wire this to a progress bar. Not called on every single frame; exporting is the bottleneck, not progress reporting. */
  onProgress?: (framesCompleted: number, frameCount: number) => void;
  /** Injectable for tests — defaults to a real event-loop yield (`setTimeout(resolve, 0)`). */
  yieldToEventLoop?: () => Promise<void>;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Runs `onFrame(0), onFrame(1), ..., onFrame(frameCount - 1)` in order, yielding periodically. Rejects (and stops) if any `onFrame` call rejects. */
export async function pumpFrames(options: FramePumpOptions): Promise<void> {
  const { frameCount, onFrame, yieldEvery = 4, onProgress, yieldToEventLoop = defaultYield } = options;

  if (frameCount < 0) throw new Error(`pumpFrames: frameCount must be >= 0, got ${frameCount}`);

  for (let i = 0; i < frameCount; i++) {
    await onFrame(i);

    const completed = i + 1;
    if (completed % yieldEvery === 0 || completed === frameCount) {
      onProgress?.(completed, frameCount);
      await yieldToEventLoop();
    }
  }
}
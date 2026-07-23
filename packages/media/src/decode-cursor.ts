// packages/media/src/decode-cursor.ts
//
// Frame-accurate seek cursor over decoder.ts's FrameDecoder, matched to how
// export walks frames MONOTONICALLY FORWARD (packages/export/src/frame-pump.ts).
//
// ── THE WEBCODECS CONTRACT THIS RESPECTS (learned the hard way) ──────────────
// A `VideoDecoder` is an ASYNCHRONOUS, PIPELINED, REORDERING decoder:
//
//   • Outputs arrive later than their inputs and in PRESENTATION order. A frame
//     is emitted only once enough LATER chunks (decode order) have been fed to
//     prove no earlier-presentation frame is still coming — up to the codec's
//     reorder depth (H.264 `max_num_reorder_frames`, ≤ 16). So you must NEVER
//     await frame N's output before feeding chunk N+1: that deadlocks (app
//     waits for the frame, decoder waits for more input). [freeze-at-0, v1]
//
//   • Therefore, to get the TARGET frame out without a flush, feed the stream
//     to `target + REORDER_MARGIN`. That guarantees the target is emitted — but
//     the frames `target+1 … target+MARGIN` are themselves still buffered
//     (their promises stay pending). Awaiting the whole submitted batch
//     (`Promise.all`) blocks on those trailing pending frames forever. So we
//     await ONLY the target's promise. [freeze-at-0, v3 — the Promise.all bug]
//
//   • `flush()` forces every queued frame out, but afterwards the decoder
//     REQUIRES a keyframe as its next chunk — you cannot flush per seek and
//     keep feeding delta frames. [\"key frame is required after flush()\"] So we
//     flush ONLY at end-of-stream (when there aren't MARGIN samples left to
//     feed), and the next decoding seek resets to a keyframe.
//
//   • Open `VideoFrame`s pin GPU/CPU buffers; too many outstanding applies
//     backpressure and output stalls. [stall-at-~frame-12] So frames are closed
//     the moment the forward consumer passes them, and we keep only ~MARGIN
//     ahead.
//
// PRODUCER / CONSUMER MODEL
// ------------------------
//   producer: `ensureSubmittedThrough` submits chunks forward, staying up to
//             REORDER_MARGIN ahead of the target; each chunk's decode promise
//             has a handler that files the resolved frame into `decoded` (or
//             closes it if the consumer has already passed that index).
//   consumer: `seekTo` awaits ONLY the target's pending promise, takes it from
//             `decoded`, and closes everything behind it.
//
// A genuine BACKWARD jump (or a target already consumed/evicted, or a seek
// after the end-of-stream flush) resets the decoder and re-decodes from the
// covering keyframe.

import { FrameDecoder } from "./decoder";
import type { FrameDecoderConfig } from "./decoder";
import type { DemuxedVideoTrack } from "./mp4-demux";

/** The narrow slice of `FrameDecoder` this cursor needs — real WebCodecs only runs in a browser, so tests inject a fake here (same seam as `packages/export`'s `ExportDeps.createMuxer`). `state`/`decodeQueueSize` exist solely for stall diagnostics (see the watchdog logs below) — distinguishing "genuinely still churning through a big backlog" (`decodeQueueSize` still high) from "silently wedged with nothing left to do" (queue empty, `state` still `"configured"`) from "closed without ever calling onError" (a real decoder/browser bug, not ours). */
export interface FrameDecoderLike {
  decode(chunk: EncodedVideoChunk): Promise<VideoFrame>;
  flush(): Promise<void>;
  close(): void;
  readonly state: CodecState;
  readonly decodeQueueSize: number;
}

export type CreateFrameDecoder = (config: FrameDecoderConfig, onError: (error: DOMException) => void) => FrameDecoderLike;

const defaultCreateFrameDecoder: CreateFrameDecoder = (config, onError) => new FrameDecoder(config, onError);

/**
 * How far (in decode-order samples) we stay ahead of the target so the target
 * is emitted WITHOUT a flush. H.264's decoded-picture-buffer / reorder depth is
 * capped at 16, so once `target + 16` samples have been submitted the decoder
 * can no longer be withholding the target — it must have output it. Larger than
 * any real reorder depth; small enough that only ~16 frames are ever in flight.
 */
const REORDER_MARGIN = 16;

/**
 * Max time a single frame's decode may take before we treat it as a silent
 * stall (the decoder neither emits the frame nor raises an error — e.g. a
 * reorder-buffer tail with no flush, or backpressure). Generous for a real
 * decode on a saturated export tab; short enough that a genuine stall surfaces
 * as a logged diagnostic + reset-retry instead of an unkillable freeze.
 */
const STALL_TIMEOUT_MS = 8000;

export class VideoDecodeCursor {
  private decoder: FrameDecoderLike;
  /** Indices into `track.samples`, sorted by `timestampUs` (presentation order) — samples arrive from mp4box in DECODE order, which differs whenever the codec uses B-frames. */
  private readonly presentationOrder: number[];
  /** `decodeOrder` values of every keyframe, ascending. */
  private readonly keyframeDecodeOrders: number[];

  /** Highest decode-order sample index submitted to the current decoder, or `-1` after (re)configure. */
  private submittedUpTo = -1;
  /** Set once we've `flush()`ed (only ever at end-of-stream); the decoder then requires a keyframe next, so the next decoding seek resets. */
  private flushed = false;
  /** Frames the decoder has emitted but the consumer hasn't taken yet, keyed by decode-order index. Cursor owns them; closed on consume / reset / dispose. */
  private readonly decoded = new Map<number, VideoFrame>();
  /** Per-chunk decode promises still awaiting output, keyed by decode-order index. A seek awaits `pending.get(target)`; every handler moves its frame into `decoded` (or closes it if already passed). */
  private readonly pending = new Map<number, Promise<void>>();
  /**
   * Consumer watermark in PRESENTATION time (µs): any frame whose
   * `timestampUs` is strictly below this has been passed by the forward export
   * and must be closed on arrival. MUST be presentation-time, not a decode-
   * order index — with B-frames the export walks presentation order while the
   * decoder is fed decode order, so a decode-index watermark closes frames a
   * later presentation frame still needs (the stall-at-8 bug).
   */
  private consumedPtsBelow = Number.NEGATIVE_INFINITY;

  /** Presentation index currently parked on, so an identical re-seek is a no-op. `-1` until the first `seekTo` resolves. */
  private lastTargetIdx = -1;
  private currentFrameValue: VideoFrame | undefined;

  constructor(
    private readonly track: DemuxedVideoTrack,
    private readonly onError: (error: DOMException) => void = () => {},
    private readonly createDecoder: CreateFrameDecoder = defaultCreateFrameDecoder
  ) {
    this.decoder = createDecoder(track.config, onError);
    this.presentationOrder = track.samples
      .map((_, i) => i)
      .sort((a, b) => track.samples[a].timestampUs - track.samples[b].timestampUs);
    this.keyframeDecodeOrders = [];
    for (const s of track.samples) {
      if (s.isKeyframe) this.keyframeDecodeOrders.push(s.decodeOrder);
    }
  }

  /** The most recently decoded frame. Valid only after `seekTo` has resolved once. Callers must NOT `close()` it — the cursor does, on the next `seekTo` or `dispose()`. */
  currentFrame(): VideoFrame {
    if (!this.currentFrameValue) {
      throw new Error("VideoDecodeCursor: seekTo() must resolve at least once before currentFrame()");
    }
    return this.currentFrameValue;
  }

  /** Last sample (by decode order) whose `timestampUs <= timeUs`; clamps to the first sample if `timeUs` precedes everything. */
  private findTargetDecodeIdx(timeUs: number): number {
    const order = this.presentationOrder;
    const samples = this.track.samples;
    let lo = 0;
    let hi = order.length - 1;
    let result = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (samples[order[mid]].timestampUs <= timeUs) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return order[result];
  }

  /** Latest keyframe (by decode order) at or before `decodeIdx`, or `undefined` if none. */
  private latestKeyframeAtOrBefore(decodeIdx: number): number | undefined {
    const keys = this.keyframeDecodeOrders;
    let lo = 0;
    let hi = keys.length - 1;
    let result: number | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid] <= decodeIdx) {
        result = keys[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  private resetDecoder(): void {
    // Closing the decoder drops its queued outputs, so the in-flight `pending`
    // promises simply never resolve (their handlers never run) — safe to clear.
    this.decoder.close();
    this.decoder = this.createDecoder(this.track.config, this.onError);
    this.submittedUpTo = -1;
    this.flushed = false;
    this.pending.clear();
    for (const frame of this.decoded.values()) frame.close();
    this.decoded.clear();
    this.consumedPtsBelow = Number.NEGATIVE_INFINITY;
  }

  /** Submits a chunk and wires its output into `decoded` (or closes it if the consumer has already moved past that index). */
  private submit(i: number): void {
    const sample = this.track.samples[i];
    const chunk = new EncodedVideoChunk({
      type: sample.isKeyframe ? "key" : "delta",
      timestamp: sample.timestampUs,
      duration: sample.durationUs,
      data: sample.data,
    });
    const p = this.decoder
      .decode(chunk)
      .then((frame) => {
        this.pending.delete(i);
        if (this.track.samples[i].timestampUs < this.consumedPtsBelow) {
          frame.close(); // export already passed this presentation time while it was decoding
        } else {
          this.decoded.set(i, frame);
        }
      })
      .catch(() => {
        this.pending.delete(i); // decoder closed under us (reset) — nothing to emit
      });
    this.pending.set(i, p);
  }

  /**
   * Ensures every chunk from the current position up through `throughIdx`
   * (clamped to the stream) has been submitted, opening on `keyframe` when the
   * decoder is fresh. Flushes ONLY when the stream ends before a full margin
   * could be fed, so a near-end target still drains.
   */
  private async ensureSubmittedThrough(throughIdx: number, keyframe: number): Promise<void> {
    const lastIdx = this.track.samples.length - 1;
    const end = Math.min(throughIdx, lastIdx);
    const start = this.submittedUpTo < 0 ? keyframe : this.submittedUpTo + 1;

    if (start <= end) {
      for (let i = start; i <= end; i++) this.submit(i);
      this.submittedUpTo = Math.max(this.submittedUpTo, end);
    }

    // END-OF-STREAM DRAIN. When the caller wants to feed PAST the last sample
    // (i.e. the target is within a reorder margin of the end), the tail frames
    // are stuck in the decoder's reorder buffer: no further input can push them
    // out, and the decoder raises NO error, so awaiting one hangs FOREVER (the
    // freeze-at-video-end bug — the linear timeline outruns a shorter source
    // clip). One flush, once everything is submitted, drains the whole tail
    // into `decoded`.
    //
    // CRITICAL: this must run even when NOTHING new was submitted this call
    // (`start > end`) — that is EXACTLY the last-frames case, where every
    // sample is already in flight and only the flush is missing. Gating the
    // flush behind the submit loop (the old early-return) is what left the
    // final frames un-drained. `flushed` makes the next DECODING seek reset to
    // a keyframe (post-flush the decoder demands one); tail frames served from
    // `decoded` need no decoding, so a hold-last-frame tail never resets.
    if (throughIdx > lastIdx && this.submittedUpTo >= lastIdx && !this.flushed) {
      try {
        await this.awaitWithTimeout(this.decoder.flush(), () => {
          // Logged as a JSON STRING, not a live object — Chrome's console
          // truncates an object argument's preview with "…" once copied as
          // plain text (exactly what made `decodeQueueSize` invisible in an
          // earlier report of this same stall), which defeats the entire
          // point of a diagnostic meant to be pasted somewhere. A string
          // survives copy-paste intact no matter how DevTools previews it.
          console.error(
            "[VideoDecodeCursor] STALL — end-of-stream flush() never resolved\n" +
              JSON.stringify(
                {
                  submittedUpTo: this.submittedUpTo,
                  totalSamples: this.track.samples.length,
                  decodedIdx: [...this.decoded.keys()].sort((a, b) => a - b),
                  pendingIdx: [...this.pending.keys()].sort((a, b) => a - b),
                  // Distinguishes "still genuinely churning through a
                  // backlog" (decodeQueueSize still high, state
                  // "configured") from "silently wedged with nothing left
                  // to do" (queue empty, still "configured") from "closed
                  // without ever calling onError" (a real decoder/browser
                  // bug, not this module's). CONFIRMED IN PRODUCTION: queue
                  // empty + state configured — the browser silently drops
                  // specific tail samples without ever emitting output or
                  // an error, reproducibly across a full decoder reset. Not
                  // fixable by retrying; see the graceful-degradation
                  // fallback this triggers below instead of rethrowing.
                  decoderState: this.decoder.state,
                  decodeQueueSize: this.decoder.decodeQueueSize,
                },
                null,
                2
              )
          );
          return new Error(`VideoDecodeCursor: end-of-stream flush() stalled after ${STALL_TIMEOUT_MS}ms`);
        });
      } catch (err) {
        // GRACEFUL DEGRADATION, not a rethrow: confirmed in production that
        // a stuck end-of-stream flush() reproduces identically across a
        // full decoder reset (same tail samples never emitted, queue empty,
        // no error) — a real browser-level silent frame drop we cannot fix
        // or retry our way out of. Failing the whole export over a handful
        // of undecodable TAIL frames is a far worse outcome than holding
        // the last good frame for that stretch (the same philosophy the
        // original <video>-element path already uses for a stalled seek —
        // see texture-source.ts). `decodeAndConsume`'s fallback (below)
        // does the actual holding; this only needs to stop treating a
        // future seek near this same tail as "reachable" so it doesn't
        // pointlessly reset-and-resubmit the whole clip on every subsequent
        // frame request (see `seekTo`'s `reachableForward`).
        console.warn("[VideoDecodeCursor] end-of-stream flush() unrecoverable — holding the last decoded frame for the remaining tail instead of failing the export", err);
      }
      this.flushed = true;
    }
  }

  private setCurrent(frame: VideoFrame, targetIdx: number): VideoFrame {
    this.currentFrameValue?.close();
    this.currentFrameValue = frame;
    this.lastTargetIdx = targetIdx;
    return frame;
  }

  /**
   * Seeks to the sample covering `timeUs`, resolving with its decoded
   * `VideoFrame`. Re-seeking to the same target is a no-op. See module doc for
   * why this feeds past the target and awaits only the target's own output.
   *
   * If the decode fails (the decoder's `error` callback rejected the in-flight
   * promises — see decoder.ts), the decoder is reset and the seek retried ONCE
   * from the covering keyframe, so a transient mid-stream fault recovers
   * instead of freezing the export.
   */
  async seekTo(timeUs: number): Promise<VideoFrame> {
    const target = this.findTargetDecodeIdx(timeUs);

    if (target === this.lastTargetIdx && this.currentFrameValue) {
      return this.currentFrameValue;
    }

    // Can we reach the target by continuing forward? Only if it's already
    // decoded, already in flight, still ahead of what we've submitted with no
    // end-of-stream flush having intervened yet, OR at/past an already-flushed
    // end-of-stream (nothing left to submit — resetting would just resubmit
    // the WHOLE clip only to reproduce the identical unrecoverable tail,
    // confirmed in production; `decodeAndConsume`'s fallback holds the last
    // good frame for this case instead). Otherwise it's a genuine backward
    // jump to an earlier, evicted part of the clip — reset and re-decode from
    // its keyframe.
    const reachableForward =
      this.decoded.has(target) ||
      this.pending.has(target) ||
      (!this.flushed && target > this.submittedUpTo) ||
      (this.flushed && target >= this.submittedUpTo);
    if (!reachableForward) {
      this.resetDecoder();
    }

    try {
      return await this.decodeAndConsume(target);
    } catch {
      // Transient decoder error/stall — reconfigure from scratch and retry the
      // whole target once from its keyframe. A second failure is real: rethrow.
      this.resetDecoder();
      return await this.decodeAndConsume(target);
    }
  }

  /** Feeds through `target + REORDER_MARGIN`, awaits ONLY the target's output, hands it over, and closes everything the export has passed (by presentation time). */
  private async decodeAndConsume(target: number): Promise<VideoFrame> {
    const keyframe = this.latestKeyframeAtOrBefore(target) ?? 0;

    // Stay a full reorder margin ahead so the target is emitted without a flush.
    await this.ensureSubmittedThrough(target + REORDER_MARGIN, keyframe);

    // Await ONLY the target — never the trailing read-ahead frames, which stay
    // legitimately buffered until later input pushes them out. Guarded by a
    // watchdog so a silent stall (no output, no error) can't hang forever.
    // Caught (not propagated) rather than left to seekTo's reset-and-retry:
    // a reset can't fix a target that's genuinely never going to be emitted
    // (the confirmed silent-drop case this module doc describes) — it would
    // just pay for a full resubmit of the clip only to land right back here.
    const wait = this.pending.get(target);
    if (wait) {
      try {
        await this.awaitWithWatchdog(wait, target);
      } catch {
        // Falls through to the hold-last-frame fallback below.
      }
    }

    const frame = this.decoded.get(target);
    if (!frame) {
      // GRACEFUL DEGRADATION: the target was never emitted (a confirmed
      // browser-level silent frame drop, or the tail of a stream whose
      // flush() itself was unrecoverable — see `ensureSubmittedThrough`).
      // Holding the last successfully-decoded frame is a far better export
      // outcome than aborting entirely over a handful of undecodable
      // frames. Only a target with NOTHING to fall back to (the very first
      // seek ever failing) is a real, unrecoverable error.
      if (this.currentFrameValue) {
        console.warn(`[VideoDecodeCursor] target frame ${target} unavailable (submittedUpTo=${this.submittedUpTo}, flushed=${this.flushed}) — holding the last decoded frame instead of failing the export`);
        this.lastTargetIdx = target;
        return this.currentFrameValue;
      }
      throw new Error(`VideoDecodeCursor: decoder never emitted target frame ${target} and no earlier frame is available to hold (submittedUpTo=${this.submittedUpTo}, flushed=${this.flushed})`);
    }
    this.decoded.delete(target);

    // Export advances past this presentation time: close anything strictly
    // behind it and refuse late arrivals below the new watermark (in `submit`).
    // Presentation-time, NOT decode index — read-ahead frames (future pts) and
    // the target itself are never closed here, even when their decode indices
    // are lower than a B-frame we already consumed.
    const targetPts = this.track.samples[target].timestampUs;
    this.consumedPtsBelow = targetPts;
    for (const [i, f] of this.decoded) {
      if (this.track.samples[i].timestampUs < targetPts) {
        f.close();
        this.decoded.delete(i);
      }
    }

    return this.setCurrent(frame, target);
  }

  /**
   * Awaits `p`, but rejects if it neither resolves nor rejects within
   * `STALL_TIMEOUT_MS` — calling `onStall()` first (for a diagnostic dump)
   * to produce the rejection error. Generic over BOTH stall sites in this
   * class: a single target's decode (`awaitWithWatchdog`) and the
   * end-of-stream `flush()` (`ensureSubmittedThrough`) — a stall in either
   * one is otherwise indistinguishable from a merely slow decode, with no
   * timeout and no diagnostic, which is exactly how a real freeze looks.
   */
  private awaitWithTimeout<T>(p: Promise<T>, onStall: () => Error): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(onStall());
      }, STALL_TIMEOUT_MS);
      p.then(
        (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  /**
   * The per-target-decode stall watchdog. Rejection trips `seekTo`'s
   * reset-and-retry; a second stall on retry rethrows, failing the export
   * cleanly rather than freezing.
   */
  private awaitWithWatchdog(p: Promise<void>, target: number): Promise<void> {
    return this.awaitWithTimeout(p, () => {
      const s = this.track.samples;
      // Logged as a JSON STRING, not a live object — see the flush() stall's
      // matching comment in `ensureSubmittedThrough`: a live object argument
      // gets truncated with "…" once copied out of the DevTools console as
      // plain text, silently dropping exactly the fields (like
      // `decodeQueueSize`) needed to tell a real hang from a slow decode.
      // eslint-disable-next-line no-console
      console.error(
        "[VideoDecodeCursor] STALL — target frame never emitted\n" +
          JSON.stringify(
            {
              target,
              targetIsKeyframe: s[target]?.isKeyframe,
              targetTimestampUs: s[target]?.timestampUs,
              submittedUpTo: this.submittedUpTo,
              flushed: this.flushed,
              totalSamples: s.length,
              coveringKeyframe: this.latestKeyframeAtOrBefore(target),
              decodedIdx: [...this.decoded.keys()].sort((a, b) => a - b),
              pendingIdx: [...this.pending.keys()].sort((a, b) => a - b),
              consumedPtsBelow: this.consumedPtsBelow,
              decoderState: this.decoder.state,
              decodeQueueSize: this.decoder.decodeQueueSize,
            },
            null,
            2
          )
      );
      return new Error(`VideoDecodeCursor: target frame ${target} stalled after ${STALL_TIMEOUT_MS}ms`);
    });
  }

  dispose(): void {
    this.currentFrameValue?.close();
    this.currentFrameValue = undefined;
    for (const frame of this.decoded.values()) frame.close();
    this.decoded.clear();
    this.pending.clear();
    this.decoder.close();
  }
}

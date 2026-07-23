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

/** The narrow slice of `FrameDecoder` this cursor needs — real WebCodecs only runs in a browser, so tests inject a fake here (same seam as `packages/export`'s `ExportDeps.createMuxer`). */
export interface FrameDecoderLike {
  decode(chunk: EncodedVideoChunk): Promise<VideoFrame>;
  flush(): Promise<void>;
  close(): void;
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
    if (start > end) return;

    for (let i = start; i <= end; i++) this.submit(i);
    this.submittedUpTo = Math.max(this.submittedUpTo, end);

    // If we ran out of samples before reaching `throughIdx`, the reorder buffer
    // may still hold frames we need — flush to drain them. Only happens at true
    // end-of-stream; `flushed` forces the next decoding seek to reset.
    if (end === lastIdx && throughIdx > lastIdx) {
      await this.decoder.flush();
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
   */
  async seekTo(timeUs: number): Promise<VideoFrame> {
    const target = this.findTargetDecodeIdx(timeUs);

    if (target === this.lastTargetIdx && this.currentFrameValue) {
      return this.currentFrameValue;
    }

    // Can we reach the target by continuing forward? Only if it's already
    // decoded, already in flight, or still ahead of what we've submitted and no
    // end-of-stream flush has intervened. Otherwise it's a backward/evicted
    // jump — reset and re-decode from its keyframe.
    const reachableForward = this.decoded.has(target) || this.pending.has(target) || (!this.flushed && target > this.submittedUpTo);
    if (!reachableForward) {
      this.resetDecoder();
    }

    const keyframe = this.latestKeyframeAtOrBefore(target) ?? 0;

    // Stay a full reorder margin ahead so the target is emitted without a flush.
    await this.ensureSubmittedThrough(target + REORDER_MARGIN, keyframe);

    // Await ONLY the target — never the trailing read-ahead frames, which stay
    // legitimately buffered until later input pushes them out.
    const wait = this.pending.get(target);
    if (wait) await wait;

    const frame = this.decoded.get(target);
    if (!frame) {
      throw new Error(`VideoDecodeCursor: decoder never emitted target frame ${target} (submittedUpTo=${this.submittedUpTo}, flushed=${this.flushed})`);
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

  dispose(): void {
    this.currentFrameValue?.close();
    this.currentFrameValue = undefined;
    for (const frame of this.decoded.values()) frame.close();
    this.decoded.clear();
    this.pending.clear();
    this.decoder.close();
  }
}

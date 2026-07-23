// packages/media/src/decode-cursor.ts
//
// "Seek to arbitrary time" cursor built on decoder.ts's FrameDecoder, matched
// to how export walks frames MONOTONICALLY FORWARD (packages/export/src/
// frame-pump.ts's `for (let i = 0; i < frameCount; i++) await onFrame(i)`) —
// deliberately NOT a per-frame random-access decoder (ADR-016 rejected that:
// it wouldn't beat today's per-frame <video> seek). Walking forward within one
// GOP costs nothing extra beyond the next decode() call; a forward jump past
// a keyframe skips the now-unneeded rest of the old GOP; only a genuine
// BACKWARD jump (the same asset reused earlier in decode order elsewhere on
// the timeline — not the common "one video per beat" case, but possible for
// correctness) pays a decoder reset.
//
// ── FIX IN THIS REVISION: seekTo no longer DEADLOCKS or throws mid-GOP ───────
// Two coupled bugs, both fixed here.
//
// 1. DEADLOCK AT FRAME 0. `seekTo` used to await EACH `decoder.decode(chunk)`
//    before submitting the next chunk. A `VideoDecoder` is PIPELINED: it does
//    not emit an output frame the instant its matching chunk is fed — it
//    buffers, waiting for either more input chunks or an explicit `flush()`
//    (fundamental to B-frame reordering and hardware-decoder latency). Awaiting
//    frame N's output before feeding chunk N+1, while the decoder waits for
//    more input before emitting frame N, is a classic deadlock. It stranded on
//    the very first frame: `createVideoFrameTexture` does `await
//    cursor.seekTo(0)` at load, that promise never resolved, so the export
//    froze at frame 0. Fix: submit every chunk in the range WITHOUT awaiting
//    between them, then `flush()` once to force the decoder to drain them.
//
// 2. "A key frame is required after configure() or flush()." After `flush()`,
//    the `VideoDecoder` requires its NEXT submitted chunk to be a keyframe — it
//    does NOT retain a reference chain you can continue feeding delta frames
//    into. So the original plan of flushing each seek yet continuing a delta
//    walk from `lastSubmittedDecodeIdx + 1` on the next seek threw the instant
//    the next chunk was a delta frame. Fix: make every seek SELF-CONTAINED —
//    always start decoding from the latest keyframe at/before the target, so
//    the first chunk after any flush is always a keyframe. No cross-seek
//    decoder state is assumed; `resetDecoder` is no longer needed.
//
// Tradeoff: decoding from the keyframe on every seek re-decodes the GOP prefix,
// so a long-GOP clip is O(gopLength) per output frame. Correct and deadlock-
// free first; a read-ahead cache that reuses in-GOP frames across forward seeks
// is the perf follow-up (kept out here to avoid holding many VideoFrames — each
// pins GPU/CPU buffers — in memory at once).

import { FrameDecoder } from "./decoder";
import type { FrameDecoderConfig } from "./decoder";
import type { DemuxedVideoTrack } from "./mp4-demux";

/** The narrow slice of `FrameDecoder` this cursor actually needs — real WebCodecs only works in a browser, so tests inject a fake here instead (same "narrow interface behind an injectable seam" pattern as `packages/export`'s `ExportDeps.createMuxer`). */
export interface FrameDecoderLike {
  decode(chunk: EncodedVideoChunk): Promise<VideoFrame>;
  flush(): Promise<void>;
  close(): void;
}

export type CreateFrameDecoder = (config: FrameDecoderConfig, onError: (error: DOMException) => void) => FrameDecoderLike;

const defaultCreateFrameDecoder: CreateFrameDecoder = (config, onError) => new FrameDecoder(config, onError);

export class VideoDecodeCursor {
  private decoder: FrameDecoderLike;
  /** Indices into `track.samples`, sorted by `timestampUs` (presentation order) — samples arrive from mp4box in DECODE order, which differs whenever the codec uses B-frames. */
  private readonly presentationOrder: number[];
  /** `decodeOrder` values of every keyframe, ascending (decode order and array order coincide for `track.samples`, since mp4box delivers samples in decode order). */
  private readonly keyframeDecodeOrders: number[];
  /** Presentation index the cursor is currently parked on, so an identical re-seek is a cheap no-op. `-1` until the first `seekTo` resolves. */
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

  /** The most recently decoded frame. Valid only after `seekTo` has resolved at least once. Callers must NOT `close()` this themselves — the cursor closes it once superseded (in the next `seekTo`) or on `dispose()`. */
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

  /** Latest keyframe (by decode order) at or before `decodeIdx`, or `undefined` if none (shouldn't happen for a valid track — the first sample is always a keyframe). */
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

  /**
   * Seeks to the sample covering `timeUs`, resolving with its decoded
   * `VideoFrame`. Calling this again with the same target as last time is a
   * no-op (returns the same frame, decodes nothing new).
   *
   * SELF-CONTAINED per seek: always decodes from the latest keyframe at/before
   * the target through to the target, submitting every chunk WITHOUT awaiting
   * between them (a pipelined VideoDecoder won't emit frame N until it has more
   * input or a flush — awaiting each decode deadlocks), then `flush()`es once
   * to drain them. Starting at a keyframe every time is required because
   * `flush()` leaves the decoder demanding a keyframe as its next chunk (see
   * module doc) — we can never continue a delta walk across a flush.
   */
  async seekTo(timeUs: number): Promise<VideoFrame> {
    const targetIdx = this.findTargetDecodeIdx(timeUs);

    // Already parked on this exact frame — nothing to decode.
    if (targetIdx === this.lastTargetIdx && this.currentFrameValue) {
      return this.currentFrameValue;
    }

    const keyframe = this.latestKeyframeAtOrBefore(targetIdx);
    // A valid track always opens with a keyframe; fall back to 0 defensively.
    const startIdx = keyframe ?? 0;

    const samples = this.track.samples;

    // Submit every chunk from the keyframe through the target up front, keeping
    // the decoder's pipeline fed. Do NOT await between submissions.
    const pending: Promise<VideoFrame>[] = [];
    for (let i = startIdx; i <= targetIdx; i++) {
      const sample = samples[i];
      pending.push(
        this.decoder.decode(
          new EncodedVideoChunk({
            type: sample.isKeyframe ? "key" : "delta",
            timestamp: sample.timestampUs,
            duration: sample.durationUs,
            data: sample.data,
          })
        )
      );
    }

    // Force the decoder to emit everything we just submitted. Without this the
    // target frame's promise can hang forever. After this flush the decoder
    // requires a keyframe next — which the next seek always supplies, since it
    // too starts from a keyframe.
    await this.decoder.flush();
    const frames = await Promise.all(pending);

    // Last frame in the range is the target; the rest were decoded only to
    // satisfy the decoder's reference chain — their pixels are never read.
    this.currentFrameValue?.close();
    frames.forEach((frame, k) => {
      if (k === frames.length - 1) {
        this.currentFrameValue = frame;
      } else {
        frame.close();
      }
    });

    this.lastTargetIdx = targetIdx;

    return this.currentFrame();
  }

  dispose(): void {
    this.currentFrameValue?.close();
    this.currentFrameValue = undefined;
    this.decoder.close();
  }
}

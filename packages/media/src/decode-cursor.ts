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

import { FrameDecoder } from "./decoder";
import type { FrameDecoderConfig } from "./decoder";
import type { DemuxedVideoTrack } from "./mp4-demux";

/** The narrow slice of `FrameDecoder` this cursor actually needs — real WebCodecs only works in a browser, so tests inject a fake here instead (same "narrow interface behind an injectable seam" pattern as `packages/export`'s `ExportDeps.createMuxer`). */
export interface FrameDecoderLike {
  decode(chunk: EncodedVideoChunk): Promise<VideoFrame>;
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
  private lastSubmittedDecodeIdx = -1;
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

  private resetDecoder(): void {
    this.decoder.close();
    this.decoder = this.createDecoder(this.track.config, this.onError);
    this.lastSubmittedDecodeIdx = -1;
  }

  /**
   * Advances (or, on a backward jump, resets and re-seeks) to the sample
   * covering `timeUs`, resolving with its decoded `VideoFrame`. Calling this
   * again with the same `timeUs` as last time is a no-op (returns the same
   * frame, decodes nothing new).
   */
  async seekTo(timeUs: number): Promise<VideoFrame> {
    const targetIdx = this.findTargetDecodeIdx(timeUs);

    if (targetIdx < this.lastSubmittedDecodeIdx) {
      this.resetDecoder();
    }

    const keyframe = this.latestKeyframeAtOrBefore(targetIdx);
    const startIdx = keyframe !== undefined && keyframe > this.lastSubmittedDecodeIdx ? keyframe : this.lastSubmittedDecodeIdx + 1;

    const samples = this.track.samples;
    for (let i = startIdx; i <= targetIdx; i++) {
      const sample = samples[i];
      const chunk = new EncodedVideoChunk({
        type: sample.isKeyframe ? "key" : "delta",
        timestamp: sample.timestampUs,
        duration: sample.durationUs,
        data: sample.data,
      });
      const frame = await this.decoder.decode(chunk);
      if (i === targetIdx) {
        this.currentFrameValue?.close();
        this.currentFrameValue = frame;
      } else {
        // Needed only to satisfy the decoder's reference chain up to the
        // target — its pixels are never read.
        frame.close();
      }
    }
    this.lastSubmittedDecodeIdx = targetIdx;

    return this.currentFrame();
  }

  dispose(): void {
    this.currentFrameValue?.close();
    this.currentFrameValue = undefined;
    this.decoder.close();
  }
}

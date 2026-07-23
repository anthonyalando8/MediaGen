// packages/media/src/decoder.ts
//
// "WebCodecs + mp4box wrapper" (Deliverable 02 directory listing).
//
// SCOPE NOTE: demuxing — extracting EncodedVideoChunks and codec config
// (codec string, description/extradata, coded size) from an MP4 container
// via mp4box.js — is P2, wired into the export pipeline (packages/export).
// Phase 1 video PREVIEW uses the hidden-<video> path in texture-source.ts
// (the v1.0 MVP shortcut). This module is the WebCodecs decode wrapper that
// the P2 demuxer will feed: it's complete and unit-testable on its own
// (configure → decode → output), so Week 4 ships both halves of "media:
// texture-source + decoder" with the demux seam clearly marked for P2.

export interface FrameDecoderConfig {
  /** Codec string, e.g. "avc1.42E01E" (from mp4box's `track.codec`, P2). */
  codec: string;
  /** Codec-specific extradata (e.g. avcC box), if required by the codec. */
  description?: BufferSource;
  codedWidth: number;
  codedHeight: number;
}

/**
 * Decodes EncodedVideoChunks to VideoFrames, matching outputs back to
 * `decode()` calls by chunk timestamp. Callers MUST call `frame.close()` on
 * resolved VideoFrames once done with them (WebCodecs frames hold GPU/CPU
 * buffers and are not garbage-collected promptly).
 */
interface PendingDecode {
  resolve: (frame: VideoFrame) => void;
  reject: (error: Error) => void;
}

export class FrameDecoder {
  private decoder: VideoDecoder;
  private pending = new Map<number, PendingDecode>();
  private closed = false;

  constructor(config: FrameDecoderConfig, onError: (error: DOMException) => void = () => {}) {
    this.decoder = new VideoDecoder({
      output: (frame) => this.handleOutput(frame),
      error: (error) => this.handleError(error, onError),
    });
    this.decoder.configure({
      codec: config.codec,
      description: config.description,
      codedWidth: config.codedWidth,
      codedHeight: config.codedHeight,
    });
  }

  private handleOutput(frame: VideoFrame): void {
    const pending = this.pending.get(frame.timestamp);
    if (pending) {
      this.pending.delete(frame.timestamp);
      pending.resolve(frame);
    } else {
      // No one is waiting for this timestamp (e.g. after close()) — release it.
      frame.close();
    }
  }

  /**
   * Per the WebCodecs spec, a decode error CLOSES the underlying
   * `VideoDecoder` — no further output will ever arrive for any chunk
   * already submitted. Without this, every currently-pending `decode()`
   * call would simply never settle (not resolved — no output is coming —
   * and, before this fix, not rejected either, since nothing rejected them):
   * a silent, permanent hang on whichever frame was in flight when the
   * error occurred, with the error itself discarded by a no-op default
   * `onError`. This is what "export freezes at a specific frame with zero
   * console output" traces back to.
   */
  private handleError(error: DOMException, onError: (error: DOMException) => void): void {
    this.closed = true;
    for (const { reject } of this.pending.values()) {
      reject(new Error(`FrameDecoder: decode error: ${error.message}`));
    }
    this.pending.clear();
    onError(error);
  }

  get state(): CodecState {
    return this.decoder.state;
  }

  get decodeQueueSize(): number {
    return this.decoder.decodeQueueSize;
  }

  /**
   * Queues `chunk` for decode, resolving with the output VideoFrame at that
   * chunk's timestamp. The decoder may reorder/buffer frames internally
   * (B-frames); this resolves whenever the matching output arrives. Rejects
   * if the decoder errors (see `handleError`) or is already closed.
   */
  decode(chunk: EncodedVideoChunk): Promise<VideoFrame> {
    if (this.closed) {
      return Promise.reject(new Error("FrameDecoder is closed"));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(chunk.timestamp, { resolve, reject });
      try {
        this.decoder.decode(chunk);
      } catch (err) {
        // A synchronous throw here (e.g. the decoder was already closed by
        // a just-prior error) would otherwise leave this entry dangling —
        // nothing else will ever settle it once decode() itself never
        // queued the chunk.
        this.pending.delete(chunk.timestamp);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Flushes any buffered frames; resolves once all pending decodes have emitted output. */
  async flush(): Promise<void> {
    await this.decoder.flush();
  }

  /** Releases the underlying VideoDecoder and any unclaimed pending frames. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.decoder.close();
    for (const { reject } of this.pending.values()) {
      reject(new Error("FrameDecoder closed"));
    }
    this.pending.clear();
  }
}
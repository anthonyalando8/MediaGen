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
export class FrameDecoder {
  private decoder: VideoDecoder;
  private pending = new Map<number, (frame: VideoFrame) => void>();
  private closed = false;

  constructor(config: FrameDecoderConfig, onError: (error: DOMException) => void = () => {}) {
    this.decoder = new VideoDecoder({
      output: (frame) => this.handleOutput(frame),
      error: onError,
    });
    this.decoder.configure({
      codec: config.codec,
      description: config.description,
      codedWidth: config.codedWidth,
      codedHeight: config.codedHeight,
    });
  }

  private handleOutput(frame: VideoFrame): void {
    const resolve = this.pending.get(frame.timestamp);
    if (resolve) {
      this.pending.delete(frame.timestamp);
      resolve(frame);
    } else {
      // No one is waiting for this timestamp (e.g. after close()) — release it.
      frame.close();
    }
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
   * (B-frames); this resolves whenever the matching output arrives.
   */
  decode(chunk: EncodedVideoChunk): Promise<VideoFrame> {
    if (this.closed) {
      return Promise.reject(new Error("FrameDecoder is closed"));
    }
    return new Promise((resolve) => {
      this.pending.set(chunk.timestamp, resolve);
      this.decoder.decode(chunk);
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
    this.pending.clear();
  }
}
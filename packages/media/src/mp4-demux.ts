// packages/media/src/mp4-demux.ts
//
// mp4box.js wrapper — demuxes an MP4's first video track into WebCodecs-ready
// pieces (a VideoDecoderConfig + EncodedVideoChunk-shaped samples in DECODE
// order). This is the P2 piece ADR-016 scoped: `decoder.ts`'s FrameDecoder
// already does configure -> decode -> output; the missing piece was getting
// real compressed samples + codec config OUT of an MP4 container without an
// HTMLVideoElement. EXPORT ONLY (see texture-source.ts's `createVideoFrameTexture`
// and decode-cursor.ts's `VideoDecodeCursor`, which this module feeds) — live
// preview keeps using the hidden-<video> path unchanged.
//
// Mirrors the canonical mp4box+WebCodecs demux pattern from the W3C WebCodecs
// samples repo (samples/video-decode-display/demuxer_mp4.js): fetch the whole
// file, feed it to MP4Box in one shot (no need for that sample's streaming
// WritableStream pump — export assets are short-form b-roll, not multi-GB
// files), read codec config off `onReady`, pull the codec's description
// (avcC/hvcC/vpcC/av1C box bytes, minus the box header) via `getTrackById`,
// and turn every `onSamples` delivery into a flat decode-order sample list.

import { createFile, MultiBufferStream, MP4BoxBuffer } from "mp4box";
import type { ISOFile, Movie, Track, VisualSampleEntry } from "mp4box";
import type { FrameDecoderConfig } from "./decoder";

export interface DemuxedSample {
  /** Index into the DECODE order (the order mp4box's sample table — and thus `onSamples` — delivers them, NOT presentation order; B-frames mean these differ). */
  decodeOrder: number;
  /** Presentation timestamp, in MICROSECONDS (matches EncodedVideoChunk's `timestamp` unit). */
  timestampUs: number;
  durationUs: number;
  isKeyframe: boolean;
  data: Uint8Array;
}

export interface DemuxedVideoTrack {
  /** Reuses `FrameDecoder`'s own config shape (decoder.ts) directly — it's exactly the 4 fields WebCodecs' `VideoDecoder.configure()` needs, and matching it here avoids a structural mismatch against `VideoDecoderConfig`'s wider (SharedArrayBuffer-inclusive) `description` type. */
  config: FrameDecoderConfig;
  /** In DECODE order (same order as `onSamples` delivery / the file's sample table) — NOT sorted by timestamp. */
  samples: DemuxedSample[];
}

/**
 * Extracts the codec-specific `description` bytes (avcC/hvcC/vpcC/av1C box,
 * minus its 8-byte box header) WebCodecs' VideoDecoderConfig needs for H.264/
 * H.265/VP9/AV1. Mirrors the W3C WebCodecs sample's `#description()` helper.
 * `stsdBox.entries` is typed as the base `SampleEntry` — the avcC/hvcC/vpcC/
 * av1C fields only exist on `VisualSampleEntry`, which every entry actually
 * is for a video track at runtime (mp4box just doesn't encode that narrowing
 * in `stsdBox`'s own type).
 */
function descriptionForTrack(file: ISOFile, track: Track): Uint8Array<ArrayBuffer> {
  const trak = file.getTrackById(track.id);
  for (const entry of trak.mdia.minf.stbl.stsd.entries as VisualSampleEntry[]) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new MultiBufferStream();
      box.write(stream);
      // Copy into a fresh plain `Uint8Array` (the numeric-length constructor
      // overload, which always allocates its own `ArrayBuffer`) rather than
      // a view over `stream.buffer` directly — `stream.buffer` is an
      // `MP4BoxBuffer`, whose `ArrayBufferLike` ancestry TS widens to include
      // `SharedArrayBuffer`, which `FrameDecoderConfig`'s `BufferSource`
      // (and WebCodecs itself) reject. Also strips the box header (4-byte
      // size + 4-byte fourcc), hence the `8` offset.
      const view = new Uint8Array(stream.buffer, 8);
      // The numeric-length constructor always allocates a fresh plain
      // ArrayBuffer (never Shared) — the cast just tells TS what's already
      // true at runtime, since `stream.buffer`'s `MP4BoxBuffer` ancestry
      // otherwise widens inference to `ArrayBufferLike`.
      const description = new Uint8Array(view.byteLength) as Uint8Array<ArrayBuffer>;
      description.set(view);
      return description;
    }
  }
  throw new Error(`mp4-demux: no avcC/hvcC/vpcC/av1C box found for track ${track.id}`);
}

/** Demuxes `url`'s first video track. Rejects if the fetch fails, the container has no video track, or the codec's description box can't be found. */
export function demuxVideoTrack(url: string): Promise<DemuxedVideoTrack> {
  return new Promise((resolve, reject) => {
    const file = createFile();
    const samples: DemuxedSample[] = [];
    let config: FrameDecoderConfig | undefined;
    let expectedCount = -1;
    let settled = false;

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    file.onError = (module, message) => fail(new Error(`mp4-demux: mp4box error (${module}): ${message}`));

    file.onReady = (info: Movie) => {
      const track = info.videoTracks[0];
      if (!track) {
        fail(new Error("mp4-demux: no video track found in asset"));
        return;
      }
      if (!track.video) {
        fail(new Error(`mp4-demux: track ${track.id} has no video dimensions`));
        return;
      }

      let description: Uint8Array<ArrayBuffer>;
      try {
        description = descriptionForTrack(file, track);
      } catch (err) {
        fail(err as Error);
        return;
      }

      config = {
        // Browsers don't support parsing the full vp8 codec string (e.g. "vp08.00.41.08"), only "vp8".
        codec: track.codec.startsWith("vp08") ? "vp8" : track.codec,
        codedWidth: track.video.width,
        codedHeight: track.video.height,
        description,
      };
      expectedCount = track.nb_samples;

      file.setExtractionOptions(track.id, undefined, { nbSamples: expectedCount });
      file.start();
    };

    file.onSamples = (_id, _user, mp4Samples) => {
      for (const s of mp4Samples) {
        if (!s.data) {
          // Would silently desync `decodeOrder` from the file's true sample
          // count and, worse, make `samples.length >= expectedCount` never
          // fire — hanging this promise forever instead of failing loudly.
          fail(new Error(`mp4-demux: sample ${s.number} has no data (extraction options may be missing)`));
          return;
        }
        samples.push({
          decodeOrder: samples.length,
          timestampUs: (1e6 * s.cts) / s.timescale,
          durationUs: (1e6 * s.duration) / s.timescale,
          isKeyframe: s.is_sync,
          data: s.data,
        });
      }
      if (config && expectedCount >= 0 && samples.length >= expectedCount && !settled) {
        settled = true;
        resolve({ config, samples });
      }
    };

    fetch(url)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        const mp4boxBuffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
        file.appendBuffer(mp4boxBuffer, true);
        // `last: true` above only marks this as the final chunk for
        // incremental/streaming parsing — it does NOT itself force already-
        // buffered sample data through extraction. `flush()` is what
        // actually does that (mirrors the W3C WebCodecs sample's
        // `MP4FileSink.close()`, which calls `file.flush()` once all data
        // has been appended). Without this, `onReady` still fires (moov is
        // parsed), but `onSamples` may never fire for the just-registered
        // extraction — hanging this promise forever instead of resolving
        // OR rejecting, which silently hangs the entire export pump on
        // frame 0 (no progress, no error).
        file.flush();
      })
      .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));

    // Safety net: any future edge case (an mp4box quirk, an unusual
    // container) that leaves this promise neither resolved nor rejected
    // should fail LOUDLY rather than hang the export pump forever with no
    // progress and no error (exactly the failure mode `flush()` above was
    // just found to cause). Generous enough for a large asset's demux; short
    // enough that a genuine hang doesn't look like export is just "slow."
    setTimeout(() => fail(new Error(`mp4-demux: timed out demuxing "${url}" (mp4box never finished sample extraction)`)), 30_000);
  });
}

// packages/renderer-webgl/src/audio/audio-engine.ts  (or apps/editor/src/audio/audio-engine.ts)
//
// ─────────────────────────────────────────────────────────────────────────────
// AUDIO ENGINE
// ─────────────────────────────────────────────────────────────────────────────
//
// Drives Web Audio API playback synchronized to the composition playhead.
// Designed as a plain class (no React) so it can be instantiated once and
// shared across the editor's lifecycle.
//
// ARCHITECTURE
// ------------
// Each AudioTrack gets its own AudioBufferSourceNode + GainNode chain:
//
//   AudioBufferSourceNode ──► GainNode (volume + fades) ──► AudioContext.destination
//
// The engine is driven by two external calls:
//   • engine.seek(frame, fps)   — moves playhead, reschedules if playing
//   • engine.setPlaying(bool)   — starts/stops all tracks
//
// SYNC MODEL
// ----------
// Web Audio operates on a separate high-precision clock (AudioContext.currentTime).
// We schedule playback relative to AudioContext.currentTime at the moment
// play() is called, so audio stays in sync even if RAF frames are uneven.
//
// When the user scrubs (seek while paused), audio stops immediately.
// When play starts, all tracks are scheduled from the current playhead position.
//
// DECODING
// --------
// Audio files are decoded once (AudioContext.decodeAudioData) and cached by
// asset ID. Subsequent seeks reuse the decoded buffer — no re-decode.
//
// FADES
// -----
// Implemented via GainNode.linearRampToValueAtTime scheduled at source start/end.
// This happens in the audio thread — no RAF overhead.
//
// SOLO/MUTE
// ---------
// Muted tracks: GainNode.gain = 0 (still scheduled, zero volume)
// Solo: if any track is soloed, all non-solo tracks get gain = 0
//
// MULTIPLE TRACKS
// ---------------
// All tracks are scheduled simultaneously from the same AudioContext.currentTime
// anchor, so they play in perfect sync.

export interface AudioAssetRef {
  id:    string;
  url:   string;
  kind:  string;
}

export interface AudioTrackState {
  id:         string;
  assetId:    string;
  startFrame: number;
  endFrame?:  number;
  trimIn:     number;
  trimOut?:   number;
  volume:     number;
  fadeIn:     number;
  fadeOut:    number;
  loop:       boolean;
  muted:      boolean;
  solo:       boolean;
}

interface ScheduledTrack {
  source:  AudioBufferSourceNode;
  gain:    GainNode;
  trackId: string;
}

export class AudioEngine {
  private ctx:         AudioContext | null = null;
  private buffers      = new Map<string, AudioBuffer>();
  private loading      = new Map<string, Promise<AudioBuffer | null>>();
  private scheduled:   ScheduledTrack[] = [];
  private playing      = false;
  private currentFrame = 0;
  private currentFps   = 30;
  // Anchor recorded at the moment scheduleAll() last ran, in AudioContext's
  // own high-precision clock — lets seek() compute where playback SHOULD be
  // right now if nothing has disturbed it, so a normal per-frame playhead
  // tick during ordinary playback doesn't get treated as a scrub. See
  // seek()'s doc for why this distinction is the whole fix.
  private scheduledAtAudioTime = 0;
  private scheduledAtFrame     = 0;

  // ── Context ───────────────────────────────────────────────────────────────

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    // Resume on first interaction (browsers block autoplay)
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {/* ignore */});
    }
    return this.ctx;
  }

  // ── Asset decoding ────────────────────────────────────────────────────────

  /**
   * Pre-load and decode an audio asset. Safe to call multiple times —
   * subsequent calls for the same id return the cached buffer.
   */
  async loadAsset(asset: AudioAssetRef): Promise<void> {
    if (asset.kind !== "audio") return;
    if (this.buffers.has(asset.id)) return;
    if (this.loading.has(asset.id)) {
      await this.loading.get(asset.id);
      return;
    }
    const ctx = this.getCtx();
    const promise = fetch(asset.url)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        this.buffers.set(asset.id, buf);
        return buf;
      })
      .catch((err) => {
        console.warn(`[AudioEngine] Failed to load ${asset.id}:`, err);
        return null;
      });
    this.loading.set(asset.id, promise);
    await promise;
    this.loading.delete(asset.id);
  }

  // ── Playback control ──────────────────────────────────────────────────────

  /**
   * Start playback from the current frame position.
   * All tracks are scheduled simultaneously from the same AudioContext anchor.
   */
  setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    this.playing = playing;
    if (playing) {
      this.scheduleAll();
    } else {
      this.stopAll();
    }
  }

  /**
   * Move the playhead. If paused, just records the new position (no audio
   * is playing, nothing to reschedule). If playing, this is called on
   * EVERY playhead tick during ordinary playback too (useAudioSync.ts
   * subscribes to the whole store and calls this whenever `state.playhead`
   * changes, which is continuous while playing) — NOT just on a genuine
   * scrub/loop/click-to-seek. Rescheduling unconditionally here (the
   * previous behavior: `stopAll(); scheduleAll();` every single call) means
   * every normal playback tick abruptly stops the in-flight
   * AudioBufferSourceNode (an un-faded stop — an audible click) and starts
   * a brand new one a few milliseconds later — repeated 30-60x/second,
   * which is audible as constant clicking/noise on top of the real audio,
   * not silence-clean playback. (This is why exported audio always sounded
   * clean: `packages/export/src/audio-render.ts` schedules everything ONCE
   * in a single offline pass, with no incremental rescheduling to go wrong.)
   *
   * Fix: compute what frame the CURRENTLY SCHEDULED playback should be at
   * right now, purely from elapsed AudioContext time since it was last
   * scheduled (`scheduledAtAudioTime`/`scheduledAtFrame`). If the incoming
   * `frame` matches that within a small tolerance, playback is proceeding
   * normally and already correct — do nothing. Only reschedule when they
   * diverge by more than the tolerance, which only happens on an actual
   * scrub, loop restart, or timeline click.
   */
  seek(frame: number, fps: number): void {
    const fpsChanged = fps !== this.currentFps;
    this.currentFrame = frame;
    this.currentFps   = fps;

    if (!this.playing) return; // paused — nothing scheduled, nothing to do beyond recording position

    if (!fpsChanged && this.scheduled.length > 0 && this.ctx) {
      const elapsedSec = this.ctx.currentTime - this.scheduledAtAudioTime;
      const expectedFrame = this.scheduledAtFrame + elapsedSec * fps;
      const toleranceFrames = 2; // generous enough to absorb RAF jitter, tight enough to still catch a real scrub of even a few frames
      if (Math.abs(frame - expectedFrame) <= toleranceFrames) return; // natural playback advance — already correct, don't touch it
    }

    this.stopAll();
    this.scheduleAll();
  }

  /**
   * Update the track list. Call whenever AudioTrack[] changes.
   * If playing, reschedules to pick up changes immediately.
   */
  update(tracks: AudioTrackState[], resolveUrl: (assetId: string) => string | undefined): void {
    this._tracks   = tracks;
    this._resolveUrl = resolveUrl;
    // Pre-load any new assets in the background
    for (const t of tracks) {
      const url = resolveUrl(t.assetId);
      if (url && !this.buffers.has(t.assetId) && !this.loading.has(t.assetId)) {
        this.loadAsset({ id: t.assetId, url, kind: "audio" });
      }
    }
    if (this.playing) {
      this.stopAll();
      this.scheduleAll();
    }
  }

  private _tracks:     AudioTrackState[] = [];
  private _resolveUrl: (assetId: string) => string | undefined = () => undefined;

  // ── Internal scheduling ───────────────────────────────────────────────────

  private scheduleAll(): void {
    if (!this._tracks.length) return;
    const ctx     = this.getCtx();
    const fps     = this.currentFps;
    const frame   = this.currentFrame;
    const now     = ctx.currentTime;
    const hasSolo = this._tracks.some((t) => t.solo && !t.muted);

    this.scheduledAtAudioTime = now;
    this.scheduledAtFrame     = frame;

    for (const track of this._tracks) {
      const buffer = this.buffers.get(track.assetId);
      if (!buffer) continue;

      // Determine if this track should be audible
      const effectiveMute = track.muted || (hasSolo && !track.solo);

      const trackStartSec = track.startFrame / fps;
      const trackEndSec   = track.endFrame !== undefined
        ? track.endFrame / fps
        : trackStartSec + (track.trimOut ?? buffer.duration) - track.trimIn;

      const currentSec = frame / fps;

      // Skip tracks that have already ended
      if (currentSec >= trackEndSec) continue;

      // Time within the audio file at the current playhead
      const audioOffset = track.trimIn + Math.max(0, currentSec - trackStartSec);

      // How long to play from this position
      const duration = trackEndSec - Math.max(currentSec, trackStartSec);
      if (duration <= 0) continue;

      // Delay: if the track hasn't started yet, schedule it for the future
      const delay = Math.max(0, trackStartSec - currentSec);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop   = track.loop;
      if (track.loop && track.trimOut !== undefined) {
        source.loopStart = track.trimIn;
        source.loopEnd   = track.trimOut;
      }

      const gain = ctx.createGain();
      const targetGain = effectiveMute ? 0 : track.volume;

      // Schedule fades
      const startAt = now + delay;
      const endAt   = startAt + duration;

      if (track.fadeIn > 0 && !effectiveMute) {
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(targetGain, startAt + track.fadeIn);
      } else {
        gain.gain.setValueAtTime(targetGain, startAt);
      }

      if (track.fadeOut > 0 && !effectiveMute) {
        gain.gain.setValueAtTime(targetGain, endAt - track.fadeOut);
        gain.gain.linearRampToValueAtTime(0, endAt);
      }

      source.connect(gain);
      gain.connect(ctx.destination);

      // Start: delay=0 means start immediately; delay>0 means schedule ahead
      source.start(startAt, audioOffset, track.loop ? undefined : duration);

      this.scheduled.push({ source, gain, trackId: track.id });
    }
  }

  private stopAll(): void {
    const ctx = this.ctx;
    for (const { source, gain } of this.scheduled) {
      try {
        source.stop();
        source.disconnect();
        gain.disconnect();
      } catch {
        // Already stopped — ignore
      }
    }
    this.scheduled = [];
    // If AudioContext was suspended for autoplay policy, keep it alive but silent
    if (ctx && ctx.state === "running") {
      // Context stays running for next play — faster resume
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy(): void {
    this.stopAll();
    this.ctx?.close().catch(() => {/* ignore */});
    this.ctx = null;
    this.buffers.clear();
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /** True if the asset's buffer is decoded and ready to play. */
  isReady(assetId: string): boolean {
    return this.buffers.has(assetId);
  }

  /** Duration in seconds of a decoded asset. undefined if not yet loaded. */
  getDuration(assetId: string): number | undefined {
    return this.buffers.get(assetId)?.duration;
  }
}

/** Singleton engine instance — created once per app lifecycle. */
export const audioEngine = new AudioEngine();
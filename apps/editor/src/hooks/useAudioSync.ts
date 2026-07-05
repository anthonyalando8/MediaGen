// apps/editor/src/hooks/useAudioSync.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// useAudioSync — wires the AudioEngine singleton to the editor store
// ─────────────────────────────────────────────────────────────────────────────
//
// Call ONCE inside App (or any component that mounts for the full session).
// Uses Zustand subscribe() — NOT useSelector — so audio responds immediately
// without waiting for a React render cycle. This is critical for seek accuracy.
//
// What it syncs:
//   store.playing     → audioEngine.setPlaying()
//   store.playhead    → audioEngine.seek(frame, fps)
//   comp.audioTracks  → audioEngine.update(tracks, resolveUrl)
//
// URL resolution:
//   Audio assets live in project.assets as { id, kind:"audio", master, proxy? }.
//   The resolver returns proxy ?? master for the given assetId.

import { useEffect, useRef } from "react";
import { audioEngine } from "../audio/audio-engine";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import type { AudioTrack } from "core";

export function useAudioSync() {
  const store        = useEditorStoreApi();
  const lastPlayhead = useRef<number>(-1);
  const lastPlaying  = useRef<boolean>(false);
  const lastTracksRef = useRef<string>(""); // JSON fingerprint to detect changes

  useEffect(() => {
    function sync() {
      const state   = store.getState();
      const playing = (state.playing as boolean) ?? false;
      const frame   = (state.playhead as number) ?? 0;
      const comp    = activeComp(state);
      const fps     = (comp.fps as number) ?? 30;

      const tracks: AudioTrack[] =
        (comp as unknown as { audioTracks?: AudioTrack[] }).audioTracks ?? [];

      // URL resolver — reads project.assets at call time (live, no closure capture)
      const resolveUrl = (assetId: string): string | undefined => {
        const assets = state.document?.project?.assets ?? [];
        const asset  = assets.find((a: { id: string }) => a.id === assetId) as
          { proxy?: string; master?: string; url?: string } | undefined;
        return asset?.proxy ?? asset?.master ?? asset?.url;
      };

      // Update tracks whenever the array changes (fingerprint by JSON)
      const fingerprint = JSON.stringify(tracks.map(t => ({
        id: t.id, assetId: t.assetId, startFrame: t.startFrame,
        endFrame: t.endFrame, volume: t.volume, muted: t.muted, solo: t.solo,
        loop: t.loop, trimIn: t.trimIn, trimOut: t.trimOut,
      })));
      if (fingerprint !== lastTracksRef.current) {
        lastTracksRef.current = fingerprint;
        audioEngine.update(
          tracks.map(t => ({
            id: t.id, assetId: t.assetId,
            startFrame: t.startFrame, endFrame: t.endFrame,
            trimIn: t.trimIn, trimOut: t.trimOut,
            volume: t.volume, fadeIn: t.fadeIn, fadeOut: t.fadeOut,
            loop: t.loop, muted: t.muted, solo: t.solo,
          })),
          resolveUrl
        );
      }

      // Seek on playhead change (scrubbing while paused, or advancing while playing)
      if (frame !== lastPlayhead.current) {
        lastPlayhead.current = frame;
        audioEngine.seek(frame, fps);
      }

      // Toggle play/pause
      if (playing !== lastPlaying.current) {
        lastPlaying.current = playing;
        audioEngine.setPlaying(playing);
      }
    }

    const unsubscribe = store.subscribe(sync);
    sync(); // run immediately on mount

    return () => {
      unsubscribe();
      // Stop audio cleanly when the component unmounts
      audioEngine.setPlaying(false);
    };
  }, [store]);
}
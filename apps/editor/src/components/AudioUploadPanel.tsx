// apps/editor/src/components/AudioUploadPanel.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// AUDIO UPLOAD PANEL — left media panel section
// ─────────────────────────────────────────────────────────────────────────────
//
// Renders below image/video assets in the left media panel.
//
// FLOW
// ----
// 1. User drops/picks audio file(s)
// 2. createObjectURL() gives a local URL immediately
// 3. Asset added to project.assets via store.addAsset({ id, kind:"audio", master: url, name })
// 4. audioEngine.loadAsset() decodes in background → duration appears
// 5. User clicks "+ Add" → addAudioTrackOp places track at current playhead
// 6. (Week 12) In parallel with 3–4, the real file is also uploaded to
//    apps/api's asset pipeline in the background. Once the transcode
//    worker finishes, the SAME asset id is updated in place — hash becomes
//    the real SHA-256, master swaps from a blob: URL (lost on reload) to a
//    stable server URL, and a real waveform (ffmpeg peak data, not the
//    decorative CSS mask) becomes available. If the backend is unreachable
//    or the transcode fails, this step is swallowed — the local blob:
//    asset from steps 2–4 keeps working exactly as it did in P1.
//
// SUPPORTED FORMATS: MP3, WAV, AAC, OGG, FLAC, M4A
// (anything the browser AudioContext can decode)

import { useCallback, useRef, useState } from "react";
import { Music, Upload, Plus, Trash2, Clock } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { addAudioTrackOp, removeAudioTrackOp } from "../commands/audio-ops";
import { audioEngine } from "../audio/audio-engine";
import { uploadAssetToServer } from "../persistence/asset-upload";
import { API_BASE_URL } from "../config/api";
import type { AudioTrack } from "core";
import { createId } from "core";

// ── Constants ──────────────────────────────────────────────────────────────

const ACCEPTED_EXTS = /\.(mp3|wav|aac|ogg|flac|m4a|weba|opus)$/i;
const ACCEPTED_MIME = new Set([
  "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac", "audio/ogg",
  "audio/flac", "audio/x-m4a", "audio/mp4", "audio/webm", "audio/opus",
]);

function isAudioFile(f: File) {
  return ACCEPTED_MIME.has(f.type) || ACCEPTED_EXTS.test(f.name);
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtSize(b: number) {
  return b < 1_048_576
    ? `${(b / 1024).toFixed(0)} KB`
    : `${(b / 1_048_576).toFixed(1)} MB`;
}

/**
 * Computes a SHA-256 content hash of the file — AssetRef.hash is required
 * (core's provenance/dedup model, see project.ts). Uses the Web Crypto API
 * already available in every browser context; no extra dependency.
 */
async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Component ──────────────────────────────────────────────────────────────

export function AudioUploadPanel() {
  const store       = useEditorStoreApi();
  const playhead    = useEditorStore((s) => s.playhead as number);
  const fps         = useEditorStore((s) => (activeComp(s).fps as number) ?? 30);

  // Audio assets from project.assets filtered by kind==="audio"
  const audioAssets = useEditorStore((s) =>
    (s.document?.project?.assets ?? []).filter(
      (a: { kind: string }) => a.kind === "audio"
    ) as unknown as Array<{ id: string; name: string; master: string; kind: "audio" }>
  );

  // Decoded durations — populated after audioEngine decodes each file
  const [durations, setDurations]  = useState<Record<string, number>>({});
  const [fileSizes,  setFileSizes]  = useState<Record<string, number>>({});
  const [names,      setNames]      = useState<Record<string, string>>({});
  const [loading,    setLoading]    = useState<Set<string>>(new Set());
  const [dragging,   setDragging]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  // Ids whose server-side transcode (real waveform, stable master URL) has
  // completed — see FLOW step 6. Purely informational (small UI affordance
  // below); playback/scheduling works identically before and after.
  const [synced,     setSynced]     = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const audioTracks = useEditorStore((s) =>
    ((activeComp(s) as unknown as { audioTracks?: AudioTrack[] }).audioTracks ?? [])
  );
  const trackAssetIds = new Set(audioTracks.map((t) => t.assetId));

  // ── Upload handler ───────────────────────────────────────────────────────

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr       = Array.from(files);
    const audioOnly = arr.filter(isAudioFile);

    if (!audioOnly.length) {
      setError("No supported audio files. Use MP3, WAV, AAC, OGG, FLAC or M4A.");
      setTimeout(() => setError(null), 4000);
      return;
    }
    if (arr.length > audioOnly.length) {
      setError(`${arr.length - audioOnly.length} file(s) skipped — unsupported format.`);
      setTimeout(() => setError(null), 3000);
    }

    for (const file of audioOnly) {
      const id  = createId();
      const url = URL.createObjectURL(file);
      const name = file.name.replace(/\.[^.]+$/, "");

      setNames((prev) => ({ ...prev, [id]: name }));
      setFileSizes((prev) => ({ ...prev, [id]: file.size }));
      setLoading((prev) => new Set(prev).add(id));

      // Hash first — AssetRef.hash is required (content-addressed provenance,
      // same model images/video use via fileToAssetRef in asset-upload.ts).
      const hash = await hashFile(file);

      const state = store.getState();
      state.addAsset({ id, hash, kind: "audio", master: url, provenance: "upload" });

      // Pre-decode in the audio engine (runs in background)
      audioEngine.loadAsset({ id, url, kind: "audio" }).then(() => {
        const dur = audioEngine.getDuration(id);
        if (dur !== undefined) setDurations((prev) => ({ ...prev, [id]: dur }));
        setLoading((prev) => { const n = new Set(prev); n.delete(id); return n; });
      });

      // Step 6: real upload + transcode in the background, reconciled onto
      // this same local `id` once ready — see this file's FLOW comment.
      // Fire-and-forget from handleFiles' perspective: failures here just
      // mean the asset stays on its local blob: URL, exactly as before
      // Week 12 existed.
      uploadAssetToServer(file, { apiBaseUrl: API_BASE_URL })
        .then((ready) => {
          const state = store.getState();
          const current = state.document?.project?.assets?.find((a) => a.id === id);
          if (!current) return; // asset (or whole project) was removed while the upload was in flight
          state.addAsset({ ...current, hash: ready.hash, master: ready.master, proxy: ready.proxy, waveform: ready.waveform });
          if (url.startsWith("blob:")) URL.revokeObjectURL(url); // decoded buffer is already in memory; the blob: URL served its purpose
          setSynced((prev) => new Set(prev).add(id));
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`[AudioUploadPanel] server-side transcode unavailable for asset ${id}, staying on local blob: URL:`, err);
        });
    }
  }, [store]);

  // ── Drag & drop ──────────────────────────────────────────────────────────

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setDragging(true); }
  function onDragLeave() { setDragging(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  // ── Add to timeline ───────────────────────────────────────────────────────

  function addToTimeline(assetId: string) {
    const state = store.getState();
    const trackName = names[assetId] ?? assetId.slice(0, 12);
    state.apply(addAudioTrackOp(activeComp(state), assetId, trackName, playhead));
  }

  // ── Delete asset ─────────────────────────────────────────────────────────

  function deleteAsset(assetId: string) {
    const state  = store.getState();
    const comp   = activeComp(state);
    const tracks = (comp as unknown as { audioTracks?: AudioTrack[] }).audioTracks ?? [];

    // Remove any timeline tracks using this asset first
    for (const t of tracks) {
      if (t.assetId === assetId) state.apply(removeAudioTrackOp(comp, t.id));
    }

    // Remove from project.assets — same API as MediaPalette's handleRemove
    state.removeAsset(assetId as unknown as import("core").Id);

    // Clean up object URL and local state
    const asset = audioAssets.find((a) => a.id === assetId);
    if (asset?.master?.startsWith("blob:")) URL.revokeObjectURL(asset.master);
    setDurations((p) => { const n = { ...p }; delete n[assetId]; return n; });
    setFileSizes((p)  => { const n = { ...p }; delete n[assetId]; return n; });
    setSynced((p) => { const n = new Set(p); n.delete(assetId); return n; });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="audio-upload-panel">
      <div className="audio-upload-panel__header">
        <Music size={13} />
        <span>Audio</span>
        {audioAssets.length > 0 && (
          <span className="audio-upload-panel__count">{audioAssets.length}</span>
        )}
      </div>

      {error && <div className="audio-upload-panel__error">{error}</div>}

      {/* Drop zone */}
      <div
        className={`audio-dropzone${dragging ? " audio-dropzone--active" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
        aria-label="Upload audio files"
      >
        <Upload size={18} />
        <span className="audio-dropzone__label">
          Drop audio here<br />
          <span className="audio-dropzone__hint">or click to browse</span>
        </span>
        <span className="audio-dropzone__formats">MP3 · WAV · AAC · OGG · FLAC · M4A</span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.aac,.ogg,.flac,.m4a"
        multiple
        style={{ display: "none" }}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {/* Asset list */}
      {audioAssets.length > 0 && (
        <div className="audio-asset-list">
          {audioAssets.map((asset) => {
            const isLoading  = loading.has(asset.id);
            const inTimeline = trackAssetIds.has(asset.id);
            const duration   = durations[asset.id];
            const size       = fileSizes[asset.id];

            return (
              <div key={asset.id} className="audio-asset-item">
                <div className="audio-asset-item__thumb">
                  {isLoading
                    ? <div className="audio-asset-item__spinner" />
                    : <div className="audio-asset-item__wave" title={synced.has(asset.id) ? "Real waveform (server-processed)" : "Placeholder — syncing with server…"} />
                  }
                </div>

                <div className="audio-asset-item__info">
                  <span className="audio-asset-item__name" title={names[asset.id] ?? asset.id}>
                    {names[asset.id] ?? asset.id.slice(0, 12)}
                  </span>
                  <span className="audio-asset-item__meta">
                    {isLoading ? "Decoding…" : duration !== undefined
                      ? <><Clock size={9} />&nbsp;{fmtDuration(duration)}</>
                      : null}
                    {size !== undefined && <>&nbsp;·&nbsp;{fmtSize(size)}</>}
                  </span>
                </div>

                <div className="audio-asset-item__actions">
                  <button
                    className={`audio-asset-btn${inTimeline ? " audio-asset-btn--added" : ""}`}
                    title={inTimeline ? "Add another instance" : "Add to timeline at playhead"}
                    onClick={() => addToTimeline(asset.id)}
                    disabled={isLoading}
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    className="audio-asset-btn audio-asset-btn--danger"
                    title="Remove audio asset"
                    onClick={() => deleteAsset(asset.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {audioAssets.length === 0 && (
        <p className="audio-upload-panel__empty">
          Upload a background track, voiceover, or sound effect.
        </p>
      )}
    </div>
  );
}
// apps/editor/src/components/audio-kinds.ts
//
// UI-only taxonomy for AudioTrack "types" — music · voiceover · sfx.
//
// The core `AudioTrack` model has NO type discriminator (an audio asset is
// just `kind:"audio"`), so — exactly like `inspector/effect-categories.ts`
// does for effects — this file resolves a track's UI kind in a
// forward-compatible order and owns the accent colour + icon + label for it.
// Nothing here changes playback or the data model; it is chrome only.
//
// Resolution order for `audioKindOf(track)`:
//   1. `track.category` if the model ever gains one (forward-compatible)
//   2. a keyword match on the track / asset name
//   3. fallback → "music"
//
// The three accents are picked as siblings of the teal UI accent (#35D6C1):
// one hue ramp at ~constant lightness/chroma so they read as a family, not a
// rainbow — same discipline as the effect category ramp.

import { Music, Mic, Activity } from "lucide-react";
import type { AudioTrack } from "core";

export type AudioKindId = "music" | "voiceover" | "sfx";

export interface AudioKindMeta {
  id: AudioKindId;
  label: string;
  /** Accent used for chip tint, clip fill, and waveform stroke. */
  color: string;
  icon: typeof Music;
}

export const AUDIO_KINDS: Record<AudioKindId, AudioKindMeta> = {
  music:     { id: "music",     label: "Music",     color: "#38c6d4", icon: Music },
  voiceover: { id: "voiceover", label: "Voiceover", color: "#a78bfa", icon: Mic },
  sfx:       { id: "sfx",       label: "SFX",       color: "#f0a44a", icon: Activity },
};

const KEYWORD_KIND: Array<[RegExp, AudioKindId]> = [
  [/\b(vo|voice|voiceover|narrat|dialog|dialogue|speech|vox)\b/i, "voiceover"],
  [/\b(sfx|whoosh|impact|hit|foley|swoosh|riser|boom|click|ui|transition|seagull|ambien|ambience|room tone)\b/i, "sfx"],
  [/\b(music|track|score|theme|beat|song|loop|bgm|underscore)\b/i, "music"],
];

type TrackLike = AudioTrack & { category?: AudioKindId };

/** Resolve a track's UI kind (see file header for the order). */
export function audioKindOf(track: TrackLike): AudioKindId {
  if (track.category && AUDIO_KINDS[track.category]) return track.category;
  const name = track.name ?? "";
  for (const [re, kind] of KEYWORD_KIND) {
    if (re.test(name)) return kind;
  }
  return "music";
}

export function audioKindMeta(track: TrackLike): AudioKindMeta {
  return AUDIO_KINDS[audioKindOf(track)];
}

/** Read the composition's audio tracks (top-level array, alongside `root`). */
export function getAudioTracks(comp: unknown): AudioTrack[] {
  return (comp as { audioTracks?: AudioTrack[] }).audioTracks ?? [];
}

/** Clip length in frames, honouring the optional `endFrame` (150f fallback). */
export function trackDurationFrames(track: AudioTrack): number {
  const end = track.endFrame ?? track.startFrame + 150;
  return Math.max(1, end - track.startFrame);
}

/**
 * Deterministic waveform envelope as an SVG `<polygon>` points string in a
 * `0 0 100 20` viewBox (use `preserveAspectRatio="none"` so it stretches to
 * the clip). Same `seed` → same shape, so a clip's waveform is stable across
 * re-renders. Purely decorative until real peak data is wired in — swapping
 * in decoded peaks later only changes this function, not the clip layout.
 */
export function buildWaveformPoints(seed: number, samples = 46): string {
  let r = (seed >>> 0) || 0x9e3779b9;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 100;
    const taper = Math.sin((i / (samples - 1)) * Math.PI); // fade the ends
    const amp = (1.6 + rnd() * 7.4) * (0.35 + 0.65 * taper);
    top.push(`${x.toFixed(1)},${(10 - amp).toFixed(1)}`);
    bot.unshift(`${x.toFixed(1)},${(10 + amp).toFixed(1)}`);
  }
  return top.concat(bot).join(" ");
}

/** Stable per-track seed for `buildWaveformPoints` (hash of the id). */
export function waveSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

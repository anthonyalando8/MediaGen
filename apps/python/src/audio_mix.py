"""
audio_mix.py  —  Music-ducking envelope computation (scene/3.0 phase 6b).

Computes WHERE and BY HOW MUCH the background-music track should duck under
narration, from timing `scene_export.py` already has (`word_times`, beat
durations) — so "background music should automatically duck while narration
is speaking" (design doc) becomes real gain-over-time data instead of a flat
volume layered underneath the voiceover.

This module computes the ENVELOPE only. It does not touch playback or
export — see docs/architecture/scene-3.0-schema.md's audio-model section for
exactly what's wired up vs. not. In short: the editor's `AudioTrack` type
today has a flat `volume` + `fadeIn`/`fadeOut`, no time-varying gain
keyframes, and the renderer/export pipeline has no gain-automation playback
path at all — building that is a real Web Audio (or export-mix) engine
feature, not a data-shape change, and is explicitly NOT attempted here.
`scene.json`'s `music_automation` array is additive: nothing reads it yet,
so shipping it changes zero bytes of current audio playback.
"""

from __future__ import annotations


def _narration_intervals_ms(beat_durations_ms: list[int], beat_word_times: list[list[dict]]) -> list[tuple[int, int]]:
    """Scene-global (not beat-relative) ms intervals where narration is
    actually speaking, one per beat that has word_times. Beats with no
    word_times (resolve_visuals-only fast paths, or a format that skipped
    caption alignment) contribute no interval — silence, not an error."""
    intervals: list[tuple[int, int]] = []
    cursor = 0
    for beat_ms, words in zip(beat_durations_ms, beat_word_times):
        if words:
            start = cursor + int(round(words[0]["start_s"] * 1000))
            end = cursor + int(round(words[-1]["end_s"] * 1000))
            if end > start:
                intervals.append((start, end))
        cursor += beat_ms
    return intervals


def _merge_intervals(intervals: list[tuple[int, int]], gap_ms: int) -> list[tuple[int, int]]:
    """Merge narration intervals that are within `gap_ms` of each other, so
    back-to-back beats (near-continuous narration, the common case) don't
    flicker the music back up to 0dB for a fraction of a second between
    them — only a genuine pause longer than the attack+release window
    recovers the music."""
    if not intervals:
        return []
    ordered = sorted(intervals)
    merged = [list(ordered[0])]
    for start, end in ordered[1:]:
        if start - merged[-1][1] <= gap_ms:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


def compute_ducking_envelope(
    beat_durations_ms: list[int],
    beat_word_times: list[list[dict]],
    amount_db: float = -14.0,
    attack_ms: int = 120,
    release_ms: int = 400,
    base_db: float = 0.0,
) -> list[dict]:
    """
    Returns gain keyframes `[{"at_ms": int, "gain_db": float}, ...]` in
    scene-global milliseconds (cumulative across every beat — music plays
    continuously across beat boundaries, unlike `word_times`, which is
    beat-relative). Starts and ends at `base_db`.

    Shape per narration interval: base_db (attack start) -> amount_db
    (narration start) -> [hold] -> amount_db (narration end) -> base_db
    (release end). Adjacent intervals closer together than attack+release
    are merged first (see `_merge_intervals`) so the envelope doesn't
    flicker between two beats spoken back-to-back.
    """
    total_ms = sum(beat_durations_ms)
    if total_ms <= 0:
        return [{"at_ms": 0, "gain_db": base_db}]

    raw = _narration_intervals_ms(beat_durations_ms, beat_word_times)
    merged = _merge_intervals(raw, gap_ms=attack_ms + release_ms)

    keyframes = [{"at_ms": 0, "gain_db": base_db}]
    for start, end in merged:
        attack_start = max(0, start - attack_ms)
        release_end = min(total_ms, end + release_ms)
        keyframes.append({"at_ms": attack_start, "gain_db": base_db})
        keyframes.append({"at_ms": min(start, total_ms), "gain_db": amount_db})
        keyframes.append({"at_ms": min(end, total_ms), "gain_db": amount_db})
        keyframes.append({"at_ms": release_end, "gain_db": base_db})
    keyframes.append({"at_ms": total_ms, "gain_db": base_db})

    # Chronological + de-duplicated (adjacent identical (at_ms, gain_db)
    # pairs happen at merge boundaries and would just be redundant keyframes).
    keyframes.sort(key=lambda k: k["at_ms"])
    deduped: list[dict] = []
    for k in keyframes:
        if deduped and deduped[-1]["at_ms"] == k["at_ms"] and deduped[-1]["gain_db"] == k["gain_db"]:
            continue
        deduped.append(k)
    return deduped

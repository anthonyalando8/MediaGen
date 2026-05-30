"""
timeline.py  —  The shared TIMING SPINE for the whole pipeline.

Built ONCE, after captions, BEFORE slides. Both consumers read it:
  • captions  — the global caption layer (director units) → captions.ass
  • slides     — per-beat, beat-RELATIVE word timing → scene motion sync

WHY THIS EXISTS
---------------------------------------------------------------------------
Scenes already get ACTUAL per-beat durations (main.py passes
beat_durations(beat_wavs) → render_slides). What they DON'T have is the
timing of individual spoken words inside each beat. Without it, the keyword
slam / emphasis pulse fire on script-estimated timing, drifting from the
voice. This module turns whisper's word timestamps into a single artifact
both the caption burn and the scene render consume, so everything is timed
to the SAME truth — the audio.

It does NOT re-run whisper. It reuses the transcript captions already wrote
(transcript.json) and the SAME caption_director (deterministic for a given
seed), so timeline.captions.units == exactly what captions.py renders.

LAYERS (two clocks, on purpose)
---------------------------------------------------------------------------
  beats[].words[].start_s   → BEAT-RELATIVE (0 = beat start). inject.js seeks
                              each beat in its own animation clock, so scene
                              word-sync must be beat-relative.
  captions.units[].…start_s → GLOBAL (one .ass over the whole video). ASS
                              needs absolute times.

Import path (their layout: src/timeline.py, src/captions/caption_director.py):
    from captions.caption_director import direct_transcript
"""

from __future__ import annotations
import json
import pathlib

from captions.caption_director import direct_transcript, _lower


SCHEMA_VERSION = 1


# ─────────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────────
def build_timeline(
    transcript: dict,
    script: dict,
    durations_s: list[float],
    cfg: dict,
    seed: int = 7,
) -> dict:
    """
    Produce the timeline manifest from the (already-computed) whisper
    transcript + the script + the per-beat audio durations.

    transcript  — the dict captions.py wrote to transcript.json
    script      — the script dict (beats with emotion/energy/pace/highlight/text)
    durations_s — actual per-beat audio durations (seconds), same list main.py
                  already passes to render_slides (1:1 with script["beats"])
    seed        — MUST match cfg.subs.seed so the caption layer is identical
                  to what captions.py renders.
    """
    # 1. Director: transcript → choreographed units (GLOBAL times). This is the
    #    caption layer AND our word→beat alignment in one pass.
    units = direct_transcript(transcript, script, seed=seed)

    fps = cfg.get("video", {}).get("fps", 30)

    # 2. Group units by beat so we can derive per-beat, beat-relative timing.
    by_beat: dict[int, list] = {}
    for u in units:
        by_beat.setdefault(u.beat_index, []).append(u)

    beats_out = []
    script_beats = script.get("beats", [])
    for bi, sbeat in enumerate(script_beats):
        bu = by_beat.get(bi, [])
        # beat's global start = first spoken word in the beat (audio-accurate).
        flat_words = [w for u in bu for w in u.words]
        if flat_words:
            beat_global_start = min(w.start for w in flat_words)
            beat_global_end = max(w.end for w in flat_words)
        else:
            beat_global_start = sum(durations_s[:bi]) if durations_s else 0.0
            beat_global_end = beat_global_start + (durations_s[bi] if bi < len(durations_s) else 0.0)

        rel_words = []
        emphasis = []
        for w in flat_words:
            rel_s = round(w.start - beat_global_start, 3)
            rel_e = round(w.end - beat_global_start, 3)
            entry = {"text": w.text, "start_s": rel_s, "end_s": rel_e, "tier": w.tier}
            rel_words.append(entry)
            if w.tier <= 2:          # tier 1 = hero/event, 2 = *emphasis*/highlight
                emphasis.append({"text": w.text, "start_s": rel_s, "end_s": rel_e, "tier": w.tier})

        beats_out.append({
            "beat_index":     bi,
            "scene":          sbeat.get("type", ""),
            "keyword":        sbeat.get("keyword", ""),
            "duration_ms":    int(round(durations_s[bi] * 1000)) if bi < len(durations_s) else None,
            "global_start_s": round(beat_global_start, 3),
            "global_end_s":   round(beat_global_end, 3),
            "words":          rel_words,      # BEAT-RELATIVE — for inject.js
            "emphasis":       emphasis,       # the words the scene should react to
        })

    # 3. Caption layer — GLOBAL times, exactly what captions.py will render.
    cap_units = []
    for u in units:
        cap_units.append({
            "mode":       u.mode,
            "beat_index": u.beat_index,
            "start_s":    round(u.start, 3),
            "end_s":      round(u.end, 3),
            "lines":      u.lines,
            "words": [
                {"text": w.text, "start_s": round(w.start, 3),
                 "end_s": round(w.end, 3), "tier": w.tier}
                for w in u.words
            ],
        })

    total = max((u.end for u in units), default=sum(durations_s) if durations_s else 0.0)

    return {
        "version":          SCHEMA_VERSION,
        "fps":              fps,
        "total_duration_s": round(total, 3),
        "seed":             seed,
        "beats":            beats_out,
        "captions":         {"units": cap_units},
    }


def write_timeline(timeline: dict, out_dir: pathlib.Path) -> pathlib.Path:
    path = pathlib.Path(out_dir) / "timeline.json"
    path.write_text(json.dumps(timeline, indent=2, ensure_ascii=False), encoding="utf-8")
    n_beats = len(timeline.get("beats", []))
    n_units = len(timeline.get("captions", {}).get("units", []))
    print(f"[timeline] ✓ timeline.json — {n_beats} beats, {n_units} caption units, "
          f"{timeline.get('total_duration_s')}s")
    return path


# ─────────────────────────────────────────────────────────────────────────────
# Consumer helper — called from visuals.py
# ─────────────────────────────────────────────────────────────────────────────
def attach_to_contracts(contracts: list, timeline: dict) -> None:
    """
    Merge each beat's timing layer INTO the scene contract (in place), so it
    rides into scene.json and is already present in window.__BEAT__ for the
    render-engine mapping phase. Matched by array order (contracts are built
    1:1 from script["beats"], same order as timeline["beats"]).

    Adds to each contract:
      word_times     : [{text, start_s, end_s, tier}]   (BEAT-RELATIVE seconds)
      emphasis_times : [{text, start_s, end_s, tier}]    (the react-to words)
    capture.js / inject.js will read these in the next phase to sync the
    keyword + emphasis to the actual voice. Harmless until then.
    """
    tl_beats = timeline.get("beats", [])
    for i, c in enumerate(contracts):
        if i < len(tl_beats):
            tb = tl_beats[i]
            c["word_times"] = tb["words"]
            c["emphasis_times"] = tb["emphasis"]
        else:
            c["word_times"] = []
            c["emphasis_times"] = []

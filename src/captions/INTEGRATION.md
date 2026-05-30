# Cinematic Caption Director — integration

Transforms captions from a word-karaoke transcript renderer into a phrase-based
cinematic typography layer. **The engine is not rewritten** — transcription,
styles, header, and the ffmpeg/libass path are unchanged. A new *director* layer
sits between the transcript and the ASS renderer.

## Files
| File | Role |
|---|---|
| `renderer/captions/caption_director.py` | **NEW.** Pure decision logic: phrase chunking, hero classification, choreography mode selection, emotion adaptation, timing/schedule. No ASS, no ffmpeg. |
| `renderer/captions/captions.py` | **Upgraded.** Keeps transcription + style palettes + header; replaces the flat per-word engine with a per-mode ASS renderer driven by the director. |
| `renderer/lab/caption-director.js` | JS twin of the director (keep in sync) — powers the Caption Lab. |
| `Caption Lab.html` + `renderer/lab/caption-lab.js` | Live preview/tuning tool. |

## Wiring
`captions.py` imports `caption_director`. Put both in the same package/dir, or
adjust the import (`from caption_director import direct_transcript`). The public
API is unchanged:

```python
generate_captions(wav_path, out_dir, cfg, script=script)
```

`script` is your existing script dict (with `beats[].emotion/energy/pace/
intensity/highlight_words/text`). The director reads those to adapt each phrase.
Optional: `cfg["subs"]["seed"]` (int) makes the mode variety reproducible.

## How it answers the 8 asks
1. **Phrase chunking** — `chunk_phrases()` breaks on end-punctuation, soft
   punctuation, pause gaps (emotion-tuned threshold), idea-pivot words
   (`until/but/because/and then…`), and max length/duration. No fixed word count.
2. **Hero words** — `classify_heroes()` tiers every word: 1 = event (absolutes
   like NEVER/NOTHING, numbers+time-units like "THREE YEARS", all-caps, two-word
   absolutes like "too late"), 2 = strong (your `*emphasis*` / `highlight_words`),
   3 = normal. Tier-1 words can trigger a hero event.
3. **Choreography** — 8 modes: standard, stacked, impact, hero, isolated,
   escalation, whisper, split. `choose_mode()` picks per phrase, weighted by the
   emotion profile + phrase shape, seeded for reproducible variety.
4. **Emotional adaptation** — `profile_for()` maps emotion→{pause threshold, max
   words, linger, active boost, hero budget, mode bias, snap}. energy scales
   emphasis amplitude; pace scales timing; intensity scales hero appetite.
5. **Rhythm** — `schedule()` adds lead-in (caption anticipates the word), holds
   (hero/isolated/impact linger past speech), and **visible pauses** (large gaps
   become empty frames instead of stretched captions).
6. **Visual variety** — per-mode sizes: hero ≈ 3.6× font, isolated ≈ 1.4×,
   escalation grows per word, whisper ≈ 0.78× and dim. Intentional, not random.
7. **Retention spikes** — hero mode: one event word fills the frame, replaces the
   normal flow, scale-punches in and holds. Budgeted (`heroBudget`) so it stays
   rare and strategic; spent budget downgrades to impact.
8. **Timing psychology** — important words get more screen time (tier-1 size +
   holds); pauses are shown; nothing is stretched across silence.

## ASS techniques used (all libass-native)
`\\pos` + `\\an` (per-mode anchor), `\\t(t1,t2,…)` animated scale, `\\fscx/\\fscy`
scale punch, `\\fad` fades, `\\1c` colour roles, `\\b`, `\\fs` per-word size. No
new dependencies.

## Tuning
Use **Caption Lab.html** — pick a sample line (or type your own with `*emphasis*`),
set emotion/energy/pace/intensity, and scrub. The right rail shows the phrase
breakdown with mode + hero tiers. The Lab runs the *same* director logic as the
Python, so what you tune there is what renders. When you change behaviour, edit
BOTH `caption_director.py` and `caption-director.js` (they are 1:1).

## Note on beat alignment
`direct_transcript()` aligns whisper words to script beats by sequential token
count (robust to small ASR differences), so each phrase inherits the right beat's
emotion. If you already store per-beat audio offsets, you can swap in a time-based
alignment in `direct_transcript()` without touching the rest.

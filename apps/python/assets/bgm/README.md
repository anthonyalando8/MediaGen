# Background music

Drop royalty-free instrumental tracks here (`.mp3` / `.wav` / `.m4a` /
`.ogg` / `.flac`) and generated videos will pick one up automatically —
`scene_export.py::_select_bgm()` reads this directory at generation time.
**This folder is empty by default and that's fine** — no files means no
background music, exactly like every generation before this feature
existed. Nothing here is required.

## Naming convention (selection by mood)

Every format's script generation already produces a `global.music_mood`
field. Name a file after a mood and it gets picked automatically whenever a
script lands on that mood:

```
tense.mp3
cinematic.mp3
ambient.mp3
dark.mp3
aggressive.mp3
suspense.mp3
minimal.mp3
emotional.mp3
playful.mp3
upbeat.mp3
```

(Matching is case-insensitive and by filename stem, so `Tense.wav` or
`tense.flac` both match `"tense"`.) You don't need all ten — only the moods
your formats actually generate matter, and `_normalise_schema` doesn't
constrain `music_mood` to this exact list (it's LLM-written free text), so
an exact match is a bonus, not a requirement.

**You don't need to name anything correctly to get started.** If no file's
name matches the script's mood, selection falls back to:
1. A file literally named `default.<ext>`, if present.
2. Otherwise, the first file alphabetically.

So dropping in ONE file — named anything — already gets background music
working for every generation.

## What this does and doesn't do yet

- Embedded into `scene.json` as a real audio asset, compiled into a real,
  **looped** `AudioTrack` spanning the whole video (so a 30-second music bed
  still covers a 5-minute `explainer_5min` generation).
- **Flat volume only** (`config.yaml`'s `video.bgm_volume`, default 0.10) —
  it does not yet duck under narration. The ducking math already exists
  (`audio_mix.py::compute_ducking_envelope`, riding along in `scene.json` as
  `music_automation`) but isn't wired to playback — `AudioTrack` has no
  time-varying gain concept to apply it through yet. See
  docs/architecture/phase5-6-longform-ingest-audio.md for the full story.
- No licensing/attribution handling — that's on you when you source tracks.
  Pick genuinely royalty-free sources (or your own recordings) for whatever
  you actually publish.

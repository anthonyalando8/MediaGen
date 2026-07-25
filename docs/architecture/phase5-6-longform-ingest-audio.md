# Phase 5 & 6 — long-form, content ingest, audio automation

> Status: **section hierarchy + 2 new format recipes + content ingest all
> shipped and tested with fixtures.** **Background music is now real** — an
> opt-in `assets/bgm/` folder (empty by default; drop your own royalty-free
> files in), embedded + compiled into a real looped `AudioTrack` at flat
> volume. Music-**ducking** (making that track duck under narration) is a
> separate, still-unfinished piece: the envelope is computed correctly, but
> nothing applies it to playback yet — see "What's explicitly NOT done"
> under Phase 6b. This doc complements
> [scene-3.0-schema.md](./scene-3.0-schema.md) (archetypes/layers) — read
> that first if you haven't; this doc doesn't repeat that material.

## Phase 5 — long-form (section hierarchy)

### The problem

A 5-30 minute script isn't a longer flat `beats[]` — it needs real
structure (intro / body sections / conclusion), and `formats.py`'s
`ValidationProfile` bounds (beats_min/max, total_words) only gate a single
flat list.

### The shim

`llm.py::_flatten_sections(data)` — a format's prompt MAY have the model
emit:

```jsonc
{
  "title": "...",
  "sections": [
    { "id": "intro", "pacing_arc": "build", "beats": [ ...same beat shape as every other format... ] },
    { "id": "why-it-happens", "pacing_arc": "steady", "beats": [ ... ] },
    { "id": "conclusion", "pacing_arc": "wind_down", "beats": [ ... ] }
  ]
}
```

instead of a flat top-level `beats[]`. `_flatten_sections` runs first thing
inside `_parse_json` (before `_normalise_schema`/`_validate`) and
concatenates every section's beats into ONE `data["beats"]`, stamping each
beat with `section_id`/`pacing_arc` from its section. Every downstream
consumer — `_normalise_schema`, `_validate`, `visuals.py`,
`scene_export.py` — keeps working off a flat beat list and never has to
know sections exist. `pacing_arc`/`section_id` ride into the beat contract
(`visuals.py::_build_beat_contracts`) as forward-compat metadata, same
pattern as `archetype` before phase 4 consumed it — **nothing reads them
yet**; a future pacing-aware composer pass could use `pacing_arc` to bias
shot length/intensity per section.

**Back-compat**: no `sections` key (every format before this existed) is a
complete no-op — `_flatten_sections` returns `data` untouched.

**Validation**: `_validate_basic`/`_validate_cinematic_variety` gate the
FLATTENED beat list's totals (beat count, word count, camera/pace variety).
There is no independent per-section gate yet (e.g. "each section must have
3-8 beats") — a section with 0 beats or a lopsided split still passes as
long as the *totals* land in the format's profile range. Documented as a
known limitation, not an oversight — building real per-section profiles is
more design surface than the first useful increment needed.

### New format recipes

Both are pure data — `formats.py` was already fully YAML-driven, so a new
format needs zero code changes:

- **`explainer_1min`** — landscape, 8-16 flat beats, calmer pacing than
  `shortform_tiktok` (no manufactured hook-tension, "explain plainly").
  Opts into the phase-4 composer pass (`min_archetypes: 3`).
- **`explainer_5min`** — landscape, sections-based (intro/2-3 body/
  conclusion), 18-36 beats, 480-750 words. The first format to actually
  exercise the section mechanism above.

**Update — now verified against real generation.** Both formats were run
for real against the actual configured model (`gemma4:31b-cloud`):

- `explainer_1min`: succeeded on attempt 1, ~64s. 8 beats, 116 words (under
  the 170 cap). Composer correctly assigned `comparison` to the `truth` beat
  and `split_screen` to the `payoff` beat from the model's own real output.
- `explainer_5min`: **succeeded, but confirms the flagged risk was real.**
  Attempts 1 and 2 both failed with a JSON parse error (`Expecting ','
  delimiter` near the end of a ~14KB response — the model's very long
  structured output got truncated/malformed) and only attempt 3 — the last
  one in `generate_script`'s retry budget — succeeded. Total time across all
  3 attempts: 266s (4.4 minutes). The successful result was fully correct
  once parsed: 22 beats across 5 sections (`intro`, `partial-failures`,
  `clock-drift`, `observability-gap`, `conclusion`), 514 words (within the
  480-750 range), `section_id`/`pacing_arc` correctly flattened onto every
  beat, and the composer correctly assigned `comparison`/`split_screen` to
  real `truth`/`payoff` beats.

**Takeaway**: `explainer_5min` works, but is meaningfully less reliable than
every other format — it used its *entire* retry budget on this run. If it
had failed a 3rd time, `generate_script` raises and the whole request
fails. Before relying on this format in production, consider raising
`generate_script`'s retry count for long-form specifically, or (a more
robust fix) generating section-by-section with separate Ollama calls
instead of asking for the whole 20-35-beat structure in one response —
untried here, flagged as the natural next step if reliability matters more
than a single-call implementation.

## Phase 6a — content ingest

### Design choice: no new LLM call, no prompt changes

`apps/python/src/ingest.py::normalize_source(raw, kind)` is a **deterministic,
offline, rule-based** extraction pass — not a second Ollama call. It
produces a `SourceBrief`:

```python
SourceBrief(title, key_points, quotes, stats, word_count, suggested_format, brief_text)
```

`brief_text` is a condensed, organized text block (title + key points +
notable figures + notable quotes). The integration choice that keeps this
change small: **`brief_text` IS the `topic`** handed to the existing
`generate_script(topic, fmt, model)` — no format's `prompt.txt` needed to
change, no new field in the script JSON schema. A format's prompt already
says `TOPIC: "{topic}"`; it now sometimes receives a richer multi-line brief
there instead of a short phrase, and handles it fine (LLMs are robust to a
longer, well-structured topic block).

Preserve-meaning discipline: nothing here invents content. Key points are
literal first-sentences pulled from paragraphs/sections, quotes are literal
quoted spans (regex + markdown blockquotes), stats are literal
number-bearing sentences (regex for `%`, `$`, `million/billion/thousand`,
and time units). Restructuring, not fabrication — the actual "intelligently
rewrite into video-ready narration" step stays `generate_script` itself.

### Per-kind normalizers

| `kind` | Behavior |
|---|---|
| `"markdown"` | Splits by heading (`#`/`##`/...); one-to-few key points per section (first sentence of every paragraph under that heading, capped). `>` blockquotes + regex-detected quotes. |
| `"plain_text"` | A short first paragraph (≤12 words, doc has more than one paragraph) is treated as a title; first sentence of each remaining paragraph becomes a key point. |
| `"script"` | A user-written script is assumed close to video-ready already — each non-empty LINE becomes a key point verbatim (not summarized to a first-sentence), so the writer's own pacing survives into the brief. |
| PDF | `extract_pdf_text()` (requires `pypdf`, added to requirements.txt) extracts text, then normalized as `"plain_text"`. Extraction quality (paragraph/heading fidelity) depends on the source PDF's own internal structure — a known, expected limitation of any PDF text extractor, not something this module tries to fix. |

`suggested_format` is a word-count heuristic (`_suggest_format`): ≤180 words
→ `shortform_tiktok`, ≤900 → `explainer_1min`, else → `explainer_5min`.

### Wiring

- **`server.py`**: `GenerateRequest` gains `source_text`/`source_kind`/
  `source_pdf_base64` (all optional — omitting them is the existing
  `topic`-only path, byte-for-byte). `format` changed from a hardcoded
  default to `None` so ingest can supply `suggested_format` instead when the
  caller doesn't override it — `req.format or brief.suggested_format or
  DEFAULT_FORMAT` preserves the exact old behavior when no source/format is
  given. `_ingest_source(req)` does the base64-decode/extraction/
  normalization and turns failures into clear 400s instead of a pipeline
  crash three steps later.
- **`main.py`**: new `--ingest <path>` flag. Extension-based kind detection
  (`.md`/`.markdown` → markdown, `.pdf` → extract+normalize, anything else →
  `"script"` — a bare `.txt` someone wrote by hand is more usefully treated
  as their own draft script than summarized away). `--format` still wins if
  explicitly given; otherwise uses the brief's suggestion.
- **`apps/editor` UI** (added in a later pass — originally this was
  server/CLI-only, unreachable from the editor): `AISceneModal.tsx` gained a
  **Topic / Your own content** mode toggle. Content mode shows a textarea
  (paste an article/blog/markdown/your own script, with a kind dropdown) or
  an **Upload a file** button (`.txt`/`.md`/`.markdown`/`.pdf` — PDFs are
  read client-side as an `ArrayBuffer` and base64-encoded via a
  chunked-`String.fromCharCode` helper so a multi-MB file doesn't blow the
  call stack; text files are read as text and their kind is guessed from the
  extension, editable afterward in the same textarea). The format picker
  gains an **Auto** chip, shown and selected by default in content mode —
  selecting it omits `format` from the request entirely so the server falls
  through to `brief.suggested_format`; picking any concrete format chip
  overrides it. `scene-generate.ts`'s `GenerateOptions`/`generateScene()`
  carries the new fields through to the same `/api/scene/generate` request
  body server.py already accepted — no backend change needed for this half.

### Verified

Fixtures (no Ollama, no server round-trip needed for the extraction logic
itself) covering all three text kinds, the brief_text shape, PDF extraction
against a REAL generated PDF (via `pypdf`, using a temporary `reportlab`
install purely to author the test fixture — not a project dependency), and
both `server.py`'s `_ingest_source` and `main.py`'s `--ingest` parsing/file
loading end to end (including the base64 PDF path through the actual
Pydantic request model). Two regex bugs were found and fixed during this
testing: a `\b` boundary that silently never matched right after a literal
`%`, and a fixed-character-window stat snippet that dragged in unrelated
text/newlines — replaced with sentence-boundary extraction.

**UI**: `tsc --noEmit` clean. Live-browser-verified against the real editor
(Playwright, headless): pasting text and uploading a `.md` file both produce
the exact expected `/api/scene/generate` request body (`source_text` +
`source_kind`, `topic` empty, `format` omitted while Auto is selected); the
format picker was screenshotted against the REAL running server.py and
correctly lists all 5 formats (including `explainer_1min`/`explainer_5min`)
with no hardcoded list on the client. One real bug was caught by this live
test, not by any fixture: `run()`'s `useCallback` dependency array was
missing `inputMode`/`hasContent`/the new source state, so it held a STALE
closure from the initial (topic-mode) render — clicking Generate in content
mode silently no-op'd (the stale closure re-checked `inputMode === "topic"`
against emptied `topic`, failed the guard, returned). Fixed by adding the
missing dependencies. This is exactly the kind of bug unit tests / typecheck
cannot catch (the code is perfectly well-typed and would unit-test fine in
isolation) — only exercising the actual mounted component through real
interaction surfaces it.

## Phase 6b — audio automation (ducking envelope)

### What's shipped

`apps/python/src/audio_mix.py::compute_ducking_envelope(beat_durations_ms,
beat_word_times, amount_db, attack_ms, release_ms)` computes WHERE and BY
HOW MUCH the background-music track should duck under narration, from
timing `scene_export.py` already has. Returns gain keyframes in
scene-global milliseconds:

```jsonc
[{ "at_ms": 0,    "gain_db": 0 },
 { "at_ms": 180,  "gain_db": 0 },     // attack window before narration starts
 { "at_ms": 300,  "gain_db": -14 },   // ducked — narration speaking
 { "at_ms": 900,  "gain_db": -14 },
 { "at_ms": 1300, "gain_db": 0 },     // recovered after release window
 ...]
```

Adjacent narration intervals closer together than `attack_ms + release_ms`
are merged before emitting keyframes, so two beats spoken back-to-back (the
common case — beats have no silence gap between them) don't flicker the
music back up to 0dB for a fraction of a second between them; only a
genuine pause recovers it. `scene_export.py::build_scene` computes this
whenever a `timeline` is provided (i.e. whenever `word_times` exist) and
attaches it as `scene["music_automation"]` — **additive**: omitted entirely
when no timeline is given, so nothing about existing output changes.

### Background music (added in a later pass — closes a real gap)

The first version of this doc undersold the gap here: `media.orientation`-
style, `music_automation` wasn't just unwired from playback, there was **no
music track at all** anywhere in the scene.json pipeline. `config.yaml`
still had `paths.bgm`/`video.bgm_volume` keys, but nothing read them — the
only reference to `bgm_volume` anywhere in the codebase was inside a stale
compiled `.pyc` for an `assemble.py` module that doesn't exist in source
anymore (the old Playwright+ffmpeg pipeline's BGM mixer, never ported when
the scene.json/editor pipeline replaced it).

Fixed — but **entirely opt-in on real audio files that don't ship in this
repo** (can't generate music; this needs you to drop files in):

- `apps/python/assets/bgm/` — empty by default, with a `README.md`
  documenting the convention. `scene_export.py::_select_bgm(bgm_dir, mood)`
  picks a file by exact `<mood>.<ext>` match against the script's
  `global.music_mood` (case-insensitive stem match), falling back to
  `default.<ext>`, falling back to the first file alphabetically — so even
  ONE file, named anything, gets background music working.
- The picked file is embedded as a real `data:` audio asset and
  `scene.json` gets a top-level `bgm: { asset_id, volume }` field
  (`volume` from `config.yaml`'s `video.bgm_volume`, default 0.10).
- `scene-import.ts::compileSceneToProject` compiles `scene.bgm` into a real
  `AudioTrack` — `loop: true`, spanning `[0, totalFrames]` (the WHOLE
  composition, not just one beat), on its own lane (1) separate from the
  per-beat VO tracks (lane 0) so they don't visually collide in the
  timeline. **Flat volume only** — see below for why it doesn't duck yet.
- Fully back-compat: no files in `assets/bgm/` (today's actual state) →
  `_select_bgm` returns `None` → no `bgm` asset, no `scene.bgm` field, no
  AudioTrack — byte-for-byte the same output as every generation before
  this shipped.

### What's explicitly NOT done

The editor's `AudioTrack` type (`packages/core`) has a flat `volume` +
`fadeIn`/`fadeOut` today — no time-varying gain keyframes at all, on any
track kind. Neither the playback engine (Viewport's RAF loop) nor the
export pipeline has ANY audio-gain-automation concept to sample from.
Making `music_automation` actually duck the (now real) background-music
track requires:

1. A gain-channel concept on `AudioTrack` (or a dedicated automation node) —
   a `core` package type change plus evaluator support to sample it per
   frame, mirroring how `Channel<V>` already samples transform/prop
   keyframes but for audio gain during playback.
2. Real-time gain application during preview playback (Web Audio
   `GainNode.gain.linearRampToValueAtTime`, scheduled from the sampled
   envelope) — a genuinely different code path from the visual RAF/canvas
   loop, since audio scheduling needs to be sample-accurate, not
   frame-tick-accurate.
3. The equivalent in the export/render pipeline, wherever the final audio
   mixdown happens.

This is real audio-engine work, not a data-shape change — the same
distinction Step A vs. Step B was for `scene/3.0`'s layers. This doc ships
the "Step A" half (the envelope, provably correct and additive) and is
explicit that the "Step B" half (making it audible) is a separate, larger
task for a future pass.

Also out of scope, per the original design doc's audio model but not
attempted here at all (no computation, no schema): scene transition sound
effects, per-beat "preserve the clip's own original audio" tracks, and
ambient-sound layering. The design doc's example shape for these
(`{"track":"sfx","src":...,"at_ms":...}`, `{"track":"original","beat":N}`)
doesn't need computation the way ducking does — it's a composer/format
decision, not a timing-derived envelope — so it's a smaller follow-up than
the ducking work, not a harder one.

### Verified

**Ducking envelope**: fixtures covering a single beat's narration window
ducking and recovering correctly around attack/release padding, back-to-back
beats merging into one continuous ducked window (no flicker), a genuine
pause between beats recovering to 0dB, silent beats (no `word_times`)
producing a flat envelope, and an empty scene not crashing. Confirmed
additive via `scene_export.py`: `music_automation` is present when a
timeline is passed, absent entirely otherwise — no existing scene.json
output changes shape.

**Background music**: `_select_bgm` tested with a synthesized placeholder
tone (numpy/soundfile — already project dependencies, no new one added;
the tone lived in a temp dir, never committed) covering exact mood match,
fallback to `default.<ext>`, and the fully-back-compat no-directory case
(no `bgm` key at all, matching every scene generated before this shipped).
TS-side compilation verified with 4 new vitest tests
(`scene-import-bgm.test.ts`): a real looped `AudioTrack` compiles from
`scene.bgm` with the right volume/loop/frame-span/lane, volume defaults to
0.1 when omitted, and — the back-compat case — no track at all when
`scene.bgm` is absent or points at a non-audio/missing asset id.

## What's still not done (from the original 6-phase doc)

- All 12/12 `scene/3.0` archetypes are now implemented (see
  scene-3.0-schema.md) — this list item from the earlier revision of this
  doc is resolved.
- `explainer_5min`'s reliability under retry pressure (see above) — works,
  but real generation exposed it needs either a bigger retry budget or a
  section-by-section generation strategy to be production-reliable.
- Per-section validation profiles (beat/word bounds per section, not just
  totals).
- Audio automation Step B (making the ducking envelope audible — see above)
  and the sfx/original-track/ambient parts of the audio model entirely.
- A truly LLM-driven composer pass (`assign_composition` is still the
  deterministic affinity table from phase 4, not a model reasoning over
  actual beat content).

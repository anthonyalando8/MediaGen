# scene/3.0 — beat → archetype + layers

> Status: **shipped end-to-end for all 12/12 registry archetypes** — schema,
> Python-side layer synthesis + multi-asset resolution, `scene-import.ts`/
> renderer support, and a deterministic composer pass that assigns them.
> Verified live in the running editor with hand-built fixtures covering
> every archetype AND against a REAL end-to-end generation (real Ollama
> script → real composer assignment → real Pixabay stock resolution → real
> Kokoro TTS → real Whisper word-sync → real scene.json, imported and
> screenshotted) — see "Verification" below. Also fixed along the way: a
> pre-existing
> bug where full-bleed background layers (every archetype, including the
> original `text_over_dimmed`) letterboxed instead of true cover-fill
> whenever the resolved photo's aspect didn't exactly match the frame — see
> "The letterbox fix" below.

## Why

`scene/2.0`'s beat is a flat, styled template: one `visual_query` (→ one
background), text always present, a single cinematic vocabulary
(`camera`/`pace`/`layout`/`background`/...) applied uniformly. It can't
express split-screen, a beat with no text, a scrim that disappears once its
text has been read, or a typographic quote card. `scene/3.0` adds two fields
on top of the existing beat contract — `archetype` and `layers[]` — that
describe a beat as a *composition*, not a template fill.

Every existing beat field (`keyword`, `body`, `layout`, `camera`, `pace`,
`background`, `visual_query`, `word_times`, `emphasis_times`, `audio`,
`visual`, ...) **stays**. `layers`/`archetype` are additive.
`text_over_dimmed` (the default) still renders through the exact original
flat-field compiler (`buildBeatGroup` in `scene-import.ts`) — untouched, not
reimplemented — so every format generated before this existed renders
byte-for-byte identically forever.

## Beat shape (additions only)

```jsonc
{
  // ...every scene/2.0 field, unchanged...

  "archetype": "split_screen",       // composition family — see registry below
  "layers": [                         // ordered; render bottom → top
    {
      "role": "background", "slot": "top",
      "source": { "query": "server room night" },
      "asset_id": "img_3", "kind": "image",   // filled in by scene_export.py's resolution loop
      "fit": "cover", "in": 0, "out": null
    },
    {
      "role": "foreground", "slot": "bottom",
      "source": { "query": "server room night" },
      "asset_id": "img_3_1", "kind": "image", // SAME query, DIFFERENT asset — see "dedup" below
      "fit": "cover", "in": 0, "out": null
    }
  ]
}
```

- `role` ∈ `background | foreground | scrim | text | shape | icon | overlay | lower_third`
- `slot` (background/foreground layers) ∈ `left | right | top | bottom | pip`
  — a fractional sub-region of the frame instead of full-bleed. Absent = full
  frame. `pip` is a fixed bottom-right inset (~38% width), not a half-split.
  Implemented via `imageBox()`'s `boxX/boxY/boxW/boxH` override
  (`packages/nodekinds/src/image.ts` — see "Renderer" below).
- `shape` (role `"shape"` layers) — currently only `"divider"`: a thin
  accent-colored bar rendered exactly at the boundary between two
  slotted panels (`comparison`). Orientation is inferred from the OTHER
  layers' `slot` values in the same beat (`splitAxis()` in
  `scene-import.ts`), not stored on the divider layer itself.
- `reveal` (text layers) ∈ `slide | fade | typewriter | mask | carousel | kinetic`
  — only `fade`/`slide`/`mask`/`typewriter` are actually assigned today
  (`_REVEAL_BY_PACE`); the rest are vocabulary reserved for future formats.
- `size` (text layers) ∈ `hero | normal` — a font-scale hint (`title_card`/
  `stat_callout`'s big figure use `"hero"`, everything else defaults to
  `quote_card`'s original size). `anchor_y` — vertical center as a fraction
  of frame height (default 0.5); lets two text layers on one beat
  (`stat_callout`'s figure + label) stack without overlapping.
- `in`/`out` are **beat-relative milliseconds** (matches `word_times[].start_s`
  ×1000). `out: null` means "runs to the end of the beat."
- `asset_id`/`kind`/`_source_url` on background/foreground layers are filled
  in by `scene_export.py` after resolving `source.query` against stock
  providers — absent until then (a layer synthesizer never sets these).
  `source.kind: "video"` is a per-layer resolve-mode override
  (`full_bleed_video`) — forces a real clip regardless of the format's own
  `media.mode`.

## Archetype registry

Defined in `apps/python/src/llm.py` as `_ALLOWED_ARCHETYPES` — all 12 have a
layer synthesizer (`scene_export.py`), renderer support
(`scene-import.ts`'s `buildBeatGroupFromLayers`), and are composer-pass
candidates (`_ARCHETYPE_TYPE_AFFINITY`):

```
text_over_dimmed ✅   full_bleed_video ✅   bare_visual ✅     split_screen ✅
pip ✅                quote_card ✅         stat_callout ✅    comparison ✅
broll_montage ✅      title_card ✅         kinetic_type ✅    lower_third ✅
```

- **`broll_montage`** — 3-5 SEQUENTIAL (not simultaneous) full-bleed cuts of
  related footage under one narration line. Needed zero new renderer work:
  several `background`-role layers with disjoint (non-overlapping) `in`/
  `out` windows time-gate independently through the exact same per-layer
  mechanism that makes `split_screen`'s SIMULTANEOUS layers work — just
  without the overlap. All cuts share one query; the existing dedup
  guarantees each lands a different asset. Cut count (3/4/5) scales with
  beat duration.
- **`kinetic_type`** — animated typography, no imagery, using the beat's
  spoken `body` (not just `keyword`). New `reveal: "kinetic"` value dispatches
  to `scene-import.ts`'s `kineticTextNodes` — same line-wrapping as
  `layerTextNodes`, but each line pops in on its own staggered beat with a
  scale bounce instead of all lines fading in together.
- **`lower_third`** — full-bleed photo/video with a broadcast-style
  chyron: left-aligned label text over a semi-transparent bar confined to a
  band near the bottom (not a full-frame scrim), via the `lower_third` role
  (declared in the vocabulary from the start, unused until now) and
  `scene-import.ts`'s `lowerThirdNodes`.

Adding a 13th archetype = add its name to `_ALLOWED_ARCHETYPES`, then a `_synthesize_<name>_layers()` in
`scene_export.py` + register it in `_ARCHETYPE_SYNTHESIZERS` + (if it needs
new visual treatment) a branch in `scene-import.ts`'s
`buildBeatGroupFromLayers` + add it to `_ARCHETYPE_TYPE_AFFINITY` in `llm.py`
if the composer should be able to pick it. **Never branch on archetype in
the pipeline orchestration itself** — same rule as `formats.py`.

## Where each piece lives

| Stage | File | What it does |
|---|---|---|
| Script normalise | `llm.py::_normalise_schema` | `beat.setdefault("archetype", "text_over_dimmed")`, validated against `_ALLOWED_ARCHETYPES`. Runs immediately after the LLM call — no durations/timing yet, so it only stamps a default. |
| **Composer pass** | `llm.py::assign_composition` | Deterministic "cut-list": overrides a handful of beats' archetype based on rhetorical `type` (`_ARCHETYPE_TYPE_AFFINITY` — priority order `comparison → split_screen → pip → title_card → full_bleed_video → bare_visual → stat_callout → quote_card`), enforces `variety.min_archetypes`/`max_consecutive_archetype` from the format's `ValidationProfile` in code (not left to a prompt). No-ops entirely unless a format sets `variety.min_archetypes` — `shortform_tiktok` (3 archetypes, ≤2 consecutive) and `listicle` (2 archetypes, ≤3 consecutive — looser, matching its existing camera/layout gates) opt in; `calm_narrative` deliberately doesn't. Called from `generate_script`, after `_parse_json`, before `_validate`. |
| Beat contract | `visuals.py::_build_beat_contracts` | Passes `archetype` through onto the contract, same passthrough pattern as every other cinematic field. |
| Layer synthesis | `scene_export.py::_synthesize_layers` | Runs **after** `attach_to_contracts` (so `word_times`/`duration_ms` exist) and **before** visual resolution. Dispatches on `archetype` via `_ARCHETYPE_SYNTHESIZERS`; a beat that already carries `layers` (a future upstream composer could emit them directly) is left alone. `comparison` reuses `_synthesize_split_screen_layers` and appends a `shape`/`divider` layer; `pip` is a full-bleed background + a `slot:"pip"` foreground; `full_bleed_video` is `bare_visual` + a `source.kind:"video"` resolve-mode override; `title_card` is a dimmed photo + hero `keyword` text (not `body` — it names the section, doesn't caption narration); `stat_callout` is a generated background + hero `keyword` + normal-size `body` stacked via `anchor_y`. |
| Multi-asset resolution | `scene_export.py::build_scene` | Resolves every background/foreground layer's `source.query` (not just a single `visual_query`) against stock providers, sharing ONE `used_visuals` exclude set across the whole scene AND within a beat — so `split_screen`/`comparison`/`pip`'s two panels, even with the identical query, always resolve to two *different* candidates. Honors a layer's `source.kind:"video"` as a per-layer mode override (`full_bleed_video`), independent of the format's own `media.mode`. The first resolved visual layer also mirrors into the legacy `beat.visual` field for back-compat. Deliberately does NOT copy the resolved photo's width/height onto the asset — see "The letterbox fix" below. |
| Renderer/compiler | `apps/editor/src/persistence/scene-import.ts::buildBeatGroupFromLayers` | Compiles `layers[]` into nodes: background/foreground → `mediaNode` (with `slot` → a `boxX/Y/W/H` region override), `scrim` → a shape node with an opacity fade-in/hold/fade-out keyed to the layer's own `in`/`out`, `text` → centered wrapped text via `layerTextNodes` (whole lines, not word-synced — a composed statement, not a caption; `size`/`anchor_y` control font scale and vertical placement so `stat_callout`'s two text layers don't overlap), `shape`/`divider` → a thin accent bar at the split boundary (`dividerNode`, oriented via `splitAxis()` reading the OTHER layers' `slot`s). Dispatch: `archetype !== "text_over_dimmed" && layers.length > 0` takes this path; everything else (including every beat generated before archetypes existed) keeps calling the original `buildBeatGroup`. |
| Renderer primitive | `packages/nodekinds/src/image.ts::imageBox` | New: `node.props.boxX/boxY/boxW/boxH` (fractions of frame) let an image/video node claim a sub-region instead of the full comp — this is what makes `split_screen`/`comparison`'s cleanly-cropped panels and `pip`'s inset possible. Absent (every pre-existing node) → unchanged full-frame/asset-aspect behavior. |

## The letterbox fix

While verifying `pip` live, a full-bleed background layer rendered with
visible black bars instead of true edge-to-edge cover-fill — the resolved
photo's aspect didn't exactly match the frame, and it was letterboxed
instead of cropped. Root cause, and confirmed **pre-existing** (present
in the original code before scene/3.0, via `git diff`/`git stash`, not
introduced by any archetype work): `scene_export.py` and `server.py`'s
`/api/scene/reroll` both copied the downloaded photo's real `width`/`height`
onto its asset entry whenever PIL could read them (almost always, for a real
photo). `imageBox()` (`packages/nodekinds/src/image.ts`) contain-fits a
node's box to KNOWN asset dims before `fit` is applied — so `fit: "cover"`
had nothing left to crop; the box itself was already letterboxed to the
photo's native aspect. `mediaNode`'s own doc comment in `scene-import.ts`
already documented the INTENDED behavior ("dimensions intentionally omitted
upstream ... fills the frame, letterbox-free") — the implementation had
just drifted from it. Fix: stop copying width/height onto background/
foreground visual assets in both `scene_export.py` (both resolution
branches) and `server.py`'s reroll endpoint. This improves every beat's
background across every format, not just the new archetypes — verified via
before/after screenshots of the SAME `text_over_dimmed` fixture beat.
Layers with a `slot` (already box-overridden) were never affected — the box
override in `imageBox()` short-circuits before the asset-dims path runs.

## Back-compat guarantee

- `text_over_dimmed` never goes through `buildBeatGroupFromLayers` — it's
  excluded from the dispatch condition by name, not by accident of having no
  layers. Its `layers[]` (synthesized for schema completeness/forward-compat)
  is present in scene.json but structurally inert for rendering purposes.
- Layer synthesizers read only fields that already exist on the contract —
  they invent nothing.
- `assign_composition` is opt-in per format (`variety.min_archetypes`) —
  `calm_narrative` doesn't set it, so every beat it produces stays
  `text_over_dimmed`, unchanged from before this shipped.
- For formats that DO opt in (`shortform_tiktok`, `listicle`), only the
  `archetype` field and downstream `layers[]` differ from before — every
  other contract field (`hud_tag`/`keyword`/`body`/`layout`/`camera`/
  `visual`/`word_times`/...) is computed exactly as before, and a beat left
  on `text_over_dimmed` (still the majority in both formats) renders through
  the untouched legacy path regardless of how it got assigned.

## Verification

- `packages/nodekinds/src/image.test.ts` — `imageBox()` back-compat (no
  box props → unchanged) and the new box-override behavior.
- Python fixtures (no Ollama/TTS/network — `resolve_visual`/download
  functions mocked) covering: `_normalise_schema` archetype defaulting,
  `assign_composition`'s format opt-in / anti-repetition / affinity
  matching, and `scene_export.py`'s full visual-resolution loop for all 12
  archetypes, including split_screen/comparison/pip's within-beat dedup,
  full_bleed_video's forced-video-mode resolve, and broll_montage's
  contiguous non-overlapping cut windows with distinct assets per cut.
- Live verification (hand-built fixtures): `apps/editor` dev server +
  fixture `scene.json`s covering all 12 archetypes, imported through the
  actual File ▸ Import Scene flow and screenshotted. Confirmed every
  archetype's distinct visual signature — `text_over_dimmed` identical to
  the pre-existing look (now genuinely full-bleed post-letterbox-fix),
  `bare_visual`/`full_bleed_video` show only the background, `quote_card`/
  `kinetic_type` show typographic text with no photo (kinetic_type's lines
  visibly staggered/bounced vs. quote_card's calm single fade), `title_card`
  shows big centered `keyword` over a dimmed photo, `stat_callout` shows a
  hero figure stacked above its label with no overlap, `split_screen`/
  `comparison` show two cleanly-cropped panels (comparison additionally
  shows the divider bar at the boundary), `pip` shows a correctly-inset
  corner overlay, `broll_montage` visibly cuts between distinct clips within
  one beat as the playhead moves through it, `lower_third` shows a
  broadcast-style chyron bar. Zero console errors across every fixture.
- **Live verification (real generation)**: one full real run —
  `generate_script` against the actual configured Ollama cloud model
  (`gemma4:31b-cloud`), through real `assign_composition`, real Kokoro TTS,
  real Whisper word-alignment, real Pixabay image/video resolution, into a
  real `scene.json` — imported into the running editor and screenshotted.
  The composer assigned real archetypes to real beats based on the model's
  own `type` output (`truth`→`comparison`, `climax`→`pip`), `title_card`
  rendered with a genuinely resolved STOCK VIDEO background (not just an
  image — the first live confirmation `source.kind:"video"` actually works
  through the full pipeline), `pip` rendered with two distinct real photos
  correctly inset with no letterboxing, and `text_over_dimmed` showed real
  Whisper-aligned word-by-word caption highlighting. Zero console errors on
  a real, non-trivial (3.3MB, embedded video+images+audio) scene.

## What's NOT done yet

- **LLM-driven composer**: `assign_composition` is a deterministic
  type→archetype affinity table, not a second Ollama call reasoning over the
  actual beat text. It satisfies the "anti-repetition enforced in code"
  requirement either way, so upgrading it later to consult a real model (or
  simply widening the affinity table) doesn't change the enforcement
  guarantee.
- **`calm_narrative` composer opt-in**: deliberately left off —
  it explicitly wants a steady/repeating look (`variety: {}` already opts it
  out of the *existing* camera/pace variety gates, so archetype
  diversification following the same convention is correct, not an
  oversight). `listicle` now opts in too (`min_archetypes: 2,
  max_consecutive_archetype: 3` — looser than shortform_tiktok's 3/2, same
  "items can share a look" philosophy as its existing camera/layout gates),
  using its own `truth`/`payoff` beat types for split_screen/quote_card
  affinity.
- **Audio model** (`beat.audio[]` ducking/sfx/original-track array from the
  design doc) is out of scope here — reserved for phase 6.
- **Section hierarchy / long-form formats** (phase 5) and **content ingest**
  (phase 6) are untouched.

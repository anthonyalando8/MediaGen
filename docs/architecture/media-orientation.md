# Media orientation — portrait / landscape / square

> Status: shipped, but **there is no UI control for this** — it's driven
> entirely by which **format** you pick, not a separate setting. See "How
> you actually use it" below. A real gap was found and fixed while
> answering a question about this feature — see "The composition-size bug"
> below.

## What it is

`formats.py`'s `MediaPlan.orientation` (`"portrait"` | `"landscape"` |
`"square"`) is a per-**format** setting (`media.orientation` in a
`format.yaml`), not a per-generation choice. It controls two things:

1. **Which stock media gets requested** (`media_resolve.py`) — Pexels/
   Unsplash/Pixabay all get the matching orientation parameter, and
   candidate scoring rewards photos whose aspect ratio is close to the
   target instead of always preferring portrait.
2. **The scene's actual canvas size** (`scene_export.py`) — see below; this
   half was missing until today.

Today, only two formats set it away from the default:
`explainer_1min`/`explainer_5min` both set `media.orientation: landscape`.
Every other format (`shortform_tiktok`, `listicle`, `calm_narrative`)
doesn't set it at all, which defaults to `"portrait"` — unchanged from
before this feature existed.

## How you actually use it

**Pick a format.** That's it — there's no separate orientation toggle in
`AISceneModal.tsx`. The format picker chip you select determines
orientation as a side effect:

| Pick this format | You get |
|---|---|
| Short-form (TikTok/Reels), Listicle, Calm narrative | Portrait (1080×1920) |
| Explainer (1 minute), Explainer (5 minutes, sectioned) | Landscape (1920×1080) |

If you want a NEW format to be landscape (or square), add
`media: { orientation: landscape }` to its `format.yaml` — see
`explainer_1min/format.yaml` for the exact shape. No code change needed;
`formats.py` is fully YAML-driven.

A dedicated UI control (a Portrait/Landscape/Square toggle independent of
format) doesn't exist. It would be a reasonable follow-up if you want to,
say, generate the SAME format in both orientations — ask if you want it
built.

## The composition-size bug (found and fixed)

Until now, `media.orientation` only did half its job. It correctly steered
which stock photos got *requested*, but the scene's actual **canvas**
(`scene.json`'s top-level `width`/`height` — what the editor's Composition
panel shows as "Frame Size", and what every beat's visuals actually get
cropped into) came straight from `config.yaml`'s global `video.width`/
`video.height` (1080×1920), **regardless of format**. In practice this
meant `explainer_1min`/`explainer_5min` fetched genuinely landscape photos
and then cover-cropped them hard into a portrait frame — the opposite of
the intent, and a materially worse result than just leaving them portrait
in the first place.

**Fix**: `scene_export.py::_composition_size(cfg, orientation)` — treats
`config.yaml`'s `video.width`/`video.height` as the **portrait baseline**
(that's what they've always meant), and derives the actual canvas from the
format's orientation:

- `"portrait"` (the default) → unchanged, byte-for-byte (`width`, `height`
  exactly as `config.yaml` says).
- `"landscape"` → swapped (`height`, `width`).
- `"square"` → the shorter side, both dimensions.

Verified via fixture (`build_scene()` called with `MediaPlan(orientation=
"portrait")` and `MediaPlan(orientation="landscape")`): portrait output is
unchanged at 1080×1920; landscape output is now correctly 1920×1080.
`shortform_tiktok`/`listicle`/`calm_narrative` are completely unaffected by
this fix (they never set `media.orientation`, so `_composition_size`
returns `config.yaml`'s values unchanged — the same code path as before
this function existed).

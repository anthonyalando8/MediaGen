"""
media_resolve.py  —  Stock visual resolution (v2: scored, filtered, +video).

capture.js used to fetch a background image per beat (Pexels → Unsplash →
Pixabay) at render time. In the editor pipeline there is no Playwright render
step, so resolution moves here: the scene builder calls `resolve_visual()`
per beat and embeds the result in scene.json, giving the editor one
self-contained document.

v1 → v2 (fix-plan §05, "stop fetching star-shaped clip-art")
--------------------------------------------------------------------------
v1 took the FIRST provider's FIRST result (Pexels → Unsplash → Pixabay,
falling through only on a zero-hit response) — no scoring, no comparison, no
illustration filter beyond Pixabay's own `image_type=photo` param. v2:

  1. Fetches up to 8 candidates from EVERY provider that has a key (not just
     the first one that returns anything).
  2. Scores every candidate together — term overlap between the (mood-
     enriched) query and the candidate's title/alt/tags, a portrait-
     orientation bonus, and (when `allow_illustration=False`) an
     illustration/vector/clipart keyword exclusion — and returns the best.
  3. Adds video candidates (Pexels + Pixabay video search) for `media.mode`
     "video"/"hybrid", so kinetic beats can pull a real clip instead of a
     static photo.

Keys are read from the environment (or apps/python/.env), same names as
capture.js: PEXELS_API_KEY, UNSPLASH_API_KEY, PIXABAY_API_KEY.

Stdlib only (urllib) — no new dependency. `download_as_data_url()` /
`download_video_as_data_url()` fetch the bytes and return a `data:` URL so
the media travels INSIDE scene.json and renders in the editor with no
CORS/tainting risk (a plain hosted URL can fail WebGL texture upload if the
CDN omits CORS headers). Video clips are capped at MAX_VIDEO_BYTES — a
single beat's embedded clip can balloon scene.json fast; oversized
candidates are skipped in favor of falling back to an image.
"""

from __future__ import annotations
import io
import os
import re
import json
import base64
import pathlib
import urllib.parse
import urllib.request

TIMEOUT_S = 6
MAX_VIDEO_BYTES = 6 * 1024 * 1024  # ~6MB cap per embedded clip (data: URL tradeoff)


# ── .env loader (shell env wins) ────────────────────────────────────────────

def _load_env() -> dict:
    env = dict(os.environ)
    dotenv = pathlib.Path(__file__).parent.parent / ".env"
    if dotenv.exists():
        for line in dotenv.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in env:
                env[k] = v
    return env


_ENV = _load_env()
_PEXELS   = _ENV.get("PEXELS_API_KEY", "")
_UNSPLASH = _ENV.get("UNSPLASH_API_KEY", "")
_PIXABAY  = _ENV.get("PIXABAY_API_KEY", "")


def _get_json(url: str, headers: dict | None = None) -> dict | None:
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            if r.status != 200:
                return None
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


# ── Scoring ──────────────────────────────────────────────────────────────────

_ILLUSTRATION_HINTS = {"illustration", "vector", "clipart", "clip-art", "icon", "cartoon", "drawing", "graphic"}

# Delivery aspect ratio (width/height) each format's `media.orientation` maps
# to. Unknown/missing orientation falls back to portrait — the pre-existing
# behavior, so any format that doesn't opt in is unaffected.
_TARGET_AR = {"portrait": 9 / 16, "landscape": 16 / 9, "square": 1.0}


def _tokens(s: str) -> set:
    return set(re.findall(r"[a-z0-9]+", (s or "").lower()))


def _score_candidate(query_tokens: set, text: str, tags: str, width, height, allow_illustration: bool, target_ar: float = 9 / 16,
                      duration_ms: int | None = None, min_duration_ms: int | None = None):
    """Term-overlap score in [0, ~1.25]. Returns None to exclude the candidate
    outright (illustration hint present and allow_illustration is False)."""
    cand_tokens = _tokens(text) | _tokens(tags)
    if not allow_illustration and (cand_tokens & _ILLUSTRATION_HINTS):
        return None
    score = len(query_tokens & cand_tokens) / max(1, len(query_tokens))
    if width and height:
        # Distance to the DELIVERY aspect, not a flat "portrait is good"
        # bonus — an exact match to target_ar scores the same +0.15 the old
        # flat portrait bonus gave (back-compat for the default portrait
        # target), tapering to a mild penalty the further off-aspect a
        # candidate is.
        ar = width / height
        score += 0.15 - min(0.3, abs(ar - target_ar) * 0.5)
    if min_duration_ms and duration_ms is not None:
        # Video only (image candidates never carry duration_ms, so this is a
        # no-op for images). A clip shorter than the window it needs to fill
        # freezes on its last frame while narration keeps playing — prefer a
        # clip that covers the window; penalize (not exclude — a decent
        # match that's a bit short still beats no visual at all) the ones
        # that don't, proportional to how much of the window they'd miss.
        if duration_ms >= min_duration_ms:
            score += 0.1
        else:
            shortfall = (min_duration_ms - duration_ms) / min_duration_ms
            score -= min(0.25, shortfall * 0.25)
    return score


def _best_candidate(candidates: list, q_tokens: set, allow_illustration: bool, target_ar: float = 9 / 16, exclude: set | None = None,
                     min_duration_ms: int | None = None):
    best, best_score = None, -1.0
    for c in candidates:
        # Skip anything already used — by provider asset id (stable across
        # size/crop variants of the same photo) or, failing that, by exact
        # URL (a prior reroll, or a provider with no id).
        if exclude and (c.get("id") in exclude or c.get("url") in exclude):
            continue
        score = _score_candidate(q_tokens, c.get("text", ""), c.get("tags", ""), c.get("width"), c.get("height"), allow_illustration, target_ar,
                                  duration_ms=c.get("duration_ms"), min_duration_ms=min_duration_ms)
        if score is None:
            continue
        if score > best_score:
            best, best_score = c, score
    return best, best_score


# ── Per-provider candidate fetch (image) ────────────────────────────────────

# orientation ("portrait"|"landscape"|"square") → each provider's own query
# vocabulary. Missing/unknown orientation falls back to portrait everywhere,
# reproducing the pre-existing hardcoded behavior.
_PEXELS_ORIENT = {"portrait": "portrait", "landscape": "landscape", "square": "square"}
_UNSPLASH_ORIENT = {"portrait": "portrait", "landscape": "landscape", "square": "squarish"}
_PIXABAY_ORIENT = {"portrait": "vertical", "landscape": "horizontal", "square": "all"}


def _pexels_image_candidates(q: str, orientation: str = "portrait") -> list:
    if not _PEXELS:
        return []
    orient = _PEXELS_ORIENT.get(orientation, "portrait")
    u = ("https://api.pexels.com/v1/search?query=" + urllib.parse.quote(q)
         + f"&orientation={orient}&per_page=8&size=medium")
    data = _get_json(u, {"Authorization": _PEXELS})
    out = []
    for p in (data or {}).get("photos", []) or []:
        src = p.get("src", {}) or {}
        # Pexels pre-crops each photo per orientation under matching src keys
        # — use the one that matches what we asked for, not always "portrait".
        url = src.get(orient) or src.get("large2x") or src.get("large")
        if not url:
            continue
        out.append({"url": url, "id": f"pexels:{p.get('id')}", "text": p.get("alt", ""), "tags": "",
                    "width": p.get("width"), "height": p.get("height"), "source": "Pexels"})
    return out


def _unsplash_image_candidates(q: str, orientation: str = "portrait") -> list:
    if not _UNSPLASH:
        return []
    orient = _UNSPLASH_ORIENT.get(orientation, "portrait")
    u = ("https://api.unsplash.com/search/photos?query=" + urllib.parse.quote(q)
         + f"&orientation={orient}&content_filter=high&per_page=8&order_by=relevant&client_id={_UNSPLASH}")
    data = _get_json(u, {"Accept-Version": "v1"})
    out = []
    for r in (data or {}).get("results", []) or []:
        urls = r.get("urls", {}) or {}
        url = urls.get("regular")
        if not url:
            continue
        tags = " ".join(t.get("title", "") for t in (r.get("tags") or []) if isinstance(t, dict))
        out.append({"url": url, "id": f"unsplash:{r.get('id')}", "text": r.get("alt_description") or r.get("description") or "", "tags": tags,
                    "width": r.get("width"), "height": r.get("height"), "source": "Unsplash"})
    return out


def _pixabay_image_candidates(q: str, orientation: str = "portrait") -> list:
    if not _PIXABAY:
        return []
    orient = _PIXABAY_ORIENT.get(orientation, "vertical")
    u = ("https://pixabay.com/api/?key=" + urllib.parse.quote(_PIXABAY)
         + "&q=" + urllib.parse.quote(q)
         + f"&image_type=photo&orientation={orient}&safesearch=true&per_page=8&order=relevant")
    data = _get_json(u)
    out = []
    for h in (data or {}).get("hits", []) or []:
        url = h.get("webformatURL") or h.get("largeImageURL")
        if not url:
            continue
        out.append({"url": url, "id": f"pixabay:{h.get('id')}", "text": h.get("tags", ""), "tags": h.get("tags", ""),
                    "width": h.get("webformatWidth"), "height": h.get("webformatHeight"), "source": "Pixabay"})
    return out


_IMAGE_PROVIDERS = (_pexels_image_candidates, _unsplash_image_candidates, _pixabay_image_candidates)


def _best_image_candidate(query: str, mood: list, allow_illustration: bool, orientation: str = "portrait",
                           target_ar: float = 9 / 16, exclude: set | None = None) -> dict | None:
    full_q = " ".join([query, *mood]).strip()
    q_tokens = _tokens(full_q)

    candidates = []
    for fn in _IMAGE_PROVIDERS:
        candidates.extend(fn(full_q, orientation))
    if not candidates:
        # One-retry fallback on the bare subject — mirrors the legacy
        # per-provider retry, now applied once across all providers.
        subject = " ".join(query.split()[:2])
        if subject and subject != full_q:
            for fn in _IMAGE_PROVIDERS:
                candidates.extend(fn(subject, orientation))

    best, best_score = _best_candidate(candidates, q_tokens, allow_illustration, target_ar, exclude)
    if best is None:
        return None
    print(f"[media] {best['source']} ✓ (score={best_score:.2f}) \"{full_q}\"")
    return {"kind": "image", "url": best["url"], "id": best.get("id"),
            "relevance": round(min(1.0, max(0.0, best_score)), 2), "query": full_q}


# ── Per-provider candidate fetch (video) ────────────────────────────────────

def _pexels_video_candidates(q: str, orientation: str = "portrait") -> list:
    if not _PEXELS:
        return []
    orient = _PEXELS_ORIENT.get(orientation, "portrait")
    u = ("https://api.pexels.com/videos/search?query=" + urllib.parse.quote(q)
         + f"&orientation={orient}&per_page=8")
    data = _get_json(u, {"Authorization": _PEXELS})
    out = []
    for v in (data or {}).get("videos", []) or []:
        files = sorted(
            (f for f in (v.get("video_files") or []) if f.get("link") and f.get("width", 0) >= 480),
            key=lambda f: f.get("width", 0),
        )
        if not files:
            continue
        f = files[0]  # smallest file that still meets the floor — keeps the embed small
        out.append({"url": f["link"], "id": f"pexels_video:{v.get('id')}", "text": "", "tags": "",
                    "width": f.get("width"), "height": f.get("height"),
                    "duration_ms": int((v.get("duration") or 0) * 1000), "source": "Pexels"})
    return out


def _pixabay_video_candidates(q: str, orientation: str = "portrait") -> list:
    # Pixabay's video search API has no orientation param — target_ar-aware
    # scoring in _best_candidate still prefers the best-fit clip returned.
    if not _PIXABAY:
        return []
    u = ("https://pixabay.com/api/videos/?key=" + urllib.parse.quote(_PIXABAY)
         + "&q=" + urllib.parse.quote(q) + "&per_page=8")
    data = _get_json(u)
    out = []
    for h in (data or {}).get("hits", []) or []:
        videos = h.get("videos", {}) or {}
        # "tiny" first, not "small" — real-world check showed "small" clips
        # routinely exceed MAX_VIDEO_BYTES and get rejected/skipped downstream,
        # falling back to an image. Smallest-first actually lands a video.
        v = videos.get("tiny") or videos.get("small") or videos.get("medium")
        if not v or not v.get("url"):
            continue
        out.append({"url": v["url"], "id": f"pixabay_video:{h.get('id')}", "text": h.get("tags", ""), "tags": h.get("tags", ""),
                    "width": v.get("width"), "height": v.get("height"),
                    "duration_ms": int((h.get("duration") or 0) * 1000), "source": "Pixabay"})
    return out


_VIDEO_PROVIDERS = (_pexels_video_candidates, _pixabay_video_candidates)

# Stock video search returns full-length clips (routinely 1-3+ minutes) —
# beats only run a few seconds, so a long clip is both wasted bandwidth and
# near-guaranteed to blow the MAX_VIDEO_BYTES cap even at the smallest
# resolution. Filtering by duration BEFORE scoring avoids a doomed download.
_MAX_VIDEO_DURATION_MS = 30_000


def _best_video_candidate(query: str, mood: list, allow_illustration: bool, orientation: str = "portrait",
                           target_ar: float = 9 / 16, exclude: set | None = None, min_duration_ms: int | None = None) -> dict | None:
    full_q = " ".join([query, *mood]).strip()
    q_tokens = _tokens(full_q)

    candidates = []
    for fn in _VIDEO_PROVIDERS:
        candidates.extend(fn(full_q, orientation))
    candidates = [c for c in candidates if c.get("duration_ms", 0) <= _MAX_VIDEO_DURATION_MS]

    best, best_score = _best_candidate(candidates, q_tokens, allow_illustration, target_ar, exclude, min_duration_ms=min_duration_ms)
    if best is None:
        return None
    print(f"[media] {best['source']} video ✓ (score={best_score:.2f}) \"{full_q}\"")
    return {"kind": "video", "url": best["url"], "id": best.get("id"),
            "relevance": round(min(1.0, max(0.0, best_score)), 2),
            "query": full_q, "duration_ms": best.get("duration_ms", 0)}


# ── Public resolve ───────────────────────────────────────────────────────────

_MOTION_PACES = {"fast", "explosive"}


def resolve_visual(
    query: str,
    mood: list | None = None,
    mode: str = "auto",
    allow_illustration: bool = True,
    pace: str = "",
    exclude: set | None = None,
    orientation: str = "portrait",
    min_duration_ms: int | None = None,
) -> dict | None:
    """
    Resolve `query` to a visual — scored across every provider that has a
    key, instead of the first hit from the first provider.

    mode:
      "image"   — image providers only (today's behaviour).
      "video"   — video providers first; falls back to image if no video
                  candidate scores (a query with no good clip shouldn't
                  leave the beat with no visual at all).
      "hybrid"  — video for beats whose `pace` is fast/explosive, image
                  otherwise (reuses the beat's existing `pace` field).
      "auto"    — image only. This is the default for any format that
                  doesn't set `media.mode`, so it reproduces the exact
                  pre-v2 output shape (image, never video) unless a format
                  opts in.
    `exclude` — provider asset ids and/or URLs to skip (already shown to the
                user via a prior reroll, or already used by an earlier beat
                in the same scene — see scene_export.py's per-scene `used` set).
    `orientation` — "portrait" (default, back-compat) | "landscape" | "square".
                    Threaded to each provider's own orientation query param
                    and into scoring as the delivery aspect target.
    `min_duration_ms` — video only (ignored for image candidates, which have
                    no duration). The ms window this visual needs to cover;
                    biases selection toward clips that don't run out before
                    it, so the visual doesn't freeze on its last frame while
                    narration keeps playing. A soft preference, not a hard
                    filter — a too-short clip still beats no visual at all.

    Returns {"kind", "url", "id", "relevance", "query", "duration_ms"?} or None.
    """
    if not query:
        return None
    mood = mood or []
    target_ar = _TARGET_AR.get(orientation, _TARGET_AR["portrait"])

    want_video = mode == "video" or (mode == "hybrid" and pace in _MOTION_PACES)
    if want_video:
        result = _best_video_candidate(query, mood, allow_illustration, orientation, target_ar, exclude, min_duration_ms=min_duration_ms)
        if result:
            return result
        # No video candidate cleared the bar — fall through to image so the
        # beat still gets a visual.

    result = _best_image_candidate(query, mood, allow_illustration, orientation, target_ar, exclude)
    if result:
        return result
    print(f"[media] ✗ no visual for \"{query}\"")
    return None


def resolve_image(query: str) -> str | None:
    """Legacy image-only resolve — returns just the URL. Thin wrapper over
    resolve_visual() for any caller not yet updated."""
    result = resolve_visual(query, mode="image")
    return result["url"] if result else None


# ── Download + embed ─────────────────────────────────────────────────────────

def download_as_data_url(url: str) -> dict | None:
    """
    Fetch `url` and return { "url": data-URL, "width"?, "height"? }.
    Embedding as a data URL guarantees the editor can upload it as a WebGL
    texture (same-origin, never CORS-tainted). Returns None on failure.
    """
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MediaGen/1.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S * 3) as r:
            if r.status != 200:
                return None
            raw = r.read()
            mime = r.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
    except Exception:
        return None

    b64 = base64.b64encode(raw).decode("ascii")
    out = {"url": f"data:{mime};base64,{b64}"}

    # Best-effort native dimensions (optional — Pillow if installed).
    try:
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as im:
            out["width"], out["height"] = im.width, im.height
    except Exception:
        pass
    return out


def download_video_as_data_url(url: str) -> dict | None:
    """Like download_as_data_url but for video, with a byte-size cap — a
    single beat's clip embedded as base64 can balloon scene.json fast.
    Returns None (caller falls back to image) if the clip exceeds the cap."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MediaGen/1.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S * 5) as r:
            if r.status != 200:
                return None
            raw = r.read(MAX_VIDEO_BYTES + 1)
            if len(raw) > MAX_VIDEO_BYTES:
                print(f"[media] ✗ video candidate exceeds {MAX_VIDEO_BYTES // (1024 * 1024)}MB cap, skipping")
                return None
            mime = r.headers.get("Content-Type", "video/mp4").split(";")[0].strip()
    except Exception:
        return None
    b64 = base64.b64encode(raw).decode("ascii")
    return {"url": f"data:{mime};base64,{b64}"}

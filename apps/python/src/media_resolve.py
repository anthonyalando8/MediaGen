"""
media_resolve.py  —  Stock visual resolution, moved OUT of renderer/capture.js.

capture.js used to fetch a background image per beat (Pexels → Unsplash →
Pixabay) at render time. In the editor pipeline there is no Playwright render
step, so resolution moves here: the scene builder calls `resolve_image()` per
beat and embeds the result in scene.json, giving the editor one self-contained
document.

Ported faithfully from capture.js's `fetchMediaAsset` (image path):
  Pexels (portrait, medium) → Unsplash (portrait) → Pixabay (vertical),
  with a one-retry fallback on the first two subject words.

Keys are read from the environment (or apps/python/.env), same names as
capture.js: PEXELS_API_KEY, UNSPLASH_API_KEY, PIXABAY_API_KEY.

Stdlib only (urllib) — no new dependency. `download_as_data_url()` fetches the
bytes and returns a `data:` URL so the media travels INSIDE scene.json and
renders in the editor with no CORS/tainting risk (a plain hosted URL can fail
WebGL texture upload if the CDN omits CORS headers).
"""

from __future__ import annotations
import io
import os
import json
import base64
import pathlib
import urllib.parse
import urllib.request

TIMEOUT_S = 6


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


# ── Per-provider image search (mirrors capture.js) ──────────────────────────

def _pexels_image(q: str) -> str | None:
    if not _PEXELS:
        return None

    def search(sq: str) -> list:
        u = ("https://api.pexels.com/v1/search?query="
             + urllib.parse.quote(sq)
             + "&orientation=portrait&per_page=8&size=medium")
        data = _get_json(u, {"Authorization": _PEXELS})
        return (data or {}).get("photos", []) or []

    results = search(q)
    if not results:
        subject = " ".join(q.split()[:2])
        if subject != q:
            results = search(subject)
    if not results:
        return None
    src = results[0].get("src", {}) or {}
    return src.get("portrait") or src.get("large2x") or src.get("large")


def _unsplash_image(q: str) -> str | None:
    if not _UNSPLASH:
        return None

    def search(sq: str) -> list:
        u = ("https://api.unsplash.com/search/photos?query="
             + urllib.parse.quote(sq)
             + f"&orientation=portrait&content_filter=high&per_page=8&order_by=relevant&client_id={_UNSPLASH}")
        data = _get_json(u, {"Accept-Version": "v1"})
        return (data or {}).get("results", []) or []

    results = search(q)
    if not results:
        subject = " ".join(q.split()[:2])
        if subject != q:
            results = search(subject)
    if not results:
        return None
    urls = results[0].get("urls", {}) or {}
    return urls.get("regular")


def _pixabay_image(q: str) -> str | None:
    if not _PIXABAY:
        return None

    def search(sq: str) -> list:
        u = ("https://pixabay.com/api/?key=" + urllib.parse.quote(_PIXABAY)
             + "&q=" + urllib.parse.quote(sq)
             + "&image_type=photo&orientation=vertical&safesearch=true&per_page=8&order=relevant")
        data = _get_json(u)
        return (data or {}).get("hits", []) or []

    results = search(q)
    if not results:
        subject = " ".join(q.split()[:2])
        if subject != q:
            results = search(subject)
    if not results:
        return None
    hit = results[0]
    return hit.get("webformatURL") or hit.get("largeImageURL")


def resolve_image(query: str) -> str | None:
    """Resolve `query` to a stock image URL (Pexels → Unsplash → Pixabay)."""
    if not query:
        return None
    for fn, name in ((_pexels_image, "Pexels"), (_unsplash_image, "Unsplash"), (_pixabay_image, "Pixabay")):
        url = fn(query)
        if url:
            print(f"[media] {name} ✓ \"{query}\"")
            return url
    print(f"[media] ✗ no image for \"{query}\"")
    return None


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

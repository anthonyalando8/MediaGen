"""
ingest.py  —  Turn existing content (articles, blog posts, markdown, plain
text, PDFs, user-written scripts) into a script-generation input, instead of
requiring a bare topic phrase.

`normalize_source()` is deliberately NOT an LLM call: extraction (headings,
key points, quotes, stats) is fast, deterministic, and testable without
Ollama/network — a rule-based structuring pass, not a rewrite. The actual
"intelligently rewrite into video-ready narration" step is `generate_script`
itself (llm.py) — `normalize_source()`'s job is only to turn raw source
material into a well-organized BRIEF that becomes the `{topic}` a format's
existing prompt already knows how to consume. This is a deliberate
integration choice: it requires ZERO changes to any prompt.txt or to
`generate_script`'s signature — a brief is just a richer topic string.

Preserve-meaning discipline: nothing here invents content. Key points are
literal sentences pulled from the source (first sentence of each paragraph/
section), quotes are literal quoted spans, stats are literal number-bearing
phrases. Restructuring, not fabrication.
"""

from __future__ import annotations
import re
from dataclasses import dataclass, field


# ─────────────────────────────────────────────────────────────────────────────
# SourceBrief — the normalized output
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class SourceBrief:
    title: str
    key_points: list[str] = field(default_factory=list)
    quotes: list[str] = field(default_factory=list)
    stats: list[str] = field(default_factory=list)
    word_count: int = 0
    suggested_format: str = "shortform_tiktok"
    brief_text: str = ""   # feed this straight into generate_script(brief.brief_text, fmt, model)


# ─────────────────────────────────────────────────────────────────────────────
# Text structuring (kind-agnostic once we have plain text)
# ─────────────────────────────────────────────────────────────────────────────

_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")
_STAT_RE = re.compile(
    # "%" is punctuation, not \w — a trailing \b after it never matches
    # (no \w/\W transition), so that branch is its own alternative with no
    # trailing boundary, unlike the word-unit branches below.
    r"\b\d[\d,]*(?:\.\d+)?\s?%"
    r"|\b\d[\d,]*(?:\.\d+)?\s?(?:percent|x|times)\b"
    r"|\$\s?\d[\d,]*(?:\.\d+)?\s?(?:million|billion|thousand|k|m|b)?\b"
    r"|\b\d[\d,]*(?:\.\d+)?\s?(?:million|billion|thousand)\b"
    r"|\b\d[\d,]*(?:\.\d+)?[-\s]?"
    r"(?:second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\b",
    re.IGNORECASE,
)
_QUOTE_RE = re.compile(r"[“\"]([^“”\"]{15,300})[”\"]")
_MD_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
_MD_BLOCKQUOTE_RE = re.compile(r"^>\s?(.+)$", re.MULTILINE)


def _clean_line(s: str) -> str:
    """Collapse internal whitespace (line wraps inside a paragraph) to single
    spaces — a key point pulled from a wrapped paragraph shouldn't carry a
    stray newline into the brief."""
    return re.sub(r"\s+", " ", s).strip()


def _first_sentence(paragraph: str) -> str:
    parts = _SENTENCE_END_RE.split(paragraph.strip(), maxsplit=1)
    return _clean_line(parts[0]) if parts else _clean_line(paragraph)


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _detect_stats(text: str, limit: int = 8) -> list[str]:
    """Returns the whole SENTENCE containing each stat match — "73%" alone
    isn't a usable brief line, but "73% of workers report burnout" is. Using
    sentence boundaries (rather than a fixed character window either side)
    avoids truncating mid-word or dragging in the next unrelated sentence."""
    # Strip markdown heading markers and collapse paragraph whitespace so a
    # stat that happens to sit at a line wrap (or right after a heading)
    # doesn't drag "## Heading" or a stray newline into its sentence.
    flat = _MD_HEADING_RE.sub("", text)
    flat = re.sub(r"\s+", " ", flat).strip()
    sentences = re.split(r"(?<=[.!?])\s+", flat)
    seen, out = set(), []
    for sentence in sentences:
        if not _STAT_RE.search(sentence):
            continue
        clean = sentence.strip()
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
        if len(out) >= limit:
            break
    return out


def _detect_quotes(text: str, limit: int = 6) -> list[str]:
    quotes = [m.group(1).strip() for m in _QUOTE_RE.finditer(text)]
    # de-dupe, preserve order
    seen, out = set(), []
    for q in quotes:
        if q not in seen:
            seen.add(q)
            out.append(q)
        if len(out) >= limit:
            break
    return out


def _suggest_format(word_count: int) -> str:
    if word_count <= 180:
        return "shortform_tiktok"
    if word_count <= 900:
        return "explainer_1min"
    return "explainer_5min"


def _build_brief_text(title: str, key_points: list[str], quotes: list[str], stats: list[str]) -> str:
    lines = []
    if title:
        lines.append(f"Title: {title}")
    if key_points:
        lines.append("Key points:")
        lines.extend(f"- {p}" for p in key_points)
    if stats:
        lines.append("Notable figures:")
        lines.extend(f"- {s}" for s in stats)
    if quotes:
        lines.append("Notable quotes:")
        lines.extend(f'- "{q}"' for q in quotes)
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Per-kind normalization
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_markdown(raw: str) -> tuple[str, list[str], list[str]]:
    """Returns (title, key_points, quotes) using heading structure. Pulls the
    first sentence of EVERY paragraph within each section (capped per
    section), not just the section's first paragraph — a single-heading
    document with several paragraphs underneath it is common, and only ever
    surfacing paragraph 1 would silently drop the rest of its points."""
    headings = list(_MD_HEADING_RE.finditer(raw))
    title = headings[0].group(2).strip() if headings and headings[0].group(1) == "#" else ""

    key_points: list[str] = []
    if headings:
        for i, h in enumerate(headings):
            start = h.end()
            end = headings[i + 1].start() if i + 1 < len(headings) else len(raw)
            body = raw[start:end].strip()
            body = _MD_HEADING_RE.sub("", body).strip()
            for para in _paragraphs(body)[:3]:
                key_points.append(_first_sentence(para))
    else:
        key_points = [_first_sentence(p) for p in _paragraphs(raw)[:12]]

    quotes = [m.group(1).strip() for m in _MD_BLOCKQUOTE_RE.finditer(raw)]
    quotes += _detect_quotes(raw)
    return title, key_points[:16], quotes[:6]


def _normalize_plain_text(raw: str) -> tuple[str, list[str], list[str]]:
    paras = _paragraphs(raw)
    # A short first paragraph (< 12 words) reads like a title/headline; use
    # it as the title and don't ALSO count it as a key point.
    title = ""
    if paras and len(paras[0].split()) <= 12 and len(paras) > 1:
        title = paras[0].strip()
        paras = paras[1:]
    key_points = [_first_sentence(p) for p in paras[:12]]
    quotes = _detect_quotes(raw)
    return title, key_points, quotes


def _normalize_script(raw: str) -> tuple[str, list[str], list[str]]:
    """A user-written script is already close to video-ready narration —
    treat each non-empty line/paragraph as a beat-sized key point rather
    than compressing to first-sentences, so the writer's own pacing/wording
    survives into the brief instead of being summarized away."""
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    title = lines[0] if lines and len(lines[0].split()) <= 12 else ""
    body_lines = lines[1:] if title else lines
    return title, body_lines[:24], _detect_quotes(raw)


_NORMALIZERS = {
    "markdown": _normalize_markdown,
    "plain_text": _normalize_plain_text,
    "script": _normalize_script,
}


def normalize_source(raw: str, kind: str = "plain_text") -> SourceBrief:
    """
    Normalize `raw` source text of the given `kind` (`"markdown"` |
    `"plain_text"` | `"script"` | `"pdf"` — pdf is extracted to plain text
    first by `extract_pdf_text()`, then normalized as `"plain_text"`) into a
    `SourceBrief`. Deterministic, offline — see module docstring.
    """
    if not raw or not raw.strip():
        raise ValueError("normalize_source: empty source text")

    normalizer = _NORMALIZERS.get(kind, _normalize_plain_text)
    title, key_points, quotes = normalizer(raw)
    stats = _detect_stats(raw)
    word_count = len(raw.split())

    return SourceBrief(
        title=title,
        key_points=key_points,
        quotes=quotes,
        stats=stats,
        word_count=word_count,
        suggested_format=_suggest_format(word_count),
        brief_text=_build_brief_text(title, key_points, quotes, stats),
    )


# ─────────────────────────────────────────────────────────────────────────────
# PDF extraction (optional dependency — pypdf)
# ─────────────────────────────────────────────────────────────────────────────

def extract_pdf_text(path_or_bytes) -> str:
    """
    Extract plain text from a PDF (file path, Path, or raw bytes). Requires
    `pypdf` (see requirements.txt) — raises a clear, actionable error if it
    isn't installed rather than failing deep inside a stack trace.
    """
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise RuntimeError(
            "PDF ingest requires the 'pypdf' package. Install it with "
            "`pip install pypdf` (already listed in requirements.txt)."
        ) from e

    import io
    source = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, (bytes, bytearray)) else path_or_bytes
    reader = PdfReader(source)
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n\n".join(p.strip() for p in pages if p.strip())
    if not text.strip():
        raise ValueError("extract_pdf_text: no extractable text found (scanned/image-only PDF?)")
    return text


def normalize_pdf(path_or_bytes) -> SourceBrief:
    """Extract + normalize a PDF in one call."""
    return normalize_source(extract_pdf_text(path_or_bytes), kind="plain_text")

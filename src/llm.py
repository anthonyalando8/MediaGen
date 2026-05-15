"""
llm.py  —  Script generation via Ollama.

Calls the local Ollama CLI, parses the JSON response,
retries up to 3 times on bad output, validates beat structure.
"""

import subprocess
import pathlib
import json
import re
import sys


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def generate_script(topic: str, prompt_path: pathlib.Path, model: str) -> dict:
    """
    Generate a structured 5-beat script via Ollama.

    Returns a dict:
      {
        "title":   str,
        "keyword": str,
        "beats": [
          { "id": int, "keyword": str, "text": str, "hook": bool },
          ...  (5 items)
        ]
      }

    Raises RuntimeError after 3 failed attempts.
    """
    template = prompt_path.read_text(encoding="utf-8")
    prompt   = template.format(topic=topic)
    raw      = ""

    for attempt in range(1, 4):
        print(f"[llm] Generating script (attempt {attempt}/3)…")
        try:
            raw = subprocess.check_output(
                ["ollama", "run", model, prompt],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            data = _parse_json(raw.strip())
            _validate(data)
            print(f"[llm] ✓ Script OK — \"{data['title']}\"")
            return data
        except Exception as e:
            print(f"[llm]   ✗ attempt {attempt} failed: {e}", file=sys.stderr)

    raise RuntimeError(
        f"[llm] Could not get valid JSON from model after 3 attempts.\n"
        f"Last raw output (first 600 chars):\n{raw[:600]}"
    )


def spoken_text(script: dict) -> str:
    """Return all beat text joined for TTS (double-space = natural pause between beats)."""
    return "  ".join(b["text"].strip() for b in script["beats"])


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _strip_ansi(s: str) -> str:
    """Remove ANSI/VT100 escape sequences that Ollama CLI emits during streaming.
    Examples: ESC[3D  ESC[K  ESC[?25l  ESC[2J
    These are cursor-movement / erase codes used for the streaming animation.
    """
    # ESC[ ... final-byte  (CSI sequences — most common: [3D, [K, [?25l etc.)
    s = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", s)
    # ESC O ...  (SS3 sequences)
    s = re.sub(r"\x1b[O][A-Za-z]", "", s)
    # bare ESC + single char
    s = re.sub(r"\x1b.", "", s)
    return s


def _fix_duplicate_word_fragments(text: str) -> str:
    """
    Remove streaming artifacts left by Ollama after ANSI stripping.

    Ollama prints a partial word, rewinds with ANSI cursor codes, then prints
    the full word.  After stripping ANSI both copies remain:
        "s side projects"  ->  "side projects"
        "ideas ideas"      ->  "ideas"
        "inv invested"     ->  "invested"
        "no now."          ->  "now."   (trailing punctuation handled)

    Three passes:
      1. Exact word duplicates (case-insensitive).
      2. Word-by-word: drop token[i] when it is a strict alpha prefix of token[i+1].
         Trailing punctuation on token[i+1] is stripped for the comparison only.
      3. Collapse any double-spaces left by removals.
    """
    # Pass 1: exact case-insensitive duplicates  e.g. "ideas ideas" -> "ideas"
    text = re.sub(
        r"\b([A-Za-z\']{2,})\s+\1\b",
        lambda m: m.group(1),
        text,
        flags=re.IGNORECASE,
    )

    # Pass 2: prefix-fragment removal, word by word
    words = re.split(r'(\s+)', text)   # interleaved [word, space, word, space, ...]
    result = []
    i = 0
    while i < len(words):
        token = words[i]
        if i % 2 == 0 and token and i + 2 < len(words):
            next_token = words[i + 2]
            # strip trailing punctuation from next_token for comparison only
            next_alpha = re.sub(r"[^A-Za-z']+$", "", next_token)
            if (
                re.match(r"^[A-Za-z']+$", token)        # fragment is pure alpha
                and next_alpha                             # following word has alpha content
                and next_alpha.lower().startswith(token.lower())
                and len(token) < len(next_alpha)
            ):
                i += 2   # skip fragment + its trailing whitespace
                continue
        result.append(token)
        i += 1

    # Pass 3: collapse double-spaces left by removed fragments
    text = "".join(result)
    text = re.sub(r'  +', ' ', text)
    return text


def _fix_mojibake(text: str) -> str:
    """Fix UTF-8 characters that were misread as Latin-1 by Ollama output handling."""
    replacements = [
        ("â€“", "—"),  # â€" -> em-dash
        ("â€˜", "‘"),  # â€˜ -> left single quote
        ("â€™", "’"),  # â€™ -> right single quote
        ("â€œ", "“"),  # â€œ -> left double quote
        ("â€",       "”"),  # â€  -> right double quote
        ("â€¦", "…"),  # â€¦ -> ellipsis
    ]
    for bad, good in replacements:
        text = text.replace(bad, good)
    return text


def _clean_beat_texts(data: dict) -> dict:
    """Fix encoding artifacts and duplicate word fragments in all beat text fields."""
    for beat in data.get("beats", []):
        if "text" in beat:
            beat["text"] = _fix_mojibake(beat["text"])
            beat["text"] = _fix_duplicate_word_fragments(beat["text"])
    return data


def _normalise_schema(data: dict) -> dict:
    """
    Normalise old schema (id, hook: bool) to new schema (type, energy).
    Makes the pipeline robust regardless of which format the model returns.

    Old: { id, keyword, text, hook: bool }
    New: { type, keyword, text, energy }
    """
    beats = data.get("beats", [])
    total = len(beats)
    for i, beat in enumerate(beats):
        # derive "type" from hook bool or position if not already set
        if "type" not in beat:
            if beat.get("hook") is True or i == 0:
                beat["type"] = "hook"
            elif i == total - 1:
                beat["type"] = "cta"
            else:
                beat["type"] = "insight"
        # default energy from hook flag or position
        if "energy" not in beat:
            beat["energy"] = "high" if (beat.get("hook") or i == 0) else "mid"
        # clean up old fields — only remove integer 'id' (old schema);
        # preserve string beat ids like "beat_01" from the new schema.
        if isinstance(beat.get("id"), int):
            beat.pop("id")
        beat.pop("hook", None)
    # optional top-level fields
    data.setdefault("thumbnail", data.get("keyword", ""))
    data.setdefault("style", "analytical")
    return data


def _parse_json(raw: str) -> dict:
    """
    Clean the raw Ollama CLI output and parse JSON from it.

    Issues we handle:
      1. ANSI escape codes (cursor-move, erase) from streaming animation.
      2. Markdown code fences.
      3. Literal newlines / control chars inside JSON string values.
      4. Mid-word duplicate fragments left after ANSI stripping.
    """
    # 1. strip ANSI escape sequences first (must be before JSON extraction)
    cleaned = _strip_ansi(raw)

    # 2. strip markdown fences
    cleaned = re.sub(r"```(?:json)?", "", cleaned).strip()

    # 3. extract the first {...} block
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in model output")
    blob = match.group(0)

    # 4. sanitize remaining control characters inside string values
    blob = _sanitize_json_strings(blob)

    # 5. parse, fix artifacts, normalise schema
    data = json.loads(blob)
    data = _clean_beat_texts(data)
    data = _normalise_schema(data)
    return data


def _sanitize_json_strings(s: str) -> str:
    """
    Replace literal control characters (newline, tab, etc.) that appear
    inside JSON string values with a space.
    Leaves structural JSON whitespace outside quotes untouched.
    """
    result = []
    in_str = False
    escape = False

    for ch in s:
        if escape:
            result.append(ch)
            escape = False
            continue

        if ch == "\\" and in_str:
            result.append(ch)
            escape = True
            continue

        if ch == '"':
            in_str = not in_str
            result.append(ch)
            continue

        if in_str and ord(ch) < 0x20:
            result.append(" ")
            continue

        result.append(ch)

    return "".join(result)
def _validate(data: dict) -> None:
    """Accept both old (5-beat, hook bool) and new (4-8 beat, type field) schemas."""
    if "beats" not in data:
        raise KeyError("Missing key: 'beats'")
    if "title" not in data:
        raise KeyError("Missing key: 'title'")
    beats = data["beats"]
    if not isinstance(beats, list):
        raise ValueError("beats must be a list")
    if not (4 <= len(beats) <= 8):
        raise ValueError(f"Expected 4-8 beats, got {len(beats)}")
    for i, beat in enumerate(beats):
        for k in ("keyword", "text"):
            if k not in beat:
                raise KeyError(f"Beat {i} missing key: '{k}'")
        if not beat["text"].strip():
            raise ValueError(f"Beat {i} has empty text")
        # Per-beat word count: prompt requires 15-25 words per beat
        beat_words = len(beat["text"].split())
        if not (15 <= beat_words <= 30):
            raise ValueError(
                f"Beat {i} has {beat_words} words — must be 15-25 words per beat."
            )

    # Total word count gate: scales with beat count (15 words/beat minimum).
    # Target 90-130 words total to match the prompt spec.
    total_words = sum(len(b["text"].split()) for b in beats)
    min_words   = len(beats) * 15
    if total_words < min_words:
        raise ValueError(
            f"Script too short: {total_words} words across {len(beats)} beats "
            f"(minimum {min_words} at 15 words/beat). Beats are too short — model must expand them."
        )
    if total_words > 200:
        raise ValueError(
            f"Script too long: {total_words} words (maximum 200)."
        )
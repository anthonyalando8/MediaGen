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


def _clean_beat_texts(data: dict) -> dict:
    """Apply _fix_duplicate_word_fragments to all beat text fields."""
    for beat in data.get("beats", []):
        if "text" in beat:
            beat["text"] = _fix_duplicate_word_fragments(beat["text"])
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

    # 5. parse, then fix duplicate word fragments in beat texts
    data = json.loads(blob)
    return _clean_beat_texts(data)


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
    for key in ("title", "keyword", "beats"):
        if key not in data:
            raise KeyError(f"Missing key: '{key}'")
    beats = data["beats"]
    if not isinstance(beats, list) or len(beats) != 5:
        raise ValueError(f"Expected 5 beats, got {len(beats) if isinstance(beats, list) else type(beats)}")
    for beat in beats:
        for k in ("id", "keyword", "text"):
            if k not in beat:
                raise KeyError(f"Beat missing key: '{k}'")
        if not beat["text"].strip():
            raise ValueError(f"Beat {beat.get('id','?')} has empty text")
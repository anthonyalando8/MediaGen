import re

_COMMON_WORDS = {
    # Single char — real standalone words, never streaming fragments
    'a', 'i',
    # Two chars
    'an', 'am', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'hi', 'if',
    'in', 'is', 'it', 'me', 'my', 'no', 'of', 'oh', 'ok', 'on', 'or',
    'so', 'to', 'up', 'us', 'we',
    # Three chars — common words that are also prefixes of longer words
    'the', 'and', 'are', 'but', 'can', 'did', 'for', 'get', 'got', 'had',
    'has', 'her', 'him', 'his', 'how', 'its', 'let', 'may', 'not', 'now',
    'off', 'one', 'our', 'out', 'own', 'say', 'she', 'too', 'two', 'use',
    'via', 'was', 'who', 'why', 'yet', 'you',
}

def _fix_duplicate_word_fragments(text: str) -> str:
    """
    Remove streaming artifacts left by Ollama after ANSI stripping.

    Ollama occasionally emits incomplete token fragments immediately before
    their complete form, e.g.:
        "is t that"           → "is that"
        "art o of"            → "art of"
        "map. T They"         → "map. They"
        "*whis *whisper*"     → "*whisper*"
        "starte *started*"    → "*started*"
        "crippling crippling" → "crippling"

    Three removal rules, applied in order per adjacent word-token pair:

    Rule 1 — Exact duplicate (any length ≥ 2):
        token_alpha == next_alpha  (case-insensitive)
        Handles "word word", "*word *word*", "WORD word"

    Rule 2 — Short non-word prefix (length 1–2):
        token is 1–2 alpha chars AND is NOT a common English word
        AND next_alpha starts with token_alpha (case-insensitive)
        AND next_alpha is longer than token_alpha
        Catches "t that", "T They", "o of", "th the", "wh what"
        while preserving "a apple", "an answer", "to tomorrow", "he hello"

    Rule 3 — Longer prefix fragment (length 3+):
        token_alpha is 3+ pure-alpha chars
        AND next_alpha starts with token_alpha (case-insensitive)
        AND next_alpha is longer
        Catches "whis whisper", "starte started", "*phant *phantom*"
        Minimum 3 prevents false positives on common 1-2 char words.

    Runs in a loop until stable so chained fragments
    ("is t th that" → "is th that" → "is that") are fully resolved.
    """
    def _one_pass(text: str) -> str:
        tokens = re.split(r'(\s+)', text)
        result = []
        i = 0
        while i < len(tokens):
            if i % 2 == 0 and i + 2 < len(tokens):
                token      = tokens[i]
                next_token = tokens[i + 2]
                ta = re.sub(r"[^A-Za-z']", '', token)
                na = re.sub(r"[^A-Za-z']", '', next_token)
                ta_lo = ta.lower()
                na_lo = na.lower()

                # Rule 1: exact duplicate (≥ 2 chars each)
                if len(ta) >= 2 and len(na) >= 2 and ta_lo == na_lo:
                    i += 2
                    continue

                if len(ta) >= 1 and len(na) >= 2 and na_lo.startswith(ta_lo) and len(ta) < len(na):
                    # Rule 2: short non-word prefix (1–2 chars)
                    if len(ta) <= 2 and ta_lo not in _COMMON_WORDS:
                        i += 2
                        continue
                    # Rule 3: longer prefix fragment (3+ chars, pure alpha)
                    if len(ta) >= 3 and re.match(r"^[A-Za-z']+$", ta):
                        i += 2
                        continue

            result.append(tokens[i])
            i += 1
        return re.sub(r'  +', ' ', "".join(result))

    # Loop until stable — resolves chained fragments like "t th that"
    for _ in range(5):
        cleaned = _one_pass(text)
        if cleaned == text:
            break
        text = cleaned
    return text
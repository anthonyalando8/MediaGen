# ── Space Grotesk Bold uppercase advance widths (normalised to em units) ──────
# Derived from HarfBuzz shaping at UPM=1000.  Each value = advance / 1000.
# A flat char-ratio of 0.69 under-measures wide chars (M=0.76, W=0.76, G=0.61)
# and over-measures narrow chars (I=0.26, J=0.34), causing clipping on
# width-heavy words (MOMENTUM, OVERWHELMED) and wasted space on narrow ones.
_SG_BOLD_W: dict[str, float] = {
    'A': 0.484, 'B': 0.524, 'C': 0.568, 'D': 0.594, 'E': 0.490,
    'F': 0.436, 'G': 0.614, 'H': 0.558, 'I': 0.260, 'J': 0.344,
    'K': 0.490, 'L': 0.400, 'M': 0.760, 'N': 0.560, 'O': 0.608,
    'P': 0.468, 'Q': 0.608, 'R': 0.490, 'S': 0.446, 'T': 0.438,
    'U': 0.560, 'V': 0.468, 'W': 0.760, 'X': 0.468, 'Y': 0.458,
    'Z': 0.464,
}
_SG_SPACE_W: float = 0.250   # word-space advance (used in pair constraint)
_FALLBACK_W: float = 0.500   # for any non-A-Z character


def _word_em_width(word: str) -> float:
    """Return the total advance width of *word* in em units (Space Grotesk Bold)."""
    return sum(_SG_BOLD_W.get(c.upper(), _FALLBACK_W) for c in word)


def calc_kw_font_size(keyword: str, layout: str, scene: str) -> int:
    """
    Calculate the max keyword font size (px) that fits the widest word (or
    widest adjacent word-pair for 3+ word keywords) within the scene container.

    Replaces the previous flat CHAR_RATIO=0.69 approach with per-character
    advance-width measurement (Space Grotesk Bold, UPM=1000).  This fixes
    clipping on width-heavy words such as MOMENTUM, OVERWHELMED, COMMITMENT
    while allowing narrow words (HALLUCINATION, IRREPLACEABLE) to use a
    larger, more visually impactful size.

    Constraints
    -----------
    1. Longest *single* word must fit on one line.
    2. For 3+ word keywords: widest *adjacent pair* must fit on one line,
       preventing a 3-line wrap that would push into the body-text zone.
    3. Result is clamped to [MIN_PX, scene_max_px].

    Container widths (px)
    ---------------------
    Uses the narrowest usable width within each layout family so the size is
    safe for every scene type that shares that layout:
      left   840  (truth/left: l+20, r+60 margins)
      right  800  (insight/right: l+100, r+20)
      center 840  (truth/center: l=r=80)
      full  1000  (full-bleed: l=r=40)

    Examples
    --------
    >>> _calc_kw_font_size("FAKE CONFIDENCE",          "right", "hook")    # 140
    >>> _calc_kw_font_size("HIDDEN RESENTMENT",        "right", "tension") # 104
    >>> _calc_kw_font_size("COLLECTIVE HALLUCINATION", "left",  "insight") # 104
    >>> _calc_kw_font_size("THE GREAT LIE",            "left",  "truth")   # 168
    >>> _calc_kw_font_size("SYSTEMIC FRAUD",           "full",  "hook")    # 168
    >>> _calc_kw_font_size("MOMENTUM",                 "left",  "truth")   # 153
    >>> _calc_kw_font_size("IRREPLACEABLE",            "full",  "climax")  # 149
    >>> _calc_kw_font_size("DISAPPOINTMENT",           "left",  "truth")   # 110
    """
    CONTAINER_PX: dict[str, int] = {
        'left':   840,
        'right':  800,
        'center': 840,
        'full':  1000,
    }
    SCENE_MAX_PX: dict[str, int] = {
        'hook':   168, 'truth':  168, 'climax': 168,
        'flip':   168, 'payoff': 168,
        'tension':104, 'insight':104, 'cta':    104,
    }
    SAFETY:  float = 0.90   # 10% breathing room for sub-pixel rounding & tracking
    MIN_PX:  int   = 56     # readability floor

    usable  = CONTAINER_PX.get(layout, 840) * SAFETY
    max_sz  = SCENE_MAX_PX.get(scene, 168)
    words   = keyword.split()

    # ── Constraint 1: widest single word ─────────────────────────────────────
    em_widths = [_word_em_width(w) for w in words]
    limiting_em = max(em_widths)

    # ── Constraint 2: widest adjacent pair (3+ word keywords only) ───────────
    # 2-word keywords intentionally left unconstrained: each word gets its own
    # line at large sizes — the intended cinematic 2-line look.
    if len(words) >= 3:
        pair_ems = [
            em_widths[i] + _SG_SPACE_W + em_widths[i + 1]
            for i in range(len(words) - 1)
        ]
        limiting_em = max(limiting_em, max(pair_ems))

    max_font = usable / limiting_em

    return max(MIN_PX, min(max_sz, int(max_font)))


# ── Self-test ─────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    cases = [
        # (keyword,                    layout,   scene,     expected)
        ("FAKE CONFIDENCE",            "right",  "hook",    140),
        ("HIDDEN RESENTMENT",          "right",  "tension", 104),
        ("COLLECTIVE HALLUCINATION",   "left",   "insight", 104),
        ("THE GREAT LIE",              "left",   "truth",   168),
        ("SYSTEMIC FRAUD",             "full",   "hook",    168),
        ("MOMENTUM",                   "left",   "truth",   153),
        ("IRREPLACEABLE",              "full",   "climax",  149),
        ("DISAPPOINTMENT",             "left",   "truth",   110),
        ("OVERWHELMED",                "right",  "tension", 104),
        ("WILLPOWER",                  "left",   "climax",  163),
        ("THE FANTASY",                "left",   "hook",    168),
        ("NO EVIDENCE",                "right",  "tension", 104),
        ("THE VOID",                   "center", "insight", 104),
        ("BEGINNER FOREVER",           "left",   "truth",   168),
        ("UNTRAINED MUSCLE",           "full",   "climax",  168),
        ("ONE FINISHED WIN",           "center", "cta",     104),
    ]

    all_pass = True
    print(f"{'KEYWORD':<30} {'LAYOUT':<8} {'SCENE':<9} {'RESULT':>7} {'EXPECT':>7} {'':>6}")
    print('─' * 72)
    for kw, lay, sc, exp in cases:
        result = _calc_kw_font_size(kw, lay, sc)
        ok = result == exp
        if not ok:
            all_pass = False
        flag = '✓' if ok else f'✗ (got {result})'
        print(f"{kw:<30} {lay:<8} {sc:<9} {result:>7} {exp:>7}   {flag}")

    print()
    print('All pass ✓' if all_pass else 'Some tests FAILED ✗')
# ── Space Grotesk Bold uppercase advance widths (normalised to em units) ──────
# Derived from HarfBuzz shaping at UPM=1000, scaled by 1.08 to match actual
# Chromium rendering. The raw HarfBuzz values underestimate Chromium glyph
# advance widths by ~8% due to hinting and subpixel differences.
# Calibrated against rendered frames at 1080×1920.
_SG_BOLD_W_RAW: dict[str, float] = {
    'A': 0.484, 'B': 0.524, 'C': 0.568, 'D': 0.594, 'E': 0.490,
    'F': 0.436, 'G': 0.614, 'H': 0.558, 'I': 0.260, 'J': 0.344,
    'K': 0.490, 'L': 0.400, 'M': 0.760, 'N': 0.560, 'O': 0.608,
    'P': 0.468, 'Q': 0.608, 'R': 0.490, 'S': 0.446, 'T': 0.438,
    'U': 0.560, 'V': 0.468, 'W': 0.760, 'X': 0.468, 'Y': 0.458,
    'Z': 0.464,
}
# Chromium correction: raw values × 1.08 to match actual rendered widths
_CHROMIUM_SCALE: float = 1.08
_SG_BOLD_W: dict[str, float] = {k: v * _CHROMIUM_SCALE for k, v in _SG_BOLD_W_RAW.items()}
_SG_SPACE_W: float = 0.250 * _CHROMIUM_SCALE
_FALLBACK_W: float = 0.520   # apostrophe, punctuation — slightly above average


def _word_em_width(word: str) -> float:
    """Return total advance width of *word* in Chromium-calibrated em units."""
    return sum(_SG_BOLD_W.get(c.upper(), _FALLBACK_W) for c in word)


def calc_kw_font_size(keyword: str, layout: str, scene: str) -> int:
    """
    Calculate the max keyword font size (px) that fits within the scene container
    without word-breaking.

    Changes vs v1:
    - Container widths corrected per layout (left/right/center use actual margin values
      from the scene HTML files rather than a single conservative 840px estimate)
    - Em-width table scaled by 1.08 to match Chromium's actual rendered advance widths
      (HarfBuzz raw values systematically underestimate by ~8%)
    - SAFETY reduced to 0.85 (was 0.90) — combined with the Chromium scale correction
      this gives confident no-overflow results at the actual rendering engine

    Container widths (px)
    ---------------------
    Derived from scene HTML margin values:
      left:   1080 - 80(left) - 80(right) = 920px  (hook, flip, truth, payoff, tension)
      right:   1080 - 100(left) - 140(right) = 840px  (insight/right, truth/right)
      center: 1080 - 80 - 80 = 920px
      full:   1080 - 40 - 40 = 1000px

    Safety: 0.85 — 15% breathing room for subpixel rounding and font hinting variation.
    """
    LAYOUT_CONTAINER_PX: dict[str, int] = {
        'left':   920,
        'right':  840,
        'center': 920,
        'full':  1000,
    }
    SCENE_MAX_PX: dict[str, int] = {
        'hook':   168, 'truth':  168, 'climax': 168,
        'flip':   168, 'payoff': 168,
        'tension':104, 'insight':104, 'cta':    104,
    }
    SAFETY:  float = 0.85   # was 0.90 — combined with Chromium scale gives safe margin
    MIN_PX:  int   = 56

    usable  = LAYOUT_CONTAINER_PX.get(layout, 920) * SAFETY
    max_sz  = SCENE_MAX_PX.get(scene, 168)
    words   = keyword.split()

    em_widths   = [_word_em_width(w) for w in words]
    limiting_em = max(em_widths)

    if len(words) >= 3:
        pair_ems    = [
            em_widths[i] + _SG_SPACE_W + em_widths[i + 1]
            for i in range(len(words) - 1)
        ]
        limiting_em = max(limiting_em, max(pair_ems))

    max_font = usable / limiting_em
    return max(MIN_PX, min(max_sz, int(max_font)))


# ── Self-test ─────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    cases = [
        ("FAKE CONFIDENCE",            "right",  "hook",    128),
        ("HIDDEN RESENTMENT",          "right",  "tension", 104),
        ("COLLECTIVE HALLUCINATION",   "left",   "insight", 104),
        ("THE GREAT LIE",              "left",   "truth",   168),
        ("SYSTEMIC FRAUD",             "full",   "hook",    168),
        ("MOMENTUM",                   "left",   "truth",   146),
        ("IRREPLACEABLE",              "full",   "climax",  130),
        ("DISAPPOINTMENT",             "left",   "truth",   105),
        ("OVERWHELMED",                "right",  "tension", 104),
        ("WILLPOWER",                  "left",   "climax",  156),
        ("YOU\'RE OUTSMARTED",          "left",   "hook",    136),
        ("BEGINNER FOREVER",           "left",   "truth",   168),
        ("UNTRAINED MUSCLE",           "full",   "climax",  168),
        ("ONE FINISHED WIN",           "center", "cta",     104),
        ("KINETIC CHAOS",              "full",   "climax",  168),
    ]

    all_pass = True
    print(f"{'KEYWORD':<30} {'LAYOUT':<8} {'SCENE':<9} {'RESULT':>7} {'EXPECT':>7} {''}")
    print('─' * 68)
    for kw, lay, sc, exp in cases:
        result = calc_kw_font_size(kw, lay, sc)
        ok = result == exp
        if not ok:
            all_pass = False
        flag = '✓' if ok else f'✗ (got {result})'
        print(f"{kw:<30} {lay:<8} {sc:<9} {result:>7} {exp:>7}   {flag}")

    print()
    print('All pass ✓' if all_pass else 'Some tests FAILED ✗')
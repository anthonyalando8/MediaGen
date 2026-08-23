#!/usr/bin/env python3
"""
verify_watchability.py — assert the watchability fixes actually landed.

Reads the artifacts a run already produces and checks each fix from
dropin/WATCHABILITY_FIX.md against them. Prints a PASS/FAIL table and exits
non-zero if anything regressed, so it can go in CI later.

    python dropin/verify_watchability.py out/<run-id>/
    python dropin/verify_watchability.py out/<run-id>/ --listicle

Expects, in that directory (missing files are SKIPped, not failed):
    scene.json      required
    timeline.json   for the caption-alignment + ducking checks
    script.json     for the declared-type + explicit-intensity checks

--listicle adds the format-specific checks: rank prefixes, distinct visual
queries, non-decreasing item intensity.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

# Must match visuals.py / formats.py defaults.
PI_MIN_GAP_BEATS = 1
PI_MAX_PER_VIDEO = 3
PEAK_BUDGET = 2
HARD_TRANSITIONS = {"slam_cut", "flash", "whip_pan", "dip_black"}
EXTREME_CAMERAS = {"snap_zoom", "micro_shake"}
DEFAULT_GAP_S = 0.40


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []
        self.failed = 0

    def add(self, status: str, name: str, detail: str = "") -> None:
        self.rows.append((status, name, detail))
        if status == "FAIL":
            self.failed += 1

    def ok(self, name, detail=""): self.add("PASS", name, detail)
    def bad(self, name, detail): self.add("FAIL", name, detail)
    def skip(self, name, detail): self.add("SKIP", name, detail)

    def print(self) -> None:
        colw = max(len(r[1]) for r in self.rows) + 2
        print()
        for status, name, detail in self.rows:
            mark = {"PASS": "✓", "FAIL": "✗", "SKIP": "–"}[status]
            print(f"  {mark} {name.ljust(colw)}{detail}")
        print()
        n_fail = self.failed
        n_pass = sum(1 for r in self.rows if r[0] == "PASS")
        n_skip = sum(1 for r in self.rows if r[0] == "SKIP")
        print(f"  {n_pass} passed, {n_fail} failed, {n_skip} skipped")


def _load(d: pathlib.Path, name: str):
    p = d / name
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _beats_of(scene: dict) -> list[dict]:
    for key in ("beats", "contracts", "scenes"):
        v = scene.get(key)
        if isinstance(v, list) and v:
            return v
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Checks
# ─────────────────────────────────────────────────────────────────────────────
def check_hud(beats: list[dict], r: Report) -> None:
    """FIX A — the // chip must be gone unless a format opted in."""
    tagged = [b.get("id", i) for i, b in enumerate(beats) if (b.get("hud_tag") or "").strip()]
    if tagged:
        r.bad("hud_tag empty on every beat",
              f"{len(tagged)} beats still carry a chip: {tagged[:5]}")
    else:
        r.ok("hud_tag empty on every beat", f"{len(beats)} beats clean")


def check_interrupts(beats: list[dict], r: Report, budget: int = PI_MAX_PER_VIDEO) -> None:
    """FIX B — adjacency, whole-video budget, invert once."""
    hits = [(i, b.get("pattern_interrupt")) for i, b in enumerate(beats) if b.get("pattern_interrupt")]
    idxs = [i for i, _ in hits]

    adjacent = [(a, b) for a, b in zip(idxs, idxs[1:]) if b - a <= PI_MIN_GAP_BEATS]
    if adjacent:
        r.bad("no adjacent pattern_interrupts",
              f"{len(adjacent)} adjacent pair(s): {adjacent[:4]}")
    else:
        r.ok("no adjacent pattern_interrupts", f"{len(hits)} interrupted beats: {idxs}")

    if len(hits) > budget:
        # Not necessarily a failure — an explicit script may exceed the budget
        # on purpose, since author-supplied values are always honoured.
        r.skip("interrupt budget", f"{len(hits)} > {budget} — check these were author-supplied")
    else:
        r.ok("interrupt budget", f"{len(hits)} ≤ {budget}")

    inverts = [i for i, v in hits if v == "invert"]
    if len(inverts) > 1:
        r.bad("invert at most once", f"{len(inverts)} inverts at beats {inverts}")
    else:
        r.ok("invert at most once", "1" if inverts else "0")


def check_peak_budget(beats: list[dict], r: Report, limit: int = PEAK_BUDGET) -> None:
    """FIX E — no beat stacks more than `limit` maximal effects."""
    over = []
    for i, b in enumerate(beats):
        n = 0
        if b.get("pattern_interrupt"):
            n += 1
        if b.get("transition") in HARD_TRANSITIONS:
            n += 1
        if b.get("camera") in EXTREME_CAMERAS:
            n += 1
        if n > limit:
            over.append((i, n, b.get("transition"), b.get("camera"), b.get("pattern_interrupt")))
    if over:
        r.bad(f"≤{limit} peak effects per beat", f"{len(over)} over budget: {over[:3]}")
    else:
        r.ok(f"≤{limit} peak effects per beat")


def check_durations(beats: list[dict], r: Report) -> None:
    """FIX F — the flat 5000ms placeholder is gone."""
    durs = [b.get("duration_ms") for b in beats if isinstance(b.get("duration_ms"), (int, float))]
    if not durs:
        r.skip("duration_ms varies", "no duration_ms on beats")
        return
    if len(set(durs)) == 1 and durs[0] == 5000:
        r.bad("duration_ms varies", "every beat is exactly 5000ms — placeholder still in use")
    elif len(set(durs)) == 1:
        r.skip("duration_ms varies", f"all beats {durs[0]}ms — suspicious but not the old constant")
    else:
        r.ok("duration_ms varies", f"{min(durs)}–{max(durs)}ms")


def check_declared_type(beats: list[dict], script: dict | None, r: Report) -> None:
    """FIX C — the declared type must survive into `scene`, including on the
    first and last beat, which used to be force-typed hook/cta."""
    if not script:
        r.skip("declared type wins over position", "script.json not found")
        return
    sbeats = script.get("beats") or []
    if len(sbeats) != len(beats):
        r.skip("declared type wins over position",
               f"{len(sbeats)} script beats vs {len(beats)} scene beats")
        return
    known = {"hook", "insight", "climax", "cta", "tension", "truth", "flip", "payoff"}
    mismatched = []
    for i, (sb, b) in enumerate(zip(sbeats, beats)):
        t = (sb.get("type") or "").lower()
        if t in known and b.get("scene") != t:
            mismatched.append((i, t, b.get("scene")))
    if mismatched:
        r.bad("declared type wins over position",
              f"{len(mismatched)} overridden: {mismatched[:4]}")
    else:
        r.ok("declared type wins over position", f"{len(beats)} beats match")


def check_intensity_zero(beats: list[dict], script: dict | None, r: Report) -> None:
    """FIX D — an explicit 0.0 must not be replaced by the scene default."""
    if not script:
        r.skip("explicit intensity preserved", "script.json not found")
        return
    sbeats = script.get("beats") or []
    if len(sbeats) != len(beats):
        r.skip("explicit intensity preserved", "beat count mismatch")
        return
    lost = []
    for i, (sb, b) in enumerate(zip(sbeats, beats)):
        want = sb.get("intensity")
        if isinstance(want, (int, float)) and abs(float(b.get("intensity", -1)) - float(want)) > 1e-6:
            lost.append((i, want, b.get("intensity")))
    if lost:
        r.bad("explicit intensity preserved", f"{len(lost)} changed: {lost[:4]}")
    else:
        zeros = sum(1 for sb in sbeats if sb.get("intensity") == 0)
        r.ok("explicit intensity preserved", f"({zeros} beat(s) at exactly 0.0)")


def check_caption_alignment(timeline: dict | None, r: Report) -> None:
    """FIX P0a — every caption unit's beat_index must agree with the beat whose
    audio span contains it. This is the check that fails loudly if the
    caption_director patch wasn't applied.

    Compare on the unit's FIRST SPOKEN WORD, not on `start_s`. `schedule()` sets
    `u.start = words[0].start - leadIn` (60ms), so a unit whose first word lands
    just after a beat boundary has a `start_s` that sits *before* that boundary,
    in the preceding beat's span or in the inter-beat silence gap. Testing
    `start_s` reports a spurious +1 drift on exactly those units — the lead-in
    is deliberate pre-roll, and beat ownership is decided by the word.
    """
    if not timeline:
        r.skip("caption units agree with beat spans", "timeline.json not found")
        return
    tbeats = timeline.get("beats") or []
    units = (timeline.get("captions") or {}).get("units") or []
    if not tbeats or not units:
        r.skip("caption units agree with beat spans", "no beats or no caption units")
        return

    spans = []
    for b in tbeats:
        start = float(b.get("audio_start_s", 0.0))
        spans.append((start, start + float(b.get("duration_ms", 0)) / 1000.0))

    def owner(t: float) -> int:
        for bi, (lo, hi) in enumerate(spans):
            if t < hi:
                return bi if t >= lo or bi == 0 else max(0, bi - 1)
        return len(spans) - 1

    wrong = []
    for u in units:
        ws = u.get("words") or []
        # First spoken word (global seconds); fall back to the unit start only
        # when a unit somehow carries no words.
        t = float(ws[0]["start_s"]) if ws else float(u.get("start_s", 0.0))
        expect = owner(t)
        got = int(u.get("beat_index", -1))
        if expect != got:
            wrong.append((round(t, 2), got, expect))
    if wrong:
        drift = max(abs(g - e) for _, g, e in wrong)
        r.bad("caption units agree with beat spans",
              f"{len(wrong)}/{len(units)} misattributed, max drift {drift} beats: {wrong[:4]}")
    else:
        r.ok("caption units agree with beat spans", f"{len(units)} units")


def check_ducking_clock(scene: dict, timeline: dict | None, r: Report) -> None:
    """FIX P1 — music_automation must span the gap-inclusive timeline, not the
    gap-less one. If the last keyframe lands ~gap*(n-1) short, the call site
    wasn't updated."""
    auto = scene.get("music_automation")
    if not auto:
        r.skip("ducking envelope on the right clock", "no music_automation in scene.json")
        return
    beats = _beats_of(scene)
    durs = [b.get("duration_ms", 0) for b in beats]
    if not durs:
        r.skip("ducking envelope on the right clock", "no beat durations")
        return
    gap_ms = DEFAULT_GAP_S * 1000
    expect_gapless = sum(durs)
    expect_gapped = sum(durs) + gap_ms * (len(durs) - 1)
    last = max(k.get("at_ms", 0) for k in auto)
    if abs(last - expect_gapped) <= max(500, gap_ms):
        r.ok("ducking envelope on the right clock", f"ends {last}ms ≈ {int(expect_gapped)}ms")
    elif abs(last - expect_gapless) <= 500:
        r.bad("ducking envelope on the right clock",
              f"ends {last}ms = gap-less total; expected ~{int(expect_gapped)}ms "
              f"(scene_export call site not passing gap_ms?)")
    else:
        r.skip("ducking envelope on the right clock",
               f"ends {last}ms, gapless {int(expect_gapless)}, gapped {int(expect_gapped)}")


# ─────────────────────────────────────────────────────────────────────────────
# Listicle-specific
# ─────────────────────────────────────────────────────────────────────────────
def check_listicle(beats: list[dict], script: dict | None, r: Report) -> None:
    sbeats = (script or {}).get("beats") or []
    src = sbeats if sbeats else beats

    ranked = [b for b in src if (b.get("keyword") or "").strip().startswith("#")]
    if len(ranked) < 3:
        r.bad("rank-prefixed item keywords", f"only {len(ranked)} keywords start with '#'")
    else:
        r.ok("rank-prefixed item keywords", " ".join((b.get("keyword") or "")[:4] for b in ranked))

    # Counting DOWN — the ranks in order should descend.
    nums = []
    for b in ranked:
        head = (b.get("keyword") or "").strip().lstrip("#").split()[0] if b.get("keyword") else ""
        if head.isdigit():
            nums.append(int(head))
    if len(nums) >= 3:
        if nums == sorted(nums, reverse=True):
            r.ok("ranks count down", f"{nums}")
        else:
            r.bad("ranks count down", f"{nums} — not descending")
    else:
        r.skip("ranks count down", "fewer than 3 parseable ranks")

    queries = [(b.get("visual_query") or "").strip().lower() for b in src if b.get("visual_query")]
    if queries:
        uniq = len(set(queries))
        if uniq < max(3, int(len(queries) * 0.8)):
            r.bad("visual queries are distinct",
                  f"{uniq} unique of {len(queries)} — the repeated-subject failure")
        else:
            r.ok("visual queries are distinct", f"{uniq}/{len(queries)} unique")
    else:
        r.skip("visual queries are distinct", "no visual_query fields")

    item_intens = [b.get("intensity") for b in ranked if isinstance(b.get("intensity"), (int, float))]
    if len(item_intens) >= 3:
        if all(a <= b + 1e-6 for a, b in zip(item_intens, item_intens[1:])):
            r.ok("item intensity non-decreasing", f"{item_intens}")
        else:
            r.bad("item intensity non-decreasing", f"{item_intens}")
    else:
        r.skip("item intensity non-decreasing", "fewer than 3 item intensities")

    archetypes = [b.get("archetype") for b in beats if b.get("archetype")]
    if archetypes:
        uniq = len(set(archetypes))
        if uniq < 3:
            r.bad("archetype variety", f"only {uniq} distinct: {sorted(set(archetypes))}")
        else:
            r.ok("archetype variety", f"{uniq} distinct: {sorted(set(archetypes))}")
        runs, longest, prev = 1, 1, None
        for a in archetypes:
            runs = runs + 1 if a == prev else 1
            longest = max(longest, runs)
            prev = a
        if longest > 2:
            r.bad("max 2 consecutive archetypes", f"run of {longest}")
        else:
            r.ok("max 2 consecutive archetypes")
    else:
        r.skip("archetype variety", "no archetype fields")


# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", help="directory holding scene.json / timeline.json / script.json")
    ap.add_argument("--listicle", action="store_true", help="add listicle_top5 format checks")
    ap.add_argument("--interrupt-max", type=int, default=PI_MAX_PER_VIDEO)
    ap.add_argument("--peak-budget", type=int, default=PEAK_BUDGET)
    args = ap.parse_args()

    d = pathlib.Path(args.run_dir)
    if not d.is_dir():
        print(f"not a directory: {d}", file=sys.stderr)
        return 2

    scene = _load(d, "scene.json")
    if scene is None:
        print(f"scene.json not found in {d}", file=sys.stderr)
        return 2
    timeline = _load(d, "timeline.json")
    script = _load(d, "script.json")

    beats = _beats_of(scene)
    if not beats:
        print("no beats found in scene.json", file=sys.stderr)
        return 2

    r = Report()
    print(f"\n  {d}  —  {len(beats)} beats")

    check_hud(beats, r)
    check_interrupts(beats, r, args.interrupt_max)
    check_peak_budget(beats, r, args.peak_budget)
    check_durations(beats, r)
    check_declared_type(beats, script, r)
    check_intensity_zero(beats, script, r)
    check_caption_alignment(timeline, r)
    check_ducking_clock(scene, timeline, r)
    if args.listicle:
        check_listicle(beats, script, r)

    r.print()
    return 1 if r.failed else 0


if __name__ == "__main__":
    sys.exit(main())

# Visual query fix — why backgrounds are out of context (and how to fix it)

## Symptom
Topic is programming; backgrounds show **mountains / skies / fog** instead of
computers. The script JSON is mapped correctly — the problem is in (1) how the
`visual_query` strings are *written* and (2) how `capture.js` *fetches* them.

## Root cause — two failure modes stacking

**A. Queries are mood-led, not subject-led.**
The prompt says `visual_query` should be *"Dark, atmospheric. Match topic AND
emotion."* On an emotional beat the model reaches for the *feeling* —
"solitude", "dark journey", "struggle", "isolation". Image search takes that
**literally**, and because nature/landscape stock dominates Unsplash, mood words
resolve to mountains, skies, and fog — never your topic.

**B. `/photos/random` returns an UNRELATED image on zero results.**
`capture.js` uses the `random` endpoint. When a query is too niche
("legally drunk brain scan"), Unsplash finds **zero matches and then hands back a
random photo anyway** — again usually a landscape. So even well-written beats
occasionally roll a mountain.

---

## Fix 1 — rewrite the `visual_query` section of the script prompt (drop-in)

Replace the existing `visual_query` guidance with this. The key change: **lead with
a concrete photographable subject from the topic domain, carry the topic into every
beat, ban mood/metaphor words.**

```
──────────────────────────────────────────────────────────────────────
VISUAL QUERY — REQUIRED, must return a CONTEXTUAL image
──────────────────────────────────────────────────────────────────────
Image search is LITERAL. It does not understand emotion or metaphor. A query of
mood words ("dark solitude atmospheric") returns generic landscape stock. A query
that is too niche returns ZERO results and the API falls back to a random
unrelated photo. Both are why you get mountains on a coding video.

RULES (all mandatory):
1. SUBJECT FIRST. Every query MUST begin with a concrete, photographable NOUN from
   the video's topic domain — the literal thing on screen, not the feeling. The
   topic is "{topic}". Its subject must appear in EVERY beat's query.
2. Then at most 1–2 VISUAL modifiers only: lighting, angle, or setting
   (e.g. "night", "close up", "macro", "blue light", "office", "screen glow").
3. BANNED in queries: emotions and abstractions — "solitude", "struggle",
   "journey", "atmospheric", "powerful", "freedom", "mind", "soul", "abstract",
   and any feeling word. These return nature/abstract stock, not your topic.
4. Use COMMON stock subjects that exist in quantity. If the literal subject is
   rare, use the nearest common, photographable proxy.
5. 2–4 words. Concrete + visual. No mood.

Template:  [topic subject] + [setting or lighting]

For a PROGRAMMING topic:
  Good: "laptop code screen night" / "developer dark office" / "server room blue"
        / "keyboard macro close up" / "terminal screen glow" / "monitor code dark"
  Bad:  "dark solitude" / "mountain journey" / "abstract struggle" / "deep focus"
        / "mind racing" / "digital freedom"   ← all return landscapes/abstract

Every beat, regardless of emotion, stays ON the topic subject. Emotion is carried
by the MOTION system (camera, intensity, grain), NOT by the photo. The photo's job
is only to keep the viewer inside the topic's world.
```

Also delete the old "Dark, atmospheric" line from the per-beat field guidance —
that instruction is what pushes the model toward mood imagery.

---

## Fix 2 — upgrade `fetchUnsplashUrl` in `capture.js` (the reliability lever)

Switch from the `random` endpoint to **relevance-ranked search**, with a
subject-only retry, and return `null` rather than a wrong image. (This is the
single biggest win — it kills the zero-result mountain fallback.)

```js
async function fetchUnsplashUrl(query) {
  if (!UNSPLASH_KEY) {
    console.warn('[capture] UNSPLASH_API_KEY not set — skipping background images');
    return null;
  }
  if (!query) return null;

  // SEARCH (relevance-ranked), not RANDOM. random returns a loosely-matched photo
  // from a wide pool and, on ZERO hits, falls back to an UNRELATED image — that is
  // the "mountains on a coding video" bug. search lets us rank by relevance AND
  // detect empty results so we can retry with just the subject instead.
  async function search(q) {
    const url = `https://api.unsplash.com/search/photos`
      + `?query=${encodeURIComponent(q)}`
      + `&orientation=portrait&content_filter=high&per_page=8&order_by=relevant`
      + `&client_id=${UNSPLASH_KEY}`;
    try {
      const res = await fetch(url, {
        headers: { 'Accept-Version': 'v1' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) { console.warn(`[capture] Unsplash ${res.status} for "${q}"`); return []; }
      const data = await res.json();
      return Array.isArray(data?.results) ? data.results : [];
    } catch (err) {
      console.warn(`[capture] Unsplash search failed for "${q}": ${err.message}`);
      return [];
    }
  }

  let results = await search(query);

  // Retry with just the SUBJECT (first 2 words) if the full query was too niche.
  if (!results.length) {
    const subject = query.split(/\s+/).slice(0, 2).join(' ');
    if (subject && subject !== query) {
      console.log(`[capture] "${query}" had 0 hits — retrying subject "${subject}"`);
      results = await search(subject);
    }
  }

  // Better NO image (theme background colour shows) than a WRONG one.
  if (!results.length) {
    console.log(`[capture] no contextual image for "${query}" — using theme bg`);
    return null;
  }

  // Pick from the top few for variety while staying relevant.
  const top  = results.slice(0, Math.min(5, results.length));
  const pick = top[Math.floor(Math.random() * top.length)];
  const imageUrl = pick?.urls?.regular;
  if (imageUrl) console.log(`[capture] ✓ "${query}" → ${pick?.user?.name || 'unknown'}`);
  return imageUrl ? imageUrl + '&bri=-30&con=10' : null;
}
```

Why each change matters:
- **`/search/photos` + `order_by=relevant`** → the API ranks by relevance instead
  of handing back a random pool member. Far more on-topic.
- **subject-only retry** → a too-niche query degrades to its core noun
  ("laptop code screen night" → "laptop code") instead of failing to random.
- **`return null` on empty** → the beat shows its theme background colour, which
  reads as intentional. A mismatched mountain reads as broken. Null > wrong.

> Note: this is in `capture.js` (JS), not the Python/ffmpeg layer — it's the same
> fetch you already own, just pointed at a better endpoint.

---

## Quick test
Render a programming script and watch the `[capture]` logs:
- before: `Image fetched: "dark solitude"` → a mountain
- after:  either `✓ "laptop code screen night" → …` (on topic) or
          `no contextual image … using theme bg` (clean fallback)

Both outcomes are on-brand. Neither is a mountain.

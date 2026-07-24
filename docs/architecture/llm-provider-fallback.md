# LLM provider abstraction — priority-ranked fallback

> Status: **shipped and verified** — unit tests (15, no network) + a real
> end-to-end generation through the new abstraction against the live Ollama
> backend. Adapted from an attached design doc; the parts that didn't match
> this project's actual requirement (single active provider, no
> enabled/priority ranking) were replaced — see "How this deviates from the
> attached design doc" below.

## What this is

Script generation (`llm.py::generate_script`) no longer talks to Ollama
directly. It calls one function — `generation.generate(prompt) -> str` —
which tries every **enabled** provider from `config.yaml`'s `llm.providers`
block, **highest `priority` first**, and **falls back to the next one on
any failure**, continuing down the list until one succeeds or all of them
have failed. Ollama is the permanent baseline: it's enabled with the
highest priority by default, and stays that way even if `providers:` were
deleted from `config.yaml` entirely.

```yaml
llm:
  model: "gemma4:31b-cloud"     # still the ollama model, if providers.ollama.model is unset

  providers:
    ollama:
      enabled: true
      priority: 100

    openrouter:                 # free-tier models only (":free" model IDs)
      enabled: false
      priority: 80
      model: "meta-llama/llama-3.1-8b-instruct:free"
      api_key: ${OPENROUTER_API_KEY}

    groq:                       # generous free tier
      enabled: false
      priority: 70
      model: "llama-3.1-8b-instant"
      api_key: ${GROQ_API_KEY}

    gemini:                     # free API tier
      enabled: false
      priority: 60
      model: "gemini-2.0-flash"
      api_key: ${GEMINI_API_KEY}
```

Flip `enabled: true` on any of these (and set the matching env var, or add
it to `apps/python/.env`) to bring a provider into the fallback chain — no
code change. Every provider here is free-tier; paid providers (the actual
OpenAI API, etc.) are explicitly out of scope for this pass — see "Why no
paid `openai` provider" below.

## Why fallback, not "pick one"

The attached design doc's scheme was a single active provider selected by
`llm.provider: <name>` — the ask for THIS project is different: multiple
providers enabled at once, ranked, with automatic fallback down the list on
failure. That's a materially different selection mechanism (a ranked chain
vs. a single named choice), so the config shape and `generation.py`'s
internals diverge from the doc here — the provider-implementation PATTERN
(stdlib HTTP, one file per genuinely-different API shape, subclass for
API-compatible backends) is kept as designed.

## Where each piece lives

| Piece | File | Responsibility |
|---|---|---|
| Provider contract | `providers/base.py` | `Provider.generate(prompt) -> str`. Must raise on failure — never return `""`, never parse JSON. |
| Ollama (baseline) | `providers/ollama.py` | The exact `subprocess.check_output(["ollama", "run", model, prompt], ...)` call that used to live in `llm.py`, moved verbatim. |
| OpenAI-compatible base | `providers/openai_compatible.py` | Generic `/chat/completions` HTTP call (stdlib `urllib`, no SDK). Not registered as a provider on its own — see below. |
| OpenRouter | `providers/openrouter.py` | Subclasses the above; different `base_url` + optional attribution headers. |
| Groq | `providers/groq.py` | Subclasses the above; different `base_url`. That's the entire file. |
| Gemini | `providers/gemini.py` | Different request/response shape (`generateContent`, not chat/completions) — its own file, doesn't subclass anything. |
| Registry | `providers/__init__.py` | `{name: class}`. Adding an OpenAI-compatible backend (Together, DeepInfra, Cerebras, ...) is a `default_base_url` override + one registry line — no `llm.py`/`generation.py` change. |
| Selection + fallback | `generation.py` | Loads `config.yaml`, resolves the back-compat rule, ranks enabled providers by priority, runs the fallback chain. The ONLY thing `llm.py` imports from this whole subsystem. |

## The back-compat guarantee

`config.yaml` untouched (today's `llm: { model: gemma4:31b-cloud }`, no
`providers:` key) resolves to **exactly one enabled provider — ollama, with
that model** — reproducing the pre-refactor subprocess call byte for byte.
This is enforced structurally, not by convention:

- `generation._OLLAMA_DEFAULTS` (`{"enabled": True, "priority": 100,
  "timeout_s": 180}`) is merged UNDER whatever (if anything) `providers.ollama`
  says, so ollama is a candidate even if `providers:` never mentions it —
  the "if no other models are enabled, keep using Ollama exactly as today"
  requirement can't be broken by an incomplete `providers:` block.
- If `providers.ollama.model` is unset, the legacy top-level `llm.model`
  fills it in.
- Verified in `tests/test_generation.py` (`TestResolveProviderConfigs`,
  `TestRankedProviders`) and against the real repo's actual `config.yaml`
  (`generation._build_providers()` resolves to `[("ollama", ...)]` with
  today's file, unedited).

## `llm.py`'s side of the boundary

`llm.py` lost ALL provider knowledge — no `import subprocess`, no model
string handling, no HTTP. `generate_script`'s body changed by exactly one
line: the direct subprocess call became `raw = generate(prompt)` (imported
as `from generation import generate`). Its 3-attempt retry loop is
UNCHANGED — each attempt still wraps the call in `try/except Exception`, so
a provider (or the whole fallback chain) raising is caught and retried
exactly like a wedged Ollama call was before. `model: str | None = None`
stays as a parameter purely so `main.py`/`server.py`'s existing
`generate_script(topic, fmt, CFG["llm"]["model"])` call sites don't need to
change — the argument is accepted and ignored; provider/model selection is
`config.yaml`'s job now, not the caller's.

`grep -n "subprocess" apps/python/src/llm.py` returns nothing.

## Fallback behavior in detail

`generation._generate_with_fallback(providers, prompt)`:

1. Try the highest-priority enabled provider.
2. On any exception, log which provider failed and why, then try the next
   one down the ranked list.
3. Return the first success.
4. If every enabled provider raised, raise `RuntimeError` chaining the last
   provider's exception (`raise ... from last_exc`).

This function takes an explicit `[(name, Provider), ...]` list rather than
reading config/env itself, so the fallback LOGIC is unit-tested with fake
providers — no config file, no network, no mocking of `urllib`/`subprocess`
needed (`TestGenerateWithFallback` in `tests/test_generation.py`).

One layering note worth being explicit about: `generate()`'s fallback chain
and `generate_script`'s 3-attempt retry loop are two DIFFERENT resilience
mechanisms stacked on top of each other. If every enabled provider fails on
attempt 1, `generate_script` retries — which re-runs the ENTIRE fallback
chain again from the top (highest priority first), not "resume where it left
off." For a transient failure this is fine (same as today's behavior, where
a wedged `ollama run` just gets retried). It does mean a consistently-broken
low-priority provider gets retried 3× for no benefit before the chain gives
up on it too each time — acceptable given the alternative (stateful
per-attempt provider exclusion) is meaningfully more complexity for a
problem that "disable the broken provider in config.yaml" already solves.

## Why no paid `openai` provider

The attached design doc's `providers/openai.py` talks to `api.openai.com`
directly (a paid API) and doubles as the generic OpenAI-compatible HTTP
implementation other backends reuse. Since this pass is scoped to free
providers only, the generic implementation was kept — as
`providers/openai_compatible.py`, deliberately NOT named/registered as an
`openai` provider — and only free backends (`openrouter`, `groq`) subclass
it. Adding real OpenAI (or Anthropic, or any other paid API) later is the
same one-file-plus-registry-line shape as every other provider here; nothing
about this design blocks it, it's just not turned on.

## Verification

- `tests/test_generation.py` — 15 tests, stdlib `unittest`, zero network:
  back-compat config resolution (flat `llm.model` → ollama), priority
  ordering + enabled filtering, the fallback chain (short-circuit on first
  success, fall through multiple failures, raise with chained cause when
  all fail), unknown provider names skipped rather than fatal, no-enabled-
  providers raising a clear error, secret expansion (`${VAR}` set/unset/
  literal), and — the one that actually proves the abstraction boundary
  holds — `generate_script` monkeypatched at `llm.generate` (not
  `generation.generate`; `from generation import generate` binds llm.py's
  own reference at import time, so patching the source module after the
  fact is a no-op there — a real mistake the attached doc's own test
  suggestion would have hit) returning a fixture script with zero network,
  and asserting parsing/normalisation/`assign_composition` all still fire
  correctly.
- Real end-to-end: `generate_script` called with no `model` argument,
  through `generation.generate`, against the actual configured Ollama cloud
  model — succeeded in ~56s, composer correctly assigned real archetypes
  (`truth`→`comparison`, `payoff`→`split_screen`) from the model's own
  output. Confirms the refactor didn't change real generation behavior, not
  just the mocked path.
- `apps/python/config.yaml` resolved live (not a fixture) via
  `generation._build_providers()`: exactly `[("ollama", OllamaProvider)]`
  with today's real file, unedited.

## Not done (out of scope for this pass)

- No paid providers (see above).
- No per-provider retry count / backoff tuning — a provider either succeeds
  or the chain moves on immediately; no "retry this one 2x before falling
  back."
- No telemetry/metrics on which provider actually served a given request
  beyond the `print()` log lines.
- `Together`/`DeepInfra`/`Cerebras`/other OpenAI-compatible free tiers are
  not pre-wired (no config block, no registry entry) — trivial to add
  following `groq.py`'s pattern, just not done since nothing asked for them
  specifically.

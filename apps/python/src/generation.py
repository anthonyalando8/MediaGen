"""generation.py — provider-agnostic text generation with priority fallback.

`generate(prompt)` is the ONLY surface llm.py depends on. It loads every
ENABLED provider from config.yaml's `llm.providers` block, tries them
highest-`priority` first, and falls back to the next on any failure —
continuing down the list until one succeeds or all have failed. All
provider detail (HTTP calls, auth, request/response shape) lives under
providers/; this module only does selection + ordering + fallback.

Back-compat is load-bearing: an UNTOUCHED config.yaml (today's
`llm: { model: gemma4:31b-cloud }`, no `providers:` key at all) must resolve
to exactly one enabled provider — ollama, with that model — reproducing the
exact subprocess call that existed before this abstraction, byte for byte.
See docs/architecture/llm-provider-fallback.md.
"""
from __future__ import annotations
import pathlib
import yaml

from providers import REGISTRY
from providers.base import Provider
from media_resolve import _load_env

_CONFIG_PATH = pathlib.Path("config.yaml")

# Baked-in so ollama is ALWAYS a candidate — even a `providers:` block that
# only mentions new backends and never mentions "ollama" still gets it,
# merged under whatever (if anything) the user wrote for it. This is what
# guarantees "if no other models are enabled, keep using Ollama exactly as
# today" regardless of how the new providers block is edited.
_OLLAMA_DEFAULTS = {"enabled": True, "priority": 100, "timeout_s": 180}

_providers_cache: list[tuple[str, Provider]] | None = None


def _load_cfg() -> dict:
    if not _CONFIG_PATH.exists():
        raise FileNotFoundError("config.yaml not found — run from apps/python (project root).")
    return yaml.safe_load(_CONFIG_PATH.read_text(encoding="utf-8")) or {}


def _expand_secret(val):
    """'${FOO}' -> looked up via the same .env-or-environ loader
    media_resolve.py already uses for its stock-image API keys (shell env
    wins over apps/python/.env). Unset -> "". Anything else passes through
    unchanged (a literal key pasted directly into config.yaml still works,
    it just isn't recommended for anything checked into git)."""
    if isinstance(val, str) and val.startswith("${") and val.endswith("}"):
        return _load_env().get(val[2:-1], "")
    return val


def _resolve_provider_configs(llm: dict) -> dict[str, dict]:
    """{name: cfg} for every provider config.yaml's `llm` block implies —
    NOT filtered by `enabled` yet (see `_ranked_providers`). Pure function of
    `llm` (no disk I/O beyond secret expansion's own .env read), so this is
    directly unit-testable without a real config.yaml."""
    raw: dict[str, dict] = dict(llm.get("providers") or {})

    ollama_cfg = {**_OLLAMA_DEFAULTS, **(raw.get("ollama") or {})}
    if "model" not in ollama_cfg and llm.get("model"):
        # Legacy flat shape: `llm.model` (today's config.yaml) becomes
        # ollama's model when the new `providers.ollama.model` isn't set.
        ollama_cfg["model"] = llm["model"]
    raw["ollama"] = ollama_cfg

    resolved: dict[str, dict] = {}
    for name, cfg in raw.items():
        cfg = dict(cfg or {})
        if "api_key" in cfg:
            cfg["api_key"] = _expand_secret(cfg["api_key"])
        resolved[name] = cfg
    return resolved


def _ranked_providers(llm: dict) -> list[tuple[str, dict]]:
    """[(name, cfg), ...] for every ENABLED provider, highest `priority`
    first (ties keep dict-insertion order, i.e. config.yaml's own order)."""
    configs = _resolve_provider_configs(llm)
    enabled = [(name, cfg) for name, cfg in configs.items() if cfg.get("enabled", False)]
    enabled.sort(key=lambda nc: nc[1].get("priority", 0), reverse=True)
    return enabled


def _generate_with_fallback(providers: list[tuple[str, Provider]], prompt: str, on_provider_start=None) -> str:
    """Try each (name, provider) in order; return the first success. Raises
    only if every one of them raised. Split out from `generate()` so the
    fallback behavior itself is testable with fake providers — no config
    file, no network, no monkeypatching required.

    `on_provider_start(name, index, total)` — optional, called right before
    each provider attempt. Real progress signal (which provider is being
    tried right now), not a time-based estimate — lets a caller like
    llm.py's generate_script surface "trying groq" instead of the whole
    call just sitting there with no visible movement."""
    if not providers:
        raise RuntimeError("_generate_with_fallback called with no providers")
    last_exc: Exception | None = None
    for i, (name, provider) in enumerate(providers):
        if on_provider_start:
            on_provider_start(name, i, len(providers))
        try:
            return provider.generate(prompt)
        except Exception as e:
            is_last = i == len(providers) - 1
            suffix = "" if is_last else " — falling back to next provider"
            print(f"[generation] provider '{name}' failed: {type(e).__name__}: {e}{suffix}")
            last_exc = e
    raise RuntimeError(f"All {len(providers)} enabled provider(s) failed. Last error: {last_exc}") from last_exc


def _build_providers() -> list[tuple[str, Provider]]:
    llm = _load_cfg().get("llm") or {}
    ranked = _ranked_providers(llm)

    instances: list[tuple[str, Provider]] = []
    for name, provider_cfg in ranked:
        cls = REGISTRY.get(name)
        if cls is None:
            print(f"[generation] unknown provider '{name}' in config.yaml's llm.providers — "
                  f"skipping (known: {sorted(REGISTRY)})")
            continue
        instances.append((name, cls(provider_cfg)))

    if not instances:
        raise RuntimeError(
            "No enabled llm provider in config.yaml. At minimum "
            "llm.providers.ollama.enabled should be true — or omit "
            "`providers` entirely to use the legacy llm.model default."
        )
    return instances


def _get_providers() -> list[tuple[str, Provider]]:
    global _providers_cache
    if _providers_cache is None:
        _providers_cache = _build_providers()
    return _providers_cache


def generate(prompt: str, on_provider_start=None) -> str:
    """Send `prompt` to the highest-priority enabled provider, falling back
    down the ranked list on failure. Raises if every enabled provider
    failed — llm.py's own 3-attempt retry loop wraps this call and will
    re-run the whole fallback chain again from the top on that."""
    return _generate_with_fallback(_get_providers(), prompt, on_provider_start)

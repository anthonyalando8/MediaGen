"""Provider contract: prompt -> raw text. Nothing else.

A provider does ONE thing: send a prompt to a model backend and return the
raw text it produced. No JSON parsing, no validation, no retries, no
business logic — all of that stays in llm.py, unchanged regardless of which
provider is active. See docs/architecture/llm-provider-fallback.md.
"""
from __future__ import annotations
import abc


class Provider(abc.ABC):
    """A model backend, constructed from its config sub-block
    (`llm.providers.<name>` in config.yaml). `generate` must return the raw
    text the model produced and RAISE on transport/HTTP/auth failure — never
    return "" on error, never parse JSON here. Raising is what lets
    generation.py's fallback chain (and llm.py's own retry loop, above that)
    move on to the next provider."""

    def __init__(self, cfg: dict):
        self.cfg = cfg or {}
        self.model = self.cfg.get("model")
        self.timeout_s = int(self.cfg.get("timeout_s", 180))

    @abc.abstractmethod
    def generate(self, prompt: str) -> str: ...

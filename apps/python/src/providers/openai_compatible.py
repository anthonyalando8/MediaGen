"""Generic OpenAI-chat-completions-shaped provider (stdlib `urllib`, no SDK
dependency — same style as media_resolve.py's stock-image HTTP calls).

Several free-tier backends (OpenRouter's free models, Groq's free tier, and
plenty of others — Together/DeepInfra/Cerebras/etc if you add them later)
speak this exact `/chat/completions` shape, so they all reuse THIS class via
subclassing + a different default `base_url`, instead of each getting a
bespoke file. This module intentionally does NOT register itself as a
provider on its own — `openai.com`'s actual API is a paid service and out of
scope for now (see design doc: "focus only on free model providers"); this
class exists purely as the shared base for the free OpenAI-compatible
backends in openrouter.py / groq.py.
"""
from __future__ import annotations
import json
import urllib.request
from providers.base import Provider

DEFAULT_BASE_URL = "https://api.openai.com/v1"


class OpenAICompatibleProvider(Provider):
    #: Subclasses override to point at their own free-tier endpoint.
    default_base_url = DEFAULT_BASE_URL

    def _base_url(self) -> str:
        return (self.cfg.get("base_url") or self.default_base_url).rstrip("/")

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.cfg.get('api_key', '')}",
            "Content-Type": "application/json",
        }

    def generate(self, prompt: str) -> str:
        body = json.dumps({
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.cfg.get("temperature", 0.7),
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{self._base_url()}/chat/completions", data=body, headers=self._headers(),
        )
        with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
            data = json.loads(r.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]

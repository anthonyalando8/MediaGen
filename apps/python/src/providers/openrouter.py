"""OpenRouter — OpenAI-compatible; free-tier models are available (model IDs
ending in `:free`, e.g. "meta-llama/llama-3.1-8b-instruct:free" — check
https://openrouter.ai/models?max_price=0 for the current free catalog, it
rotates). Just a different base_url + optional attribution headers, so this
subclasses OpenAICompatibleProvider instead of duplicating the HTTP call."""
from __future__ import annotations
from providers.openai_compatible import OpenAICompatibleProvider


class OpenRouterProvider(OpenAICompatibleProvider):
    default_base_url = "https://openrouter.ai/api/v1"

    def _headers(self) -> dict:
        # HTTP-Referer/X-Title are optional attribution OpenRouter uses for
        # its public leaderboards — harmless to omit, cheap to include.
        headers = super()._headers()
        headers["HTTP-Referer"] = self.cfg.get("referer", "https://github.com/")
        headers["X-Title"] = self.cfg.get("app_title", "MediaGen")
        return headers

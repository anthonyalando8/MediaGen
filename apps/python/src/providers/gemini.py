"""Google Gemini `generateContent` (stdlib `urllib`). Different
request/response shape from the OpenAI-compatible providers, so it doesn't
subclass OpenAICompatibleProvider. Gemini has a genuinely free API tier
(generous daily quota on e.g. gemini-2.0-flash) — see
https://ai.google.dev/pricing for current free-tier limits/models."""
from __future__ import annotations
import json
import urllib.request
from providers.base import Provider

_BASE = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider(Provider):
    def generate(self, prompt: str) -> str:
        url = f"{_BASE}/models/{self.model}:generateContent?key={self.cfg.get('api_key', '')}"
        body = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
            data = json.loads(r.read().decode("utf-8"))
        return data["candidates"][0]["content"]["parts"][0]["text"]

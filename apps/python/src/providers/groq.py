"""Groq — OpenAI-compatible chat/completions API with a generous free tier
(fast inference on open models like Llama/Gemma/Qwen). Just a different
base_url, so this subclasses OpenAICompatibleProvider instead of duplicating
the HTTP call."""
from __future__ import annotations
from providers.openai_compatible import OpenAICompatibleProvider


class GroqProvider(OpenAICompatibleProvider):
    default_base_url = "https://api.groq.com/openai/v1"

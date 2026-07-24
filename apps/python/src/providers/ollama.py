"""Ollama provider — the project default and baseline. Wraps the exact
subprocess call that used to live directly in llm.generate_script, unchanged,
so default (untouched config.yaml) output is byte-for-byte identical to
before this provider abstraction existed."""
from __future__ import annotations
import subprocess
from providers.base import Provider


class OllamaProvider(Provider):
    def generate(self, prompt: str) -> str:
        return subprocess.check_output(
            ["ollama", "run", self.model, prompt],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=self.timeout_s,
        )

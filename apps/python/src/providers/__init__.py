"""Name -> provider-class registry. Adding a backend that speaks the
OpenAI-compatible /chat/completions shape (Together, DeepInfra, Cerebras,
...) needs NO new file — subclass OpenAICompatibleProvider like
openrouter.py/groq.py do (a `default_base_url` override is usually the whole
diff), add one entry here, and add its `llm.providers.<name>` sub-block to
config.yaml. llm.py / generation.py never change.
"""
from providers.ollama import OllamaProvider
from providers.openrouter import OpenRouterProvider
from providers.groq import GroqProvider
from providers.gemini import GeminiProvider

REGISTRY = {
    "ollama":     OllamaProvider,
    "openrouter": OpenRouterProvider,
    "groq":       GroqProvider,
    "gemini":     GeminiProvider,
}

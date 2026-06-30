import os

from app.llm_provider import SopLlmProvider
from app.openai_sop_provider import OpenAiSopProvider
from app.anthropic_sop_provider import AnthropicSopProvider

def get_llm_provider() -> SopLlmProvider:
    selected = os.getenv("LLM_PROVIDER", "openai")

    if selected == "openai":
        return OpenAiSopProvider()
    if selected == "anthropic":
        return AnthropicSopProvider()

    raise RuntimeError(f"Unsupported LLM_PROVIDER: {selected}")
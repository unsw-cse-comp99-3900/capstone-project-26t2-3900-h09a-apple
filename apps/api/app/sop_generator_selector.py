"""
Resolve which generator/provider pair is active for a request.
"""

from app.llm_sop_generator import LlmSopGenerator
from app.mock_sop_generator import MockSopGenerator
from app.settings import SettingsError, get_llm_provider
from app.sop_generator import SopGenerator


def get_sop_generator(db=None) -> SopGenerator:
    provider = get_llm_provider()

    if provider == "mock":
        return MockSopGenerator()

    if provider in {"openai", "anthropic"}:
        return LlmSopGenerator(db=db)

    raise SettingsError(f"Unsupported LLM_PROVIDER: {provider}")

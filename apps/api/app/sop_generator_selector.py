from app.mock_sop_generator import MockSopGenerator
from app.settings import SettingsError, get_llm_provider
from app.sop_generator import SopGenerator


def get_sop_generator() -> SopGenerator:
    provider = get_llm_provider()

    if provider == "mock":
        return MockSopGenerator()

    if provider == "llm":
        # later: Link should adding real LLM API
        return MockSopGenerator()

    raise SettingsError(f"Unsupported LLM_PROVIDER: {provider}")

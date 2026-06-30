from typing import Protocol
from decimal import Decimal
from pydantic import BaseModel
from app.sop_schema import SopPayload

# Pricing snapshot as of 2026-07-01.
# Sources:
# - OpenAI pricing: https://openai.com/api/pricing/
# - Anthropic pricing: https://www.anthropic.com/pricing#anthropic-api
MODEL_PRICING_USD_PER_1M_TOKENS = {
    "openai": {
        "gpt-4o": {
            "input": Decimal("5.00"),
            "output": Decimal("15.00"),
        }
    },
    "anthropic": {
        "claude-3-5-sonnet-20241022": {
            "input": Decimal("3.00"),
            "output": Decimal("15.00"),
        }
    },
}

class LlmProviderResult(BaseModel):
    sop: SopPayload
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost_usd: Decimal | None = None

class SopLlmProvider(Protocol):
    name: str

    def generate_sop(self, session_payload: dict) -> LlmProviderResult:
        ...


def estimate_cost_usd(
    provider: str,
    model: str,
    prompt_tokens: int | None,
    completion_tokens: int | None,
) -> Decimal | None:
    if prompt_tokens is None and completion_tokens is None:
        return None

    pricing = MODEL_PRICING_USD_PER_1M_TOKENS.get(provider, {}).get(model)

    if pricing is None:
        return Decimal("0")

    prompt_cost = (
        Decimal(prompt_tokens or 0)
        / Decimal(1_000_000)
        * pricing["input"]
    )
    completion_cost = (
        Decimal(completion_tokens or 0)
        / Decimal(1_000_000)
        * pricing["output"]
    )

    return prompt_cost + completion_cost

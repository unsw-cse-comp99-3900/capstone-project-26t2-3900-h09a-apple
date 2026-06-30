from decimal import Decimal

from app.llm_provider import estimate_cost_usd


def test_estimate_cost_usd_uses_static_pricing_table():
    cost = estimate_cost_usd("openai", "gpt-4o", 1000, 2000)

    assert cost == Decimal("0.035")


def test_estimate_cost_usd_returns_zero_for_unknown_model():
    cost = estimate_cost_usd("openai", "unknown-model", 1000, 2000)

    assert cost == Decimal("0")

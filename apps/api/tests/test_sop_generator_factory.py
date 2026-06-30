import pytest
from app.sop_generator_factory import get_sop_generator
from app.llm_sop_generator import LlmSopGenerator

def test_get_sop_generator_returns_llm_generator():
    generator = get_sop_generator()

    assert isinstance(generator, LlmSopGenerator)


def test_get_sop_generator_passes_db_to_llm():
    db = object()

    generator = get_sop_generator(db=db)

    assert isinstance(generator, LlmSopGenerator)
    assert generator.db is db
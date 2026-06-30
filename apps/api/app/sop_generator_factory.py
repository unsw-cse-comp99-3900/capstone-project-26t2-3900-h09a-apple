from app.llm_sop_generator import LlmSopGenerator
from app.sop_generator import SopGenerator


def get_sop_generator(db=None) -> SopGenerator:
    return LlmSopGenerator(db=db)

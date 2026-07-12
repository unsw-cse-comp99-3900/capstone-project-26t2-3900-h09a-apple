from app.models import Sop, SopStepEmbedding


def test_sop_has_no_whole_sop_embedding_column():
    assert "sop_embedding" not in Sop.__table__.columns


def test_sop_step_embedding_schema_contract():
    table = SopStepEmbedding.__table__

    assert table.name == "sop_step_embedding"
    assert table.c.sop_id.foreign_keys
    assert table.c.step_number.nullable is False
    assert table.c.embedding.type.dim == 1536

    constraints = {constraint.name for constraint in table.constraints}
    assert "uq_sop_step_embedding_sop_step" in constraints
    assert "ck_sop_step_embedding_step_number_pos" in constraints

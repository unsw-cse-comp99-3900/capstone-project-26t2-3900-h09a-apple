from app.models import (
    FrictionAnalysis,
    FrictionEmployeeStepScore,
    FrictionStepAggregate,
)


def test_friction_analysis_schema_contract():
    table = FrictionAnalysis.__table__
    constraints = {constraint.name for constraint in table.constraints}
    indexes = {index.name for index in table.indexes}

    assert table.name == "friction_analysis"
    assert table.c.sop_id.foreign_keys
    assert table.c.tenant_id.nullable is False
    assert "ck_friction_analysis_status" in constraints
    assert "ix_friction_analysis_tenant_sop_triggered" in indexes


def test_employee_step_score_is_unique_per_analysis_employee_step():
    table = FrictionEmployeeStepScore.__table__
    constraints = {constraint.name for constraint in table.constraints}
    indexes = {index.name for index in table.indexes}

    assert "uq_friction_score_analysis_employee_step" in constraints
    assert "ck_friction_score_range" in constraints
    assert "ix_friction_scores_analysis_employee" in indexes


def test_step_aggregate_stores_best_and_worst_employee():
    table = FrictionStepAggregate.__table__
    constraints = {constraint.name for constraint in table.constraints}

    assert table.c.best_employee_id.foreign_keys
    assert table.c.worst_employee_id.foreign_keys
    assert "ck_friction_aggregate_order" in constraints

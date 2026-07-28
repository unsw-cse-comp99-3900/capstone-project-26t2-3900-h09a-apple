from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models import ClusteringResult


def test_clustering_result_schema_contract():
    table = ClusteringResult.__table__

    assert table.name == "clustering_results"
    assert isinstance(table.c.id.type, UUID)
    assert isinstance(table.c.tenant_id.type, UUID)
    assert table.c.workflow_id.foreign_keys
    assert table.c.workflow_id.nullable is False
    assert isinstance(table.c.cluster_centers.type, JSONB)
    assert isinstance(table.c.session_cluster_assignments.type, JSONB)
    assert isinstance(table.c.clusters.type, JSONB)
    assert isinstance(table.c.outliers.type, JSONB)
    assert isinstance(table.c.metadata.type, JSONB)
    assert table.c.silhouette.nullable is True

    constraints = {constraint.name for constraint in table.constraints}
    indexes = {index.name for index in table.indexes}
    assert "ck_clustering_results_k" in constraints
    assert "ix_clustering_results_tenant_workflow_computed" in indexes

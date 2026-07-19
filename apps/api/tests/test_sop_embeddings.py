from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

from app import models
from app.llm_provider import estimate_cost_usd
from app.sop_embeddings import (
    EMBEDDING_DIM,
    EMBEDDING_MODEL,
    MockEmbeddingClient,
    _process_embed_job,
    build_step_embed_text,
    enqueue_embed_job,
    parse_sop_steps,
)


class EmbedFakeQuery:
    def __init__(self, db: EmbedFakeDb, model):
        self.db = db
        self.model = model
        self._filters: list = []

    def filter(self, *criteria):
        self._filters.extend(criteria)
        return self

    def delete(self, synchronize_session=False):
        if self.model is models.SopStepEmbedding:
            sop_id = None
            for criterion in self._filters:
                if getattr(getattr(criterion, "left", None), "key", None) == "sop_id":
                    sop_id = getattr(criterion.right, "value", criterion.right)
            before = len(self.db.embeddings)
            self.db.embeddings = [row for row in self.db.embeddings if row.sop_id != sop_id]
            return before - len(self.db.embeddings)
        return 0

    def count(self):
        return len(self.all())

    def first(self):
        rows = self.all()
        return rows[0] if rows else None

    def all(self):
        if self.model is models.CodificationJob:
            rows = list(self.db.jobs)
        elif self.model is models.Sop:
            rows = list(self.db.sops)
        elif self.model is models.SopStepEmbedding:
            rows = list(self.db.embeddings)
        else:
            rows = []

        for criterion in self._filters:
            key = getattr(getattr(criterion, "left", None), "key", None)
            value = getattr(criterion.right, "value", criterion.right)
            if key is None:
                continue
            rows = [row for row in rows if getattr(row, key, None) == value]
        return rows


class EmbedFakeDb:
    def __init__(self):
        self.jobs: list[models.CodificationJob] = []
        self.sops: list[models.Sop] = []
        self.embeddings: list[models.SopStepEmbedding] = []
        self.audits: list[models.LlmAuditLog] = []
        self.committed = 0

    def add(self, item):
        if isinstance(item, models.CodificationJob):
            self.jobs.append(item)
        elif isinstance(item, models.Sop):
            self.sops.append(item)
        elif isinstance(item, models.SopStepEmbedding):
            if item.id is None:
                item.id = uuid4()
            self.embeddings.append(item)
        elif isinstance(item, models.LlmAuditLog):
            self.audits.append(item)

    def query(self, model):
        return EmbedFakeQuery(self, model)

    def commit(self):
        self.committed += 1

    def rollback(self):
        pass


def _sop_with_steps(step_count: int = 10) -> models.Sop:
    steps = [
        {
            "order": i,
            "title": f"Step {i}",
            "instruction": f"Do action {i}",
            "source_event_ids": [],
        }
        for i in range(1, step_count + 1)
    ]
    return models.Sop(
        id=uuid4(),
        session_id=uuid4(),
        tenant_id=UUID("22222222-2222-2222-2222-222222222222"),
        title="Embed me",
        version=1,
        status=models.SopStatus.published.value,
        steps=steps,
        warnings=[],
        generation_mode="llm",
    )


def test_build_step_embed_text_joins_title_and_instruction():
    assert build_step_embed_text("Open page", "Click login") == "Open page\nClick login"


def test_parse_sop_steps_skips_invalid_entries():
    parsed = parse_sop_steps(
        [
            {"order": 1, "title": "A", "instruction": "Do A"},
            {"order": 0, "title": "Bad", "instruction": "x"},
            {"title": "No order", "instruction": "x"},
            "not-a-dict",
        ]
    )
    assert parsed == [(1, "A", "Do A")]


def test_mock_embedding_is_deterministic_and_1536_dims():
    client = MockEmbeddingClient()
    first = client.embed("Open page\nClick login")
    second = client.embed("Open page\nClick login")
    other = client.embed("Different\nText")

    assert len(first.vector) == EMBEDDING_DIM
    assert first.vector == second.vector
    assert first.vector != other.vector
    assert first.model == EMBEDDING_MODEL


def test_embedding_pricing_for_text_embedding_3_small():
    cost = estimate_cost_usd("openai", "text-embedding-3-small", 1000, None)
    assert cost == Decimal("0.02") * Decimal("1000") / Decimal("1000000")


def test_enqueue_embed_job_sets_pending_status():
    db = EmbedFakeDb()
    sop = _sop_with_steps(2)
    db.sops.append(sop)

    job = enqueue_embed_job(db, sop)

    assert job.job_type == models.CodificationJobType.embed.value
    assert job.sop_id == sop.id
    assert job.session_id == sop.session_id
    assert sop.embedding_status == models.EmbeddingStatus.pending.value
    assert job in db.jobs


def test_process_embed_job_writes_one_row_per_step(monkeypatch):
    monkeypatch.setattr("app.sop_embeddings.time.sleep", lambda *_args, **_kwargs: None)
    db = EmbedFakeDb()
    sop = _sop_with_steps(10)
    db.sops.append(sop)
    job = enqueue_embed_job(db, sop)
    db.commit()

    _process_embed_job(db, job.id, MockEmbeddingClient())

    assert len(db.embeddings) == 10
    assert {row.step_number for row in db.embeddings} == set(range(1, 11))
    assert all(len(row.embedding) == EMBEDDING_DIM for row in db.embeddings)
    assert sop.embedding_status == models.EmbeddingStatus.complete.value
    assert job.status == models.CodificationJobStatus.completed.value
    assert len(db.audits) == 10
    assert all(audit.model == EMBEDDING_MODEL for audit in db.audits)
    assert all(audit.status == "success" for audit in db.audits)


def test_process_embed_job_marks_failed_after_retries(monkeypatch):
    sleeps: list[int] = []
    monkeypatch.setattr(
        "app.sop_embeddings.time.sleep",
        lambda seconds: sleeps.append(seconds),
    )

    class FailingClient:
        model = EMBEDDING_MODEL

        def embed(self, text: str):
            raise RuntimeError("upstream down")

    db = EmbedFakeDb()
    sop = _sop_with_steps(1)
    db.sops.append(sop)
    job = enqueue_embed_job(db, sop)
    db.commit()

    _process_embed_job(db, job.id, FailingClient())

    assert sop.embedding_status == models.EmbeddingStatus.failed.value
    assert job.status == models.CodificationJobStatus.failed.value
    assert db.embeddings == []
    assert len(db.audits) == 4  # initial + 3 retries
    assert sleeps == [1, 2, 4]


def test_process_embed_job_replaces_previous_embeddings(monkeypatch):
    monkeypatch.setattr("app.sop_embeddings.time.sleep", lambda *_args, **_kwargs: None)
    db = EmbedFakeDb()
    sop = _sop_with_steps(2)
    db.sops.append(sop)
    db.embeddings.append(
        models.SopStepEmbedding(
            id=uuid4(),
            sop_id=sop.id,
            step_number=99,
            embedding=[0.0] * EMBEDDING_DIM,
        )
    )
    job = enqueue_embed_job(db, sop)
    db.commit()

    _process_embed_job(db, job.id, MockEmbeddingClient())

    assert {row.step_number for row in db.embeddings} == {1, 2}
    assert sop.embedding_status == models.EmbeddingStatus.complete.value


def test_process_embed_job_records_tokens_and_cost(monkeypatch):
    monkeypatch.setattr("app.sop_embeddings.time.sleep", lambda *_args, **_kwargs: None)
    db = EmbedFakeDb()
    sop = _sop_with_steps(1)
    db.sops.append(sop)
    job = enqueue_embed_job(db, sop)
    db.commit()

    _process_embed_job(db, job.id, MockEmbeddingClient())

    assert len(db.audits) == 1
    audit = db.audits[0]
    assert audit.provider == "openai"
    assert audit.model == EMBEDDING_MODEL
    assert audit.prompt_tokens is not None and audit.prompt_tokens >= 1
    assert audit.cost_usd is not None and audit.cost_usd >= Decimal("0")
    assert audit.session_id == sop.session_id


def test_process_embed_job_fails_when_sop_has_no_valid_steps(monkeypatch):
    monkeypatch.setattr("app.sop_embeddings.time.sleep", lambda *_args, **_kwargs: None)
    db = EmbedFakeDb()
    sop = _sop_with_steps(1)
    sop.steps = [{"order": 1, "title": "", "instruction": ""}]
    db.sops.append(sop)
    job = enqueue_embed_job(db, sop)
    db.commit()

    _process_embed_job(db, job.id, MockEmbeddingClient())

    assert sop.embedding_status == models.EmbeddingStatus.failed.value
    assert job.status == models.CodificationJobStatus.failed.value
    assert db.embeddings == []


def test_process_embed_job_fails_when_later_step_fails(monkeypatch):
    monkeypatch.setattr("app.sop_embeddings.time.sleep", lambda *_args, **_kwargs: None)
    calls = {"n": 0}

    class FlakyClient:
        model = EMBEDDING_MODEL

        def embed(self, text: str):
            calls["n"] += 1
            if calls["n"] == 1:
                return MockEmbeddingClient().embed(text)
            raise RuntimeError("step 2 failed")

    db = EmbedFakeDb()
    sop = _sop_with_steps(2)
    db.sops.append(sop)
    job = enqueue_embed_job(db, sop)
    db.commit()

    _process_embed_job(db, job.id, FlakyClient())

    assert sop.embedding_status == models.EmbeddingStatus.failed.value
    assert job.status == models.CodificationJobStatus.failed.value
    assert len(db.embeddings) == 1


def test_get_embedding_client_defaults_to_mock(monkeypatch):
    from app.sop_embeddings import get_embedding_client

    monkeypatch.setenv("LLM_PROVIDER", "mock")
    client = get_embedding_client()
    assert isinstance(client, MockEmbeddingClient)

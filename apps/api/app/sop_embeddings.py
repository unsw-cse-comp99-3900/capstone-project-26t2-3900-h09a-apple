from __future__ import annotations

import hashlib
import os
import struct
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy.orm import Session as DBSession

from app import models
from app.database import get_sessionmaker
from app.llm_provider import estimate_cost_usd
from app.openai_client import create_openai_compatible_client

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
EMBED_MAX_RETRIES = 3
EMBED_PROVIDER_NAME = "openai"


@dataclass(frozen=True)
class EmbeddingResult:
    vector: list[float]
    prompt_tokens: int | None
    model: str


class EmbeddingClient(Protocol):
    def embed(self, text: str) -> EmbeddingResult: ...


class MockEmbeddingClient:
    """Deterministic 1536-d vectors for CI / LLM_PROVIDER=mock."""

    model = EMBEDDING_MODEL

    def embed(self, text: str) -> EmbeddingResult:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        values: list[float] = []
        seed = digest
        while len(values) < EMBEDDING_DIM:
            seed = hashlib.sha256(seed).digest()
            for i in range(0, len(seed), 4):
                if len(values) >= EMBEDDING_DIM:
                    break
                chunk = seed[i : i + 4]
                if len(chunk) < 4:
                    break
                raw = struct.unpack(">I", chunk)[0]
                values.append((raw / 0xFFFFFFFF) * 2.0 - 1.0)
        return EmbeddingResult(
            vector=values, prompt_tokens=max(1, len(text.split())), model=self.model
        )


class OpenAiEmbeddingClient:
    def __init__(self, model: str = EMBEDDING_MODEL) -> None:
        self.model = model
        self._client = create_openai_compatible_client()

    def embed(self, text: str) -> EmbeddingResult:
        response = self._client.embeddings.create(model=self.model, input=text)
        item = response.data[0]
        usage = getattr(response, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", None) if usage is not None else None
        return EmbeddingResult(
            vector=list(item.embedding),
            prompt_tokens=prompt_tokens,
            model=self.model,
        )


def get_embedding_client() -> EmbeddingClient:
    provider = os.getenv("LLM_PROVIDER", "mock").strip().lower()
    if provider in {"", "mock"}:
        return MockEmbeddingClient()
    return OpenAiEmbeddingClient()


def build_step_embed_text(title: str, instruction: str) -> str:
    return f"{title}\n{instruction}"


def parse_sop_steps(steps_payload: object) -> list[tuple[int, str, str]]:
    if not isinstance(steps_payload, list):
        return []

    parsed: list[tuple[int, str, str]] = []
    for raw in steps_payload:
        if not isinstance(raw, dict):
            continue
        order = raw.get("order")
        title = raw.get("title")
        instruction = raw.get("instruction")
        if not isinstance(order, int) or order < 1:
            continue
        if not isinstance(title, str) or not title.strip():
            continue
        if not isinstance(instruction, str) or not instruction.strip():
            continue
        parsed.append((order, title.strip(), instruction.strip()))
    return parsed


def enqueue_embed_job(db: DBSession, sop: models.Sop) -> models.CodificationJob:
    job = models.CodificationJob(
        id=uuid4(),
        session_id=sop.session_id,
        sop_id=sop.id,
        job_type=models.CodificationJobType.embed.value,
        status=models.CodificationJobStatus.pending.value,
    )
    sop.embedding_status = models.EmbeddingStatus.pending.value
    db.add(job)
    return job


def process_embed_job(job_id: str) -> None:
    """Background entrypoint: open a fresh DB session and embed all steps."""
    db = get_sessionmaker()()
    try:
        _process_embed_job(db, UUID(job_id), get_embedding_client())
    finally:
        db.close()


def _process_embed_job(
    db: DBSession,
    job_id: UUID,
    client: EmbeddingClient,
) -> None:
    job = db.query(models.CodificationJob).filter(models.CodificationJob.id == job_id).first()
    if job is None or job.job_type != models.CodificationJobType.embed.value:
        return
    if job.sop_id is None:
        job.status = models.CodificationJobStatus.failed.value
        job.updated_at = datetime.now(UTC)
        db.commit()
        return

    sop = db.query(models.Sop).filter(models.Sop.id == job.sop_id).first()
    if sop is None:
        job.status = models.CodificationJobStatus.failed.value
        job.updated_at = datetime.now(UTC)
        db.commit()
        return

    job.status = models.CodificationJobStatus.processing.value
    job.updated_at = datetime.now(UTC)
    sop.embedding_status = models.EmbeddingStatus.pending.value
    db.commit()

    steps = parse_sop_steps(sop.steps)
    if not steps:
        sop.embedding_status = models.EmbeddingStatus.failed.value
        job.status = models.CodificationJobStatus.failed.value
        job.updated_at = datetime.now(UTC)
        db.commit()
        return

    # Embed every step before mutating stored rows so a mid-run failure cannot
    # wipe a previously complete set or leave a partial replacement.
    embedded_steps: list[tuple[int, list[float]]] = []
    try:
        for step_number, title, instruction in steps:
            text = build_step_embed_text(title, instruction)
            result = _embed_with_retries(db, sop=sop, client=client, text=text)
            embedded_steps.append((step_number, result.vector))
    except Exception:
        sop.embedding_status = models.EmbeddingStatus.failed.value
        job.status = models.CodificationJobStatus.failed.value
        job.updated_at = datetime.now(UTC)
        db.commit()
        return

    if len(embedded_steps) != len(steps):
        sop.embedding_status = models.EmbeddingStatus.failed.value
        job.status = models.CodificationJobStatus.failed.value
        job.updated_at = datetime.now(UTC)
        db.commit()
        return

    db.query(models.SopStepEmbedding).filter(models.SopStepEmbedding.sop_id == sop.id).delete(
        synchronize_session=False
    )
    for step_number, vector in embedded_steps:
        db.add(
            models.SopStepEmbedding(
                sop_id=sop.id,
                step_number=step_number,
                embedding=vector,
            )
        )
    sop.embedding_status = models.EmbeddingStatus.complete.value
    job.status = models.CodificationJobStatus.completed.value
    job.updated_at = datetime.now(UTC)
    db.commit()


def _embed_with_retries(
    db: DBSession,
    *,
    sop: models.Sop,
    client: EmbeddingClient,
    text: str,
) -> EmbeddingResult:
    last_error: Exception | None = None
    for attempt in range(EMBED_MAX_RETRIES + 1):
        started = time.perf_counter()
        try:
            result = client.embed(text)
            latency_ms = int((time.perf_counter() - started) * 1000)
            cost = estimate_cost_usd(
                EMBED_PROVIDER_NAME,
                result.model,
                result.prompt_tokens,
                None,
            )
            _log_embed_audit(
                db,
                session_id=sop.session_id,
                status="success",
                attempt=attempt + 1,
                latency_ms=latency_ms,
                model=result.model,
                prompt_tokens=result.prompt_tokens,
                cost_usd=cost,
            )
            db.commit()
            return result
        except Exception as exc:
            last_error = exc
            latency_ms = int((time.perf_counter() - started) * 1000)
            _log_embed_audit(
                db,
                session_id=sop.session_id,
                status="error",
                attempt=attempt + 1,
                latency_ms=latency_ms,
                model=getattr(client, "model", EMBEDDING_MODEL),
                error_message=str(exc),
            )
            db.commit()
            if attempt < EMBED_MAX_RETRIES:
                time.sleep(2**attempt)

    assert last_error is not None
    raise last_error


def _log_embed_audit(
    db: DBSession,
    *,
    session_id: UUID,
    status: str,
    attempt: int,
    latency_ms: int,
    model: str,
    prompt_tokens: int | None = None,
    cost_usd: Decimal | None = None,
    error_message: str | None = None,
) -> None:
    db.add(
        models.LlmAuditLog(
            session_id=session_id,
            provider=EMBED_PROVIDER_NAME,
            model=model,
            status=status,
            attempt=attempt,
            latency_ms=latency_ms,
            prompt_tokens=prompt_tokens,
            completion_tokens=None,
            cost_usd=cost_usd,
            error_message=error_message,
        )
    )

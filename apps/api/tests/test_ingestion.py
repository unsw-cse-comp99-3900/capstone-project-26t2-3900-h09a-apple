from app.ingestion import ingest_session
from app.models import CodificationJobStatus, SessionStatus
from app.session_schema import SessionPayload


class FakeDb:
    def __init__(self):
        self.added = []
        self.flushed = False

    def add(self, item):
        self.added.append(item)

    def flush(self):
        self.flushed = True


def test_ingest_session_adds_session_and_sorted_masked_events(monkeypatch):
    monkeypatch.setenv("DEFAULT_TENANT_ID", "22222222-2222-2222-2222-222222222222")
    db = FakeDb()

    payload = SessionPayload.model_validate(
        {
            "client_session_id": "11111111-1111-1111-1111-111111111111",
            "workflow_name": "Login flow",
            "started_at": "2026-06-16T12:30:00Z",
            "events": [
                {
                    "type": "input",
                    "value": "user@example.com",
                    "timestamp_ms": 1781613000100,
                },
                {
                    "type": "navigation",
                    "url": "https://example.com/login?token=abc123",
                    "timestamp_ms": 1781613000000,
                },
            ],
        }
    )

    result = ingest_session(payload, db)
    session = db.added[0]
    job = db.added[1]

    assert result.session_id == str(session.id)
    assert result.job_id == str(job.id)
    assert result.masked_payload.events[0].value == "[EMAIL]"
    assert db.flushed is True
    assert session.client_session_id == payload.client_session_id
    assert str(session.tenant_id) == "22222222-2222-2222-2222-222222222222"
    assert session.status == SessionStatus.submitted.value
    assert session.event_count == 2
    assert [event.seq for event in session.events] == [0, 1]
    assert [event.timestamp_ms for event in session.events] == [1781613000000, 1781613000100]
    assert session.events[0].url == "https://example.com/login?token=[REDACTED]"
    assert session.events[1].value == "[EMAIL]"
    assert result.job_id == str(job.id)
    assert len(db.added) == 2
    assert job.session_id == session.id
    assert job.status == CodificationJobStatus.pending.value

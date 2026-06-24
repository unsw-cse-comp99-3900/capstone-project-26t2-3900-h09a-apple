import pytest

from app import database


def clear_database_caches() -> None:
    database.get_engine.cache_clear()
    database.get_sessionmaker.cache_clear()


def test_get_database_url_requires_database_url(monkeypatch):
    clear_database_caches()
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(database.DatabaseConfigError, match="DATABASE_URL is not configured"):
        database.get_database_url()


def test_get_engine_uses_database_url(monkeypatch):
    clear_database_caches()
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://worktrace:secret@localhost:5432/worktrace_test",
    )

    engine = database.get_engine()

    assert engine.url.database == "worktrace_test"

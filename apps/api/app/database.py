"""
SQLAlchemy engine/session factory wired from DATABASE_URL.
"""

from __future__ import annotations

import os
from collections.abc import Generator
from functools import lru_cache

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()


class DatabaseConfigError(RuntimeError):
    pass


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise DatabaseConfigError("DATABASE_URL is not configured")
    return database_url


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_database_url(), pool_pre_ping=True)


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        autocommit=False,
    )


def get_db() -> Generator[Session]:
    db = get_sessionmaker()()
    try:
        yield db
    finally:
        db.close()

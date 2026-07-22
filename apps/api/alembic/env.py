"""Alembic environment for the H09A Apple FastAPI backend.

The DB URL is read from the ``DATABASE_URL`` environment variable so the same
script works locally, in CI, and in deploys. ``alembic.ini``'s
``sqlalchemy.url`` is intentionally left blank.

``target_metadata`` is wired to ``app.models.Base.metadata`` so
``alembic revision --autogenerate`` can diff future schema changes against the
ORM definitions.
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

from alembic import context
from app.models import Base

load_dotenv()

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = os.getenv("DATABASE_URL")
if database_url:
    # Alembic stores options in ConfigParser, where percent signs trigger
    # interpolation. URL-encoded credentials contain values such as ``%5B``;
    # escape them here so the database URL reaches SQLAlchemy unchanged.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting to a DB."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Connect to the configured DB and apply migrations."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
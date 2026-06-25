import pytest
from passlib.context import CryptContext


@pytest.fixture(autouse=True)
def secret_key(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-for-ci-only-32chars")


@pytest.fixture(autouse=True)
def fast_bcrypt():
    from app.auth import password as password_module

    password_module.pwd_context = CryptContext(
        schemes=["bcrypt"],
        bcrypt__rounds=4,
        deprecated="auto",
    )

from __future__ import annotations

from uuid import uuid4

from app.friction_notifications import friction_channel, publish_friction_update


def test_friction_channel_formats_tenant():
    tenant = uuid4()
    assert friction_channel(tenant) == f"friction:updates:{tenant}"
    assert friction_channel(str(tenant)) == f"friction:updates:{tenant}"


def test_publish_friction_update_success(monkeypatch):
    published = {}

    class _Client:
        def publish(self, channel, payload):
            published["channel"] = channel
            published["payload"] = payload
            return 1

        def close(self):
            published["closed"] = True

    class _Redis:
        @staticmethod
        def from_url(_url):
            return _Client()

    monkeypatch.setattr("app.friction_notifications.redis.Redis", _Redis)

    tenant = uuid4()
    publish_friction_update(tenant, {"event": "done"})
    assert published["channel"] == friction_channel(tenant)
    assert '"event": "done"' in published["payload"]
    assert published["closed"] is True


def test_publish_friction_update_swallows_errors(monkeypatch):
    class _Redis:
        @staticmethod
        def from_url(_url):
            raise RuntimeError("redis down")

    monkeypatch.setattr("app.friction_notifications.redis.Redis", _Redis)
    publish_friction_update(uuid4(), {"event": "x"})

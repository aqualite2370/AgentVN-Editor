import io
import json
from urllib import error

from fastapi.testclient import TestClient

from app.main import app


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def test_test_provider_connection_discovers_models(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.ai.provider.request.urlopen",
        lambda req, timeout=12: FakeResponse({"data": [{"id": "gpt-4o-mini"}, {"id": "gpt-4.1"}]}),
    )
    client = TestClient(app)
    response = client.post(
        "/api/providers/test_connection",
        json={"base_url": "https://example.com/v1", "api_key": "test-key"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["supports_model_discovery"] is True
    assert [item["model_id"] for item in payload["models"]] == ["gpt-4o-mini", "gpt-4.1"]


def test_test_provider_connection_discovers_models_with_v1_fallback(monkeypatch) -> None:
    requested_urls: list[str] = []

    def fake_urlopen(req, timeout=12):
        requested_urls.append(req.full_url)
        if req.full_url == "https://example.com/models":
            raise error.HTTPError(
                url=req.full_url,
                code=404,
                msg="Not Found",
                hdrs=None,
                fp=io.BytesIO(b""),
            )
        return FakeResponse({"data": [{"id": "deepseek-chat"}, {"id": "deepseek-reasoner"}]})

    monkeypatch.setattr("app.ai.provider.request.urlopen", fake_urlopen)
    client = TestClient(app)
    response = client.post(
        "/api/providers/test_connection",
        json={"base_url": "https://example.com", "api_key": "test-key"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["base_url"] == "https://example.com/v1"
    assert [item["model_id"] for item in payload["models"]] == ["deepseek-chat", "deepseek-reasoner"]
    assert requested_urls == ["https://example.com/models", "https://example.com/v1/models"]


def test_test_provider_connection_alias_route(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.ai.provider.request.urlopen",
        lambda req, timeout=12: FakeResponse({"data": [{"id": "gpt-4o-mini"}]}),
    )
    client = TestClient(app)
    response = client.post(
        "/api/providers/test-connection",
        json={"base_url": "https://example.com/v1", "api_key": "test-key"},
    )
    assert response.status_code == 200
    assert response.json()["models"][0]["model_id"] == "gpt-4o-mini"


def test_provider_namespace_root_is_not_a_public_endpoint() -> None:
    client = TestClient(app)
    response = client.get("/api/providers")
    assert response.status_code == 404


def test_test_provider_connection_handles_manual_model_fallback(monkeypatch) -> None:
    def raise_http_error(req, timeout=12):
        raise error.HTTPError(
            url="https://example.com/v1/models",
            code=404,
            msg="Not Found",
            hdrs=None,
            fp=io.BytesIO(b""),
        )

    monkeypatch.setattr("app.ai.provider.request.urlopen", raise_http_error)
    client = TestClient(app)
    response = client.post(
        "/api/providers/test_connection",
        json={"base_url": "https://example.com/v1", "api_key": "test-key"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["supports_model_discovery"] is False
    assert payload["models"] == []

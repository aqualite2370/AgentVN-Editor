from collections.abc import Iterator

from fastapi.testclient import TestClient

from app.api import routes_novel_ws
from app.core.errors import AIProviderError
from app.main import create_app


def _fake_scan_stream(_request: object) -> Iterator[tuple[str, object]]:
    yield ("status", "scan started")
    yield ("delta", "hello")
    yield ("checkpoint", {"stage": "summary", "payload": {"summary": "ok"}})
    yield ("final", {"chunk_id": "chunk_1", "summary": "ok", "warnings": []})


def _fake_failure_stream(_request: object) -> Iterator[tuple[str, object]]:
    yield ("status", "scan started")
    raise AIProviderError("provider rejected token sk-secret1234567890")


def test_novel_websocket_streams_and_replays(monkeypatch) -> None:
    monkeypatch.setattr(routes_novel_ws.service, "stream_ai_scan_chunk", _fake_scan_stream)
    client = TestClient(create_app())
    job_id = "novel_job_ws_test"
    payload = {
        "document_id": "doc_1",
        "chunk_id": "chunk_1",
        "index": 0,
        "text": "hello",
        "start_offset": 0,
        "end_offset": 5,
    }

    with client.websocket_connect("/api/ws/novel") as websocket:
        assert websocket.receive_json()["type"] == "connected"
        websocket.send_json(
            {
                "command": "start_novel_job",
                "jobId": job_id,
                "requestId": "request_1",
                "operation": "scan_chunk",
                "payload": payload,
            }
        )

        seen: list[dict[str, object]] = []
        for _ in range(10):
            event = websocket.receive_json()
            seen.append(event)
            if event["type"] == "final":
                break

    assert [event["type"] for event in seen] == [
        "lifecycle",
        "agent_started",
        "lifecycle",
        "message_delta",
        "checkpoint",
        "final",
    ]
    assert seen[-1]["payload"] == {"chunk_id": "chunk_1", "summary": "ok", "warnings": []}

    with client.websocket_connect("/api/ws/novel") as websocket:
        assert websocket.receive_json()["type"] == "connected"
        websocket.send_json({"command": "subscribe_job", "jobId": job_id, "lastSeq": 3})
        replayed = websocket.receive_json()

    assert replayed["type"] == "message_delta"
    assert replayed["seq"] == 4


def test_novel_websocket_returns_diagnostic_sanitized_error(monkeypatch) -> None:
    monkeypatch.setattr(routes_novel_ws.service, "stream_ai_scan_chunk", _fake_failure_stream)
    client = TestClient(create_app())

    with client.websocket_connect("/api/ws/novel") as websocket:
        assert websocket.receive_json()["type"] == "connected"
        websocket.send_json(
            {
                "command": "start_novel_job",
                "jobId": "novel_job_ws_failure_test",
                "requestId": "request_failure",
                "operation": "scan_chunk",
                "payload": {
                    "document_id": "doc_1",
                    "chunk_id": "chunk_1",
                    "index": 0,
                    "text": "hello",
                    "start_offset": 0,
                    "end_offset": 5,
                },
            }
        )

        error_event = None
        for _ in range(8):
            event = websocket.receive_json()
            if event["type"] == "error":
                error_event = event
                break

    assert error_event is not None
    assert error_event["payload"]["code"] == "ai_provider_error"
    assert error_event["payload"]["operation"] == "scan_chunk"
    assert error_event["payload"]["exceptionType"] == "AIProviderError"
    assert "sk-***" in error_event["payload"]["message"]
    assert "sk-secret1234567890" not in error_event["payload"]["message"]

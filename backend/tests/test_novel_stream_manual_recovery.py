"""Novel recovery is an explicit user action, never a second paid request."""
import json
from types import SimpleNamespace

import pytest
from openai import APIConnectionError
from httpx import Request

from app.ai.provider import AIProvider
from app.core.errors import AIProviderError
from app.models.novel_import import NovelAiOutlineMainline
from app.schemas.requests import ProviderSelectionRequest


@pytest.mark.parametrize("failure", ["schema", "transport"])
def test_novel_json_failure_does_not_implicitly_request_again(monkeypatch, failure):
    provider = AIProvider()
    calls = []
    result = dict(document_id="doc", title="测试", summary="摘要", main_plot="主线" * 601)

    def create(**kwargs):
        calls.append(kwargs.get("stream", False))
        if failure == "transport":
            raise APIConnectionError(request=Request("POST", "https://example.test/v1/chat/completions"))
        content = json.dumps(result, ensure_ascii=False)
        return iter([SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=content), finish_reason="stop")])])

    monkeypatch.setattr("app.ai.provider.OpenAI", lambda **kwargs: SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    selection = ProviderSelectionRequest(connection_id="controlled", model_id="test",
        base_url="https://example.test/v1", api_key="synthetic",
        parameters={"structured_mode": "json_object"})
    with pytest.raises(AIProviderError):
        list(provider.stream_with_tools(NovelAiOutlineMainline, "system", "user", selection=selection))
    assert calls == [True], "Failures must stop after one request and retain the saved checkpoint"

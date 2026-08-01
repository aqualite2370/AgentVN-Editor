"""Assistant chat routes."""

from collections.abc import Iterator
import json
import logging
import re

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.ai.context_budget import pack_text_context
from app.ai.provider import AIProvider
from app.api.deps import get_ai_provider
from app.core.errors import AIProviderError
from app.core.error_logging import log_exception
from app.schemas.requests import AssistantChatRequest
from app.schemas.responses import AssistantChatResponse, AssistantCitationResponse

router = APIRouter()
logger = logging.getLogger("agentvn.backend.assistant")

ASSISTANT_SYSTEM_PROMPT = """你是 AgentVN 编辑器内的大模型助手。
你必须优先依据随请求提供的 AgentVN 文档片段回答，帮助用户理解编辑器功能、控件用途、项目工作流和实现某种效果的操作路径。
如果文档没有足够依据，请明确说明“不确定”或“当前文档没有覆盖”，不要编造不存在的按钮、接口或流程。
回答要用中文，面向正在使用编辑器的创作者，给出可执行步骤和必要提醒。
不要声称你已经实际修改了项目；你只提供建议。
"""


def build_context_text(request: AssistantChatRequest) -> str:
    chunks = []
    for index, chunk in enumerate(request.context_chunks, start=1):
        tags = f" 标签：{', '.join(chunk.tags)}" if chunk.tags else ""
        chunks.append(
            f"[{index}] {chunk.title}\n来源：{chunk.source}{tags}\n{chunk.text}"
        )
    editor_context = request.editor_context or "未提供当前编辑器上下文。"
    return "\n\n".join(
        [
            "当前编辑器上下文：",
            editor_context,
            "可参考的 AgentVN 文档片段：",
            "\n\n".join(chunks) if chunks else "未检索到相关文档片段。",
        ]
    )


def packed_context_text(request: AssistantChatRequest) -> tuple[str, dict[str, object]]:
    packed = pack_text_context(
        build_context_text(request),
        request.provider_selection,
        note="Assistant context combines selected docs, editor state and short chat history.",
    )
    return packed.text, packed.report


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sanitize_stream_error(message: str) -> str:
    sanitized = re.sub(r"sk-[A-Za-z0-9_\-]{6,}", "sk-***", message)
    sanitized = re.sub(r"(Bearer\s+)[^\s\"']+", r"\1***", sanitized, flags=re.IGNORECASE)
    return sanitized[:1200] or "助手请求失败。"


def _assistant_messages(request: AssistantChatRequest) -> list[dict[str, str]]:
    history = [
        {"role": message.role, "content": message.content}
        for message in request.messages[-12:]
        if message.content.strip()
    ]
    context_text, _report = packed_context_text(request)
    return [
        {"role": "user", "content": context_text},
        *history,
        {"role": "user", "content": request.question},
    ]


def _assistant_citations(request: AssistantChatRequest) -> list[AssistantCitationResponse]:
    return [
        AssistantCitationResponse(id=chunk.id, source=chunk.source, title=chunk.title)
        for chunk in request.context_chunks
    ]


@router.post("/assistant/chat", response_model=AssistantChatResponse)
def assistant_chat(
    request: AssistantChatRequest,
    provider: AIProvider = Depends(get_ai_provider),
) -> AssistantChatResponse:
    answer = provider.create_chat(
        ASSISTANT_SYSTEM_PROMPT,
        _assistant_messages(request),
        selection=request.provider_selection,
    )
    return AssistantChatResponse(answer=answer, citations=_assistant_citations(request))


def _stream_assistant_events(request: AssistantChatRequest, provider: AIProvider) -> Iterator[str]:
    citations = _assistant_citations(request)
    try:
        yield _sse("status", f"已检索 {len(request.context_chunks)} 条 AgentVN 文档片段，正在请求模型...")
        answer = provider.create_chat(
            ASSISTANT_SYSTEM_PROMPT,
            _assistant_messages(request),
            selection=request.provider_selection,
        )
        if answer:
            yield _sse("delta", answer)
        yield _sse("citations", [citation.model_dump(mode="json") for citation in citations])
        yield _sse("final", AssistantChatResponse(answer=answer, citations=citations).model_dump(mode="json"))
        yield _sse("done", {"ok": True})
    except Exception as exc:
        log_exception(logger, "助手流式接口失败", exc)
        message = str(exc) if isinstance(exc, AIProviderError) else "助手流式请求失败，请查看后端日志。"
        yield _sse("error", {"message": _sanitize_stream_error(message)})
        yield _sse("done", {"ok": False})


@router.post("/assistant/chat_stream")
def assistant_chat_stream(
    request: AssistantChatRequest,
    provider: AIProvider = Depends(get_ai_provider),
) -> StreamingResponse:
    return StreamingResponse(
        _stream_assistant_events(request, provider),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )

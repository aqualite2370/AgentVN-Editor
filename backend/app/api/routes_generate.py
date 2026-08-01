"""Generation routes."""

from collections.abc import Iterator
import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import get_generation_service
from app.core.errors import AIProviderError
from app.core.error_logging import log_exception
from app.models.memory import MemoryUpdate
from app.models.scene import SceneBeat
from app.schemas.requests import ExtractMemoryRequest, GenerateSceneRequest
from app.services.generation_service import GenerationService

router = APIRouter()
logger = logging.getLogger("agentvn.backend.generate")


@router.post("/generate_scene", response_model=SceneBeat)
def generate_scene(
    request: GenerateSceneRequest,
    service: GenerationService = Depends(get_generation_service),
) -> SceneBeat:
    return service.generate_scene(request)


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stream_events(events: Iterator[tuple[str, object]]) -> Iterator[str]:
    try:
        yield _sse("start", {"ok": True})
        for event, payload in events:
            if hasattr(payload, "model_dump"):
                yield _sse(event, payload.model_dump(mode="json"))  # type: ignore[attr-defined]
            else:
                yield _sse(event, payload)
        yield _sse("done", {"ok": True})
    except Exception as exc:
        log_exception(logger, "剧情生成流式接口失败", exc)
        message = str(exc)
        if isinstance(exc, AIProviderError):
            yield _sse("error", {"message": message})
        else:
            yield _sse("error", {"message": "流式生成失败，请查看后端日志。"})
        yield _sse("done", {"ok": False})


@router.post("/generate_scene_stream")
def generate_scene_stream(
    request: GenerateSceneRequest,
    service: GenerationService = Depends(get_generation_service),
) -> StreamingResponse:
    return StreamingResponse(
        _stream_events(service.stream_generate_scene(request)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/extract_memory", response_model=MemoryUpdate)
def extract_memory(
    request: ExtractMemoryRequest,
    service: GenerationService = Depends(get_generation_service),
) -> MemoryUpdate:
    return service.extract_memory_updates(request)


@router.post("/extract_memory_stream")
def extract_memory_stream(
    request: ExtractMemoryRequest,
    service: GenerationService = Depends(get_generation_service),
) -> StreamingResponse:
    return StreamingResponse(
        _stream_events(service.stream_extract_memory_updates(request)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )

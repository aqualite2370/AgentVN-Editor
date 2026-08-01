"""Novel import routes."""

from collections.abc import Iterator
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models.novel_import import (
    AdaptSceneRequest,
    AdaptSceneResponse,
    AnalyzeChunkRequest,
    AnalyzeChunkResponse,
    BatchAdaptRequest,
    BatchAdaptResponse,
    ExtractCharactersRequest,
    ExtractCharactersResponse,
    NovelAiAdaptSceneRequest,
    NovelAiChunkAnalysis,
    NovelAiChunkRequest,
    NovelAiOutlineRequest,
    NovelAiOutlineResponse,
    NovelAiPlanChapterRequest,
    NovelAiScenePlanResponse,
    SplitSceneRequest,
    SplitSceneResponse,
)
from app.services.novel_import_service import NovelImportService
from app.core.error_logging import log_exception, sanitize_log_text

router = APIRouter()
service = NovelImportService()
logger = logging.getLogger("agentvn.backend.novel_import")


def _ai_error(label: str, exc: Exception) -> HTTPException:
    log_exception(logger, f"{label}失败", exc)
    return HTTPException(status_code=502, detail=f"{label}失败：{exc}")


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
        log_exception(logger, "小说导入流式接口失败", exc)
        yield _sse("error", {"message": sanitize_log_text(exc)})
        yield _sse("done", {"ok": False})


def _streaming_response(events: Iterator[tuple[str, object]]) -> StreamingResponse:
    return StreamingResponse(
        _stream_events(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/novel/import/analyze_chunk", response_model=AnalyzeChunkResponse)
def analyze_chunk(request: AnalyzeChunkRequest) -> AnalyzeChunkResponse:
    return service.analyze_chunk(request)


@router.post("/novel/import/split_scene", response_model=SplitSceneResponse)
def split_scene(request: SplitSceneRequest) -> SplitSceneResponse:
    return service.split_scene(request)


@router.post("/novel/import/adapt_scene", response_model=AdaptSceneResponse)
def adapt_scene(request: AdaptSceneRequest) -> AdaptSceneResponse:
    return service.adapt_scene(request)


@router.post("/novel/import/ai_scan_chunk", response_model=NovelAiChunkAnalysis)
def ai_scan_chunk(request: NovelAiChunkRequest) -> NovelAiChunkAnalysis:
    try:
        return service.ai_scan_chunk(request)
    except Exception as exc:
        raise _ai_error("小说 AI 分块扫描", exc) from exc


@router.post("/novel/import/ai_scan_chunk_stream")
def ai_scan_chunk_stream(request: NovelAiChunkRequest) -> StreamingResponse:
    return _streaming_response(service.stream_ai_scan_chunk(request))


@router.post("/novel/import/ai_build_outline", response_model=NovelAiOutlineResponse)
def ai_build_outline(request: NovelAiOutlineRequest) -> NovelAiOutlineResponse:
    try:
        return service.ai_build_outline(request)
    except Exception as exc:
        raise _ai_error("小说 AI 大纲合成", exc) from exc


@router.post("/novel/import/ai_build_outline_stream")
def ai_build_outline_stream(request: NovelAiOutlineRequest) -> StreamingResponse:
    return _streaming_response(service.stream_ai_build_outline(request))


@router.post("/novel/import/ai_plan_chapter", response_model=NovelAiScenePlanResponse)
def ai_plan_chapter(request: NovelAiPlanChapterRequest) -> NovelAiScenePlanResponse:
    try:
        return service.ai_plan_chapter(request)
    except Exception as exc:
        raise _ai_error("小说 AI 场景规划", exc) from exc


@router.post("/novel/import/ai_plan_chapter_stream")
def ai_plan_chapter_stream(request: NovelAiPlanChapterRequest) -> StreamingResponse:
    return _streaming_response(service.stream_ai_plan_chapter(request))


@router.post("/novel/import/ai_adapt_scene", response_model=AdaptSceneResponse)
def ai_adapt_scene(request: NovelAiAdaptSceneRequest) -> AdaptSceneResponse:
    try:
        return service.ai_adapt_scene(request)
    except Exception as exc:
        raise _ai_error("小说 AI 场景改编", exc) from exc


@router.post("/novel/import/ai_adapt_scene_stream")
def ai_adapt_scene_stream(request: NovelAiAdaptSceneRequest) -> StreamingResponse:
    return _streaming_response(service.stream_ai_adapt_scene(request))


@router.post("/novel/import/batch_adapt", response_model=BatchAdaptResponse)
def batch_adapt(request: BatchAdaptRequest) -> BatchAdaptResponse:
    return service.batch_adapt(request)


@router.post("/novel/import/extract_characters", response_model=ExtractCharactersResponse)
def extract_characters(request: ExtractCharactersRequest) -> ExtractCharactersResponse:
    return service.extract_characters(request)

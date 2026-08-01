"""Long-novel processing contract routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_novel_processing_service
from app.models.novel_processing import (
    BookImportRecord,
    ChapterBoundaryUpdateRequest,
    ChapterRecord,
    ChapterSplitOptions,
    ChunkRecord,
    ChunkResult,
    CreateChunksRequest,
    CreateNovelProcessJobRequest,
    ExportJobResultResponse,
    JobEventLog,
    NovelImportFileInfo,
    NovelProcessJob,
    ChapterResult,
)
from app.services.novel_processing_service import NovelProcessingService
from app.api.routes_novel_process import service as executor_service, _panel_job, _panel_event
from app.models.novel_process import (
    NovelProcessJob as ExecutorNovelProcessJob,
    NovelProcessJobCreateRequest as ExecutorNovelProcessJobCreateRequest,
    NovelProcessJobResults as ExecutorNovelProcessJobResults,
)

router = APIRouter(prefix="/novel/processing", tags=["novel-processing"])


def _not_found(exc: KeyError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


@router.post("/import/analyze", response_model=BookImportRecord)
def analyze_novel_import(
    file: NovelImportFileInfo,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> BookImportRecord:
    return service.analyzeNovelImport(file)


@router.post("/books", response_model=BookImportRecord)
def create_book_import_record(
    file_info: NovelImportFileInfo,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> BookImportRecord:
    return service.createBookImportRecord(file_info)


@router.post("/books/{book_id}/chapters/split", response_model=list[ChapterRecord])
def split_book_into_chapters(
    book_id: str,
    options: ChapterSplitOptions | None = None,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> list[ChapterRecord]:
    try:
        return service.splitBookIntoChapters(book_id, options)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/books/{book_id}/chapters", response_model=list[ChapterRecord])
def list_chapters(
    book_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> list[ChapterRecord]:
    return service.listChapters(book_id)


@router.patch("/books/{book_id}/chapters/boundaries", response_model=list[ChapterRecord])
def update_chapter_boundaries(
    book_id: str,
    request: ChapterBoundaryUpdateRequest,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> list[ChapterRecord]:
    try:
        return service.updateChapterBoundaries(book_id, request.changes)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/books/{book_id}/chunks", response_model=list[ChunkRecord])
def create_chunks_for_selected_chapters(
    book_id: str,
    request: CreateChunksRequest,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> list[ChunkRecord]:
    try:
        return service.createChunksForSelectedChapters(book_id, request.chapterIds, request.options)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/books/{book_id}/jobs", response_model=NovelProcessJob)
def create_novel_process_job(
    book_id: str,
    request: CreateNovelProcessJobRequest,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> NovelProcessJob:
    return service.createNovelProcessJob(book_id, request.chapterIds, request.options)


@router.get("/jobs/{job_id}", response_model=NovelProcessJob)
def get_novel_process_job(
    job_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> NovelProcessJob:
    try:
        return service.getNovelProcessJob(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/books/{book_id}/jobs", response_model=list[NovelProcessJob])
def list_novel_process_jobs(
    book_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> list[NovelProcessJob]:
    return service.listNovelProcessJobs(book_id)


@router.post("/jobs/{job_id}/pause", response_model=NovelProcessJob)
def pause_novel_process_job(
    job_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> NovelProcessJob:
    try:
        return service.pauseNovelProcessJob(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/jobs/{job_id}/resume", response_model=NovelProcessJob)
def resume_novel_process_job(
    job_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> NovelProcessJob:
    try:
        return service.resumeNovelProcessJob(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/jobs/{job_id}/cancel", response_model=NovelProcessJob)
def cancel_novel_process_job(
    job_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> NovelProcessJob:
    try:
        return service.cancelNovelProcessJob(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/jobs/{job_id}/retry_failed_chunks", response_model=NovelProcessJob)
def retry_failed_chunks(
    job_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> NovelProcessJob:
    try:
        return service.retryFailedChunks(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/jobs/{job_id}/events", response_model=list[JobEventLog])
def get_job_events(
    job_id: str,
    limit: int = Query(default=100, ge=0, le=500),
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> list[JobEventLog]:
    return service.getJobEvents(job_id, limit)


@router.get("/chunks/{chunk_id}/result", response_model=ChunkResult)
def get_chunk_result(
    chunk_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> ChunkResult:
    try:
        return service.getChunkResult(chunk_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/chapters/{chapter_id}/result", response_model=ChapterResult)
def get_chapter_result(
    chapter_id: str,
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> ChapterResult:
    try:
        return service.getChapterResult(chapter_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/jobs/{job_id}/export", response_model=ExportJobResultResponse)
def export_job_result(
    job_id: str,
    format: str = Query(default="markdown"),
    service: NovelProcessingService = Depends(get_novel_processing_service),
) -> ExportJobResultResponse:
    try:
        return service.exportJobResult(job_id, format)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/execute/jobs", response_model=ExecutorNovelProcessJob)
def create_executor_novel_process_job(request: ExecutorNovelProcessJobCreateRequest) -> ExecutorNovelProcessJob:
    return executor_service.create_job(request)


@router.get("/execute/jobs/{job_id}", response_model=ExecutorNovelProcessJob)
def get_executor_novel_process_job(job_id: str) -> ExecutorNovelProcessJob:
    try:
        return executor_service.get_job(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/execute/jobs/{job_id}/panel")
def get_executor_novel_process_panel_snapshot(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(executor_service.get_job(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/execute/jobs/{job_id}/events")
def get_executor_novel_process_events(job_id: str, limit: int = Query(default=50, ge=0, le=200)) -> list[dict[str, object]]:
    try:
        job = executor_service.get_job(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc
    return list(reversed([_panel_event(job, event) for event in job.eventLogs]))[:limit]


@router.post("/execute/jobs/{job_id}/pause")
def pause_executor_novel_process_job(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(executor_service.pause_job(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/execute/jobs/{job_id}/resume")
def resume_executor_novel_process_job(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(executor_service.resume_job(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/execute/jobs/{job_id}/cancel")
def cancel_executor_novel_process_job(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(executor_service.cancel_job(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/execute/jobs/{job_id}/retry_failed_chunks")
def retry_executor_novel_process_failed_chunks(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(executor_service.rerun_failed(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/execute/jobs/{job_id}/results", response_model=ExecutorNovelProcessJobResults)
def get_executor_novel_process_results(job_id: str) -> ExecutorNovelProcessJobResults:
    try:
        return executor_service.get_results(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc

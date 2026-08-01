import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_novel_processing_service
from app.db.init_db import init_db
from app.main import create_app
from app.models.novel_processing import (
    ChapterBoundaryChange,
    ChunkCreationOptions,
    NovelImportFileInfo,
    NovelProcessJobOptions,
    NovelProcessingConfig,
    NovelProcessingStatus,
)
from app.services.novel_processing_service import NovelProcessingService


def _connection(tmp_path) -> sqlite3.Connection:  # type: ignore[no-untyped-def]
    conn = sqlite3.connect(tmp_path / "novel_processing_contracts.db", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return conn


def test_novel_processing_config_defaults_and_validation() -> None:
    config = NovelProcessingConfig()

    assert config.largeTextThresholdChars == 300_000
    assert config.largeTextThresholdWords == 100_000
    assert config.maxDirectProcessChars == 1_200_000
    assert config.chunkTargetChars == 8_000
    assert config.chunkMaxChars == 12_000
    assert config.chunkMinChars == 2_000
    assert config.chunkOverlapChars == 500
    assert config.maxConcurrentAgents == 3
    assert config.maxRetryCount == 2
    assert config.lowChapterConfidenceThreshold == 0.65
    assert config.previousContextSummaryMaxChars == 800
    assert config.chapterSummaryMaxChars == 1_500

    with pytest.raises(ValueError):
        NovelProcessingConfig(chunkMinChars=9_000, chunkTargetChars=8_000)
    with pytest.raises(ValueError):
        NovelProcessingConfig(maxConcurrentAgents=11)


def test_contract_service_persists_import_chapters_chunks_jobs_and_events(tmp_path) -> None:  # type: ignore[no-untyped-def]
    conn = _connection(tmp_path)
    service = NovelProcessingService(conn)
    text = "Chapter 1\n" + ("Alice waits at the station.\n" * 500)

    book = service.createBookImportRecord(
        NovelImportFileInfo(
            fileName="test.txt",
            originalPath="C:/books/test.txt",
            fileSizeBytes=len(text.encode("utf-8")),
            text=text,
        )
    )

    assert book.fileType == "txt"
    assert book.recommendedAction == "direct"
    assert book.hasStructuredChapters is True

    chapters = service.splitBookIntoChapters(book.bookId)
    assert len(chapters) == 1
    assert chapters[0].sourceType == "fallback_auto"
    assert chapters[0].status == NovelProcessingStatus.COMPLETED

    updated = service.updateChapterBoundaries(
        book.bookId,
        [
            ChapterBoundaryChange(
                chapterId=chapters[0].chapterId,
                title="Manual Chapter",
                startOffset=0,
                endOffset=7_500,
                confidence=0.9,
                anomalyFlags=[],
            )
        ],
    )
    assert updated[0].title == "Manual Chapter"
    assert updated[0].charCount == 7_500

    chunks = service.createChunksForSelectedChapters(
        book.bookId,
        [updated[0].chapterId],
        ChunkCreationOptions(
            chunkTargetChars=2_500,
            chunkMaxChars=3_000,
            chunkMinChars=1_000,
            chunkOverlapChars=200,
        ),
    )
    assert len(chunks) == 3
    assert chunks[1].overlapBefore == 200
    assert chunks[0].globalIndex == 0

    job = service.createNovelProcessJob(
        book.bookId,
        [updated[0].chapterId],
        NovelProcessJobOptions(maxConcurrency=2, maxRetryCount=1, userInstruction="Rewrite."),
    )
    assert job.totalChapters == 1
    assert job.totalChunks == 3
    assert job.maxConcurrency == 2
    assert job.maxRetryCount == 1

    paused = service.pauseNovelProcessJob(job.jobId)
    resumed = service.resumeNovelProcessJob(job.jobId)
    cancelled = service.cancelNovelProcessJob(job.jobId)

    assert paused.status == "paused"
    assert resumed.status == "waiting"
    assert cancelled.status == "cancelled"
    assert service.getNovelProcessJob(job.jobId).status == "cancelled"
    assert service.listNovelProcessJobs(book.bookId)[0].jobId == job.jobId

    events = service.getJobEvents(job.jobId, limit=10)
    event_types = {event.type for event in events}
    assert {"job_created", "job_paused", "job_resumed", "job_cancelled"}.issubset(event_types)

    exported = service.exportJobResult(job.jobId, "markdown")
    assert exported.jobId == job.jobId
    assert exported.fileName.endswith(".md")
    assert exported.warnings == ["No result records exist for this job yet."]


def test_contract_routes_expose_shared_api_without_touching_executor(tmp_path) -> None:  # type: ignore[no-untyped-def]
    conn = _connection(tmp_path)
    service = NovelProcessingService(conn)
    app = create_app()
    app.dependency_overrides[get_novel_processing_service] = lambda: service
    client = TestClient(app)

    created = client.post(
        "/api/novel/processing/books",
        json={
            "fileName": "huge.txt",
            "fileSizeBytes": 1_300_000,
            "fileType": "txt",
            "charCount": 1_300_000,
            "wordCount": 200_000,
        },
    )
    assert created.status_code == 200
    payload = created.json()
    assert payload["largeTextLevel"] == "huge"
    assert payload["recommendedAction"] == "split_required"

    chapters = client.post(f"/api/novel/processing/books/{payload['bookId']}/chapters/split", json={})
    assert chapters.status_code == 200
    assert chapters.json()[0]["bookId"] == payload["bookId"]

    listed = client.get(f"/api/novel/processing/books/{payload['bookId']}/chapters")
    assert listed.status_code == 200
    assert listed.json()[0]["sourceType"] == "fallback_auto"

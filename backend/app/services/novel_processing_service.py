"""Persistence-backed contract service for long-novel processing."""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from datetime import datetime, timezone
from typing import TypeVar

from app.ai.context_budget import estimate_tokens, estimate_tokens_from_cjk_char_count
from app.models.novel_processing import (
    BookImportRecord,
    ChapterBoundaryChange,
    ChapterRecord,
    ChapterSourceType,
    ChapterSplitOptions,
    ChunkCreationOptions,
    ChunkRecord,
    ChunkResult,
    CreateNovelProcessJobRequest,
    ExportJobResultResponse,
    JobEventLog,
    LargeTextLevel,
    NovelContractModel,
    NovelFileType,
    NovelImportFileInfo,
    NovelProcessJob,
    NovelProcessJobOptions,
    NovelProcessingConfig,
    NovelProcessingStatus,
    RecommendedNovelAction,
    ChapterResult,
)
from app.utils.ids import new_id


T = TypeVar("T", bound=NovelContractModel)

_CHAPTER_HEADING_RE = re.compile(
    r"(?im)^(#{1,6}\s+.+|chapter\s+\d+.*|\u7b2c[\u4e00-\u9fff0-9]{1,12}[\u7ae0\u8282\u56de].*)$"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _word_count(text: str) -> int:
    latin_words = re.findall(r"[A-Za-z0-9_]+", text)
    cjk_chars = re.findall(r"[\u4e00-\u9fff]", text)
    return len(latin_words) + len(cjk_chars)


def _estimate_tokens(text_or_chars: str | int, word_count: int | None = None) -> int:
    if isinstance(text_or_chars, int):
        return estimate_tokens_from_cjk_char_count(text_or_chars)
    return estimate_tokens(text_or_chars)


def _detect_file_type(file_name: str, declared: NovelFileType = "unknown") -> NovelFileType:
    if declared != "unknown":
        return declared
    lower = file_name.lower()
    if lower.endswith(".txt"):
        return "txt"
    if lower.endswith(".md") or lower.endswith(".markdown"):
        return "md"
    if lower.endswith(".docx"):
        return "docx"
    if lower.endswith(".epub"):
        return "epub"
    if lower.endswith((".html", ".htm", ".xhtml")):
        return "html"
    if lower.endswith(".json"):
        return "json"
    return "unknown"


def _normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", title.strip()).casefold()


class NovelProcessingService:
    """Define the stable backend boundary for future UI/splitting/agent sessions."""

    def __init__(self, conn: sqlite3.Connection, config: NovelProcessingConfig | None = None) -> None:
        self.conn = conn
        self.config = config or NovelProcessingConfig()

    def analyzeNovelImport(self, file: NovelImportFileInfo) -> BookImportRecord:
        text = file.text or ""
        char_count = file.charCount if file.charCount is not None else len(text)
        word_count = file.wordCount if file.wordCount is not None else _word_count(text)
        estimated_tokens = _estimate_tokens(text) if text else _estimate_tokens(char_count, word_count)
        file_type = _detect_file_type(file.fileName, file.fileType)
        file_hash = file.fileHash or self._hash_file_info(file, text)
        has_structured = (
            file.hasStructuredChapters
            if file.hasStructuredChapters is not None
            else self._detect_structured_chapters(file_type, text)
        )
        created_at = _now()
        return BookImportRecord(
            bookId=file.bookId or new_id("book"),
            fileName=file.fileName,
            originalPath=file.originalPath,
            fileSizeBytes=file.fileSizeBytes,
            fileHash=file_hash,
            encoding=file.encoding,
            fileType=file_type,
            charCount=char_count,
            wordCount=word_count,
            estimatedTokens=estimated_tokens,
            hasStructuredChapters=has_structured,
            largeTextLevel=self._large_text_level(char_count),
            recommendedAction=self._recommended_action(char_count, word_count),
            createdAt=created_at,
            updatedAt=created_at,
        )

    def createBookImportRecord(self, fileInfo: NovelImportFileInfo) -> BookImportRecord:
        record = self.analyzeNovelImport(fileInfo)
        self._put("book", record.bookId, record, book_id=record.bookId)
        self._event(
            "book_import_created",
            f"Book import record created for {record.fileName}.",
            book_id=record.bookId,
            payload={"recommendedAction": record.recommendedAction, "largeTextLevel": record.largeTextLevel},
        )
        return record

    def splitBookIntoChapters(self, bookId: str, options: ChapterSplitOptions | None = None) -> list[ChapterRecord]:
        options = options or ChapterSplitOptions()
        if options.preserveExisting:
            existing = self.listChapters(bookId)
            if existing:
                return existing
        book = self._require("book", bookId, BookImportRecord)
        existing = self.listChapters(bookId)
        if existing and not options.preserveExisting:
            self._delete("chapter", book_id=bookId)
        created_at = _now()
        chapter = ChapterRecord(
            chapterId=new_id("chapter"),
            bookId=bookId,
            index=0,
            volumeIndex=None,
            volumeTitle=None,
            title=book.fileName.rsplit(".", 1)[0] or "Full Text",
            normalizedTitle=_normalize_title(book.fileName.rsplit(".", 1)[0] or "Full Text"),
            startOffset=0,
            endOffset=book.charCount,
            charCount=book.charCount,
            wordCount=book.wordCount,
            estimatedTokens=book.estimatedTokens,
            confidence=0.4 if not book.hasStructuredChapters else 0.55,
            sourceType=ChapterSourceType.FALLBACK_AUTO,
            status=NovelProcessingStatus.COMPLETED,
            anomalyFlags=["fallback_auto_single_chapter"],
            createdAt=created_at,
            updatedAt=created_at,
        )
        self._put("chapter", chapter.chapterId, chapter, book_id=bookId, chapter_id=chapter.chapterId)
        self._event(
            "chapters_split_placeholder",
            "Placeholder chapter structure created; parser sessions may replace it.",
            book_id=bookId,
            chapter_id=chapter.chapterId,
            level="warning",
            payload={"sourceType": chapter.sourceType, "confidence": chapter.confidence},
        )
        return [chapter]

    def listChapters(self, bookId: str) -> list[ChapterRecord]:
        return sorted(self._list("chapter", ChapterRecord, book_id=bookId), key=lambda chapter: chapter.index)

    def updateChapterBoundaries(self, bookId: str, changes: list[ChapterBoundaryChange]) -> list[ChapterRecord]:
        updated: list[ChapterRecord] = []
        for change in changes:
            chapter = self._require("chapter", change.chapterId, ChapterRecord)
            if chapter.bookId != bookId:
                raise KeyError(f"Chapter {change.chapterId} does not belong to book {bookId}.")
            start = chapter.startOffset if change.startOffset is None else change.startOffset
            end = chapter.endOffset if change.endOffset is None else change.endOffset
            title = chapter.title if change.title is None else change.title
            confidence = chapter.confidence if change.confidence is None else change.confidence
            char_count = max(0, end - start)
            ratio = char_count / chapter.charCount if chapter.charCount else 1
            next_chapter = chapter.model_copy(
                update={
                    "title": title,
                    "normalizedTitle": _normalize_title(title),
                    "startOffset": start,
                    "endOffset": end,
                    "charCount": char_count,
                    "wordCount": max(0, math.ceil(chapter.wordCount * ratio)),
                    "estimatedTokens": _estimate_tokens(char_count),
                    "confidence": confidence,
                    "anomalyFlags": change.anomalyFlags if change.anomalyFlags is not None else chapter.anomalyFlags,
                    "updatedAt": _now(),
                }
            )
            self._put("chapter", next_chapter.chapterId, next_chapter, book_id=bookId, chapter_id=next_chapter.chapterId)
            updated.append(next_chapter)
        self._event(
            "chapter_boundaries_updated",
            f"Updated {len(updated)} chapter boundary record(s).",
            book_id=bookId,
            payload={"chapterIds": [chapter.chapterId for chapter in updated]},
        )
        return updated

    def createChunksForSelectedChapters(
        self,
        bookId: str,
        chapterIds: list[str],
        options: ChunkCreationOptions | None = None,
    ) -> list[ChunkRecord]:
        options = options or ChunkCreationOptions()
        if not chapterIds:
            return []
        if options.recreateExisting:
            for chapter_id in chapterIds:
                self._delete("chunk", book_id=bookId, chapter_id=chapter_id)
        target = options.chunkTargetChars or self.config.chunkTargetChars
        max_chars = options.chunkMaxChars or self.config.chunkMaxChars
        min_chars = options.chunkMinChars or self.config.chunkMinChars
        overlap = options.chunkOverlapChars if options.chunkOverlapChars is not None else self.config.chunkOverlapChars
        if min_chars > target or target > max_chars or overlap >= max_chars:
            raise ValueError("Invalid chunk sizing options.")
        chapters = [self._require("chapter", chapter_id, ChapterRecord) for chapter_id in chapterIds]
        created: list[ChunkRecord] = []
        global_index = self._next_global_chunk_index(bookId)
        created_at = _now()
        for chapter in sorted(chapters, key=lambda item: item.index):
            if chapter.bookId != bookId:
                raise KeyError(f"Chapter {chapter.chapterId} does not belong to book {bookId}.")
            chapter_chunks = self._chunk_ranges(chapter.startOffset, chapter.endOffset, target, min_chars, max_chars, overlap)
            for index_in_chapter, (start, end, before, after) in enumerate(chapter_chunks):
                chunk = ChunkRecord(
                    chunkId=new_id("chunk"),
                    chapterId=chapter.chapterId,
                    bookId=bookId,
                    indexInChapter=index_in_chapter,
                    globalIndex=global_index,
                    startOffset=start,
                    endOffset=end,
                    charCount=max(0, end - start),
                    estimatedTokens=_estimate_tokens(max(0, end - start)),
                    overlapBefore=before,
                    overlapAfter=after,
                    status=NovelProcessingStatus.PENDING,
                    assignedAgentId=None,
                    resultId=None,
                    retryCount=0,
                    createdAt=created_at,
                    updatedAt=created_at,
                )
                self._put("chunk", chunk.chunkId, chunk, book_id=bookId, chapter_id=chapter.chapterId, chunk_id=chunk.chunkId)
                created.append(chunk)
                global_index += 1
        self._event(
            "chunks_created",
            f"Created {len(created)} chunk contract record(s).",
            book_id=bookId,
            payload={"chapterIds": chapterIds, "chunkCount": len(created)},
        )
        return created

    def createNovelProcessJob(
        self,
        bookId: str,
        chapterIds: list[str],
        options: NovelProcessJobOptions | None = None,
    ) -> NovelProcessJob:
        options = options or NovelProcessJobOptions()
        chapters = [chapter for chapter in self.listChapters(bookId) if chapter.chapterId in set(chapterIds)]
        chunks = [chunk for chunk in self._list("chunk", ChunkRecord, book_id=bookId) if chunk.chapterId in set(chapterIds)]
        created_at = _now()
        job = NovelProcessJob(
            jobId=new_id("novel_job"),
            bookId=bookId,
            selectedChapterIds=chapterIds,
            totalChapters=len(chapters),
            totalChunks=len(chunks),
            totalEstimatedTokens=sum(chunk.estimatedTokens for chunk in chunks),
            maxConcurrency=options.maxConcurrency or self.config.maxConcurrentAgents,
            maxRetryCount=options.maxRetryCount if options.maxRetryCount is not None else self.config.maxRetryCount,
            userInstruction=options.userInstruction,
            outputFormat=options.outputFormat,
            promptVersion=options.promptVersion,
            status=NovelProcessingStatus.PENDING,
            createdAt=created_at,
            updatedAt=created_at,
        )
        self._put("job", job.jobId, job, book_id=bookId, job_id=job.jobId)
        self._event(
            "job_created",
            "Novel processing job created.",
            book_id=bookId,
            job_id=job.jobId,
            payload={"totalChapters": job.totalChapters, "totalChunks": job.totalChunks},
        )
        return job

    def getNovelProcessJob(self, jobId: str) -> NovelProcessJob:
        return self._require("job", jobId, NovelProcessJob)

    def listNovelProcessJobs(self, bookId: str) -> list[NovelProcessJob]:
        return sorted(self._list("job", NovelProcessJob, book_id=bookId), key=lambda job: job.createdAt, reverse=True)

    def pauseNovelProcessJob(self, jobId: str) -> NovelProcessJob:
        job = self._transition_job(jobId, NovelProcessingStatus.PAUSED, pausedAt=_now())
        self._event("job_paused", "Novel processing job paused.", book_id=job.bookId, job_id=jobId)
        return job

    def resumeNovelProcessJob(self, jobId: str) -> NovelProcessJob:
        job = self._transition_job(jobId, NovelProcessingStatus.WAITING, pausedAt=None, startedAt=_now())
        self._event("job_resumed", "Novel processing job queued for resume.", book_id=job.bookId, job_id=jobId)
        return job

    def cancelNovelProcessJob(self, jobId: str) -> NovelProcessJob:
        job = self._transition_job(jobId, NovelProcessingStatus.CANCELLED, finishedAt=_now())
        self._event("job_cancelled", "Novel processing job cancelled.", book_id=job.bookId, job_id=jobId, level="warning")
        return job

    def retryFailedChunks(self, jobId: str) -> NovelProcessJob:
        job = self.getNovelProcessJob(jobId)
        chunks = [
            chunk
            for chunk in self._list("chunk", ChunkRecord, book_id=job.bookId)
            if chunk.chapterId in set(job.selectedChapterIds) and chunk.status == NovelProcessingStatus.FAILED
        ]
        for chunk in chunks:
            next_chunk = chunk.model_copy(
                update={
                    "status": NovelProcessingStatus.RETRYING,
                    "retryCount": chunk.retryCount + 1,
                    "updatedAt": _now(),
                }
            )
            self._put("chunk", next_chunk.chunkId, next_chunk, book_id=job.bookId, chapter_id=next_chunk.chapterId, chunk_id=next_chunk.chunkId)
        next_job = job.model_copy(update={"status": NovelProcessingStatus.RETRYING, "updatedAt": _now()})
        self._put("job", next_job.jobId, next_job, book_id=job.bookId, job_id=job.jobId)
        self._event(
            "failed_chunks_retrying",
            f"Marked {len(chunks)} failed chunk(s) for retry.",
            book_id=job.bookId,
            job_id=jobId,
            payload={"chunkIds": [chunk.chunkId for chunk in chunks]},
        )
        return next_job

    def getJobEvents(self, jobId: str, limit: int = 100) -> list[JobEventLog]:
        events = sorted(self._list("event", JobEventLog, job_id=jobId), key=lambda event: event.createdAt, reverse=True)
        return events[: max(0, limit)]

    def getChunkResult(self, chunkId: str) -> ChunkResult:
        results = sorted(self._list("chunk_result", ChunkResult, chunk_id=chunkId), key=lambda result: result.createdAt, reverse=True)
        if not results:
            raise KeyError(f"Chunk result not found for chunk {chunkId}.")
        return results[0]

    def getChapterResult(self, chapterId: str) -> ChapterResult:
        results = sorted(
            self._list("chapter_result", ChapterResult, chapter_id=chapterId),
            key=lambda result: result.createdAt,
            reverse=True,
        )
        if not results:
            raise KeyError(f"Chapter result not found for chapter {chapterId}.")
        return results[0]

    def exportJobResult(self, jobId: str, format: str) -> ExportJobResultResponse:
        job = self.getNovelProcessJob(jobId)
        chapter_results = [
            result
            for result in self._list("chapter_result", ChapterResult, job_id=jobId)
            if result.chapterId in set(job.selectedChapterIds)
        ]
        chunk_results = self._list("chunk_result", ChunkResult, job_id=jobId)
        warnings: list[str] = []
        if chapter_results:
            content = "\n\n".join(result.mergedText for result in sorted(chapter_results, key=lambda item: item.chapterIndex))
        elif chunk_results:
            warnings.append("No merged chapter result exists; exported chunk results in global order.")
            content = "\n\n".join(result.resultText for result in sorted(chunk_results, key=lambda item: item.chunkIndex))
        else:
            warnings.append("No result records exist for this job yet.")
            content = ""
        extension = "md" if format == "markdown" else format
        return ExportJobResultResponse(
            jobId=jobId,
            format=format,
            fileName=f"{jobId}.{extension}",
            content=content,
            warnings=warnings,
        )

    def createNovelProcessJobFromRequest(self, bookId: str, request: CreateNovelProcessJobRequest) -> NovelProcessJob:
        return self.createNovelProcessJob(bookId, request.chapterIds, request.options)

    def _large_text_level(self, char_count: int) -> LargeTextLevel:
        if char_count < min(120_000, self.config.largeTextThresholdChars):
            return LargeTextLevel.SMALL
        if char_count < self.config.largeTextThresholdChars:
            return LargeTextLevel.MEDIUM
        if char_count <= self.config.maxDirectProcessChars:
            return LargeTextLevel.LARGE
        return LargeTextLevel.HUGE

    def _recommended_action(self, char_count: int, word_count: int) -> RecommendedNovelAction:
        if char_count > self.config.maxDirectProcessChars:
            return RecommendedNovelAction.SPLIT_REQUIRED
        if char_count >= self.config.largeTextThresholdChars or word_count >= self.config.largeTextThresholdWords:
            return RecommendedNovelAction.SPLIT_RECOMMENDED
        return RecommendedNovelAction.DIRECT

    @staticmethod
    def _hash_file_info(file: NovelImportFileInfo, text: str) -> str:
        digest = hashlib.sha256()
        digest.update((text or file.fileName).encode(file.encoding or "utf-8", errors="ignore"))
        digest.update(str(file.fileSizeBytes).encode("ascii"))
        return digest.hexdigest()

    @staticmethod
    def _detect_structured_chapters(file_type: NovelFileType, text: str) -> bool:
        if file_type in {"epub", "html", "docx", "md"}:
            return True
        return bool(text and _CHAPTER_HEADING_RE.search(text))

    @staticmethod
    def _chunk_ranges(
        start: int,
        end: int,
        target: int,
        min_chars: int,
        max_chars: int,
        overlap: int,
    ) -> list[tuple[int, int, int, int]]:
        total = max(0, end - start)
        if total == 0:
            return [(start, end, 0, 0)]
        if total <= max_chars:
            return [(start, end, 0, 0)]
        ranges: list[tuple[int, int, int, int]] = []
        cursor = start
        while cursor < end:
            next_end = min(end, cursor + target)
            remaining = end - next_end
            if 0 < remaining < min_chars:
                next_end = end
            before = overlap if ranges else 0
            after = overlap if next_end < end else 0
            ranges.append((max(start, cursor - before), min(end, next_end + after), before, after))
            if next_end >= end:
                break
            cursor = next_end
        return ranges

    def _next_global_chunk_index(self, book_id: str) -> int:
        chunks = self._list("chunk", ChunkRecord, book_id=book_id)
        if not chunks:
            return 0
        return max(chunk.globalIndex for chunk in chunks) + 1

    def _transition_job(self, job_id: str, status: NovelProcessingStatus, **fields: str | None) -> NovelProcessJob:
        job = self.getNovelProcessJob(job_id)
        next_job = job.model_copy(update={"status": status, "updatedAt": _now(), **fields})
        self._put("job", next_job.jobId, next_job, book_id=next_job.bookId, job_id=next_job.jobId)
        return next_job

    def _event(
        self,
        event_type: str,
        message: str,
        *,
        book_id: str | None = None,
        job_id: str | None = None,
        chapter_id: str | None = None,
        chunk_id: str | None = None,
        agent_task_id: str | None = None,
        level: str = "info",
        payload: dict[str, object] | None = None,
    ) -> JobEventLog:
        event = JobEventLog(
            eventId=new_id("event"),
            jobId=job_id,
            bookId=book_id,
            chapterId=chapter_id,
            chunkId=chunk_id,
            agentTaskId=agent_task_id,
            level=level,  # type: ignore[arg-type]
            type=event_type,
            message=message,
            payload=payload,
            createdAt=_now(),
        )
        self._put("event", event.eventId, event, book_id=book_id, job_id=job_id, chapter_id=chapter_id, chunk_id=chunk_id)
        return event

    def _require(self, kind: str, id: str, model: type[T]) -> T:
        record = self._get(kind, id, model)
        if record is None:
            raise KeyError(f"{kind} record not found: {id}")
        return record

    def _get(self, kind: str, id: str, model: type[T]) -> T | None:
        row = self.conn.execute(
            "SELECT value FROM novel_processing_records WHERE kind = ? AND id = ?",
            (kind, id),
        ).fetchone()
        if row is None:
            return None
        return model(**json.loads(row["value"]))

    def _list(self, kind: str, model: type[T], **filters: str | None) -> list[T]:
        allowed = {"book_id", "job_id", "chapter_id", "chunk_id"}
        clauses = ["kind = ?"]
        params: list[str] = [kind]
        for key, value in filters.items():
            if key not in allowed:
                raise ValueError(f"Unsupported novel processing filter: {key}")
            if value is None:
                continue
            clauses.append(f"{key} = ?")
            params.append(value)
        rows = self.conn.execute(
            f"SELECT value FROM novel_processing_records WHERE {' AND '.join(clauses)} ORDER BY created_at ASC",
            params,
        ).fetchall()
        return [model(**json.loads(row["value"])) for row in rows]

    def _put(
        self,
        kind: str,
        id: str,
        value: NovelContractModel,
        *,
        book_id: str | None = None,
        job_id: str | None = None,
        chapter_id: str | None = None,
        chunk_id: str | None = None,
    ) -> None:
        self.conn.execute(
            """
            INSERT INTO novel_processing_records (kind, id, book_id, job_id, chapter_id, chunk_id, value, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(kind, id) DO UPDATE SET
                book_id = excluded.book_id,
                job_id = excluded.job_id,
                chapter_id = excluded.chapter_id,
                chunk_id = excluded.chunk_id,
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                kind,
                id,
                book_id,
                job_id,
                chapter_id,
                chunk_id,
                json.dumps(value.model_dump(mode="json"), ensure_ascii=False),
            ),
        )
        self.conn.commit()

    def _delete(self, kind: str, **filters: str | None) -> None:
        allowed = {"book_id", "job_id", "chapter_id", "chunk_id"}
        clauses = ["kind = ?"]
        params: list[str] = [kind]
        for key, value in filters.items():
            if key not in allowed:
                raise ValueError(f"Unsupported novel processing filter: {key}")
            if value is None:
                continue
            clauses.append(f"{key} = ?")
            params.append(value)
        self.conn.execute(
            f"DELETE FROM novel_processing_records WHERE {' AND '.join(clauses)}",
            params,
        )
        self.conn.commit()

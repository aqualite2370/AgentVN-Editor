const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const OUT_DIR = path.join(ROOT, "output", "backend", "novel-processing-perf");
const REPORT_PATH = path.join(OUT_DIR, "novel-processing-backend-perf-audit.json");
const UV = process.platform === "win32" ? "uv.cmd" : "uv";
const PYTHON = process.platform === "win32" ? "python.exe" : "python";

fs.mkdirSync(OUT_DIR, { recursive: true });

const pythonHarness = String.raw`
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time
import sys

ROOT = Path(os.environ["AGENTVN_ROOT"])
sys.path.insert(0, str(ROOT / "backend"))

from app.api.routes_novel_process import _panel_event, _panel_job
from app.models.novel_process import (
    AgentTask,
    ChapterResult,
    ChunkRecord,
    ChunkResult,
    JobEventLog,
    NovelProcessJob,
    TokenUsage,
)
from app.schemas.requests import ProviderSelectionParameters, ProviderSelectionRequest
from app.services.novel_process_service import NovelProcessJobRepository, NovelProcessService, utc_now


def elapsed_ms(fn):
    start = time.perf_counter()
    value = fn()
    return value, (time.perf_counter() - start) * 1000


def iso(offset_seconds: int = 0) -> str:
    return utc_now()


def make_job() -> NovelProcessJob:
    now = utc_now()
    chunks: list[ChunkRecord] = []
    tasks: list[AgentTask] = []
    results: list[ChunkResult] = []
    chapters: list[ChapterResult] = []
    events: list[JobEventLog] = []
    for index in range(100):
        chunk_id = f"perf_chunk_{index + 1:03d}"
        status = "completed" if index < 80 else "failed" if index < 88 else "running" if index < 96 else "pending"
        chunks.append(ChunkRecord(
            chunkId=chunk_id,
            chapterTitle=f"Chapter {index // 10 + 1}",
            chapterIndex=index // 10,
            chunkIndex=index % 10,
            chunkText=("Main body text for processing performance. " * 120)[:5200],
            startOffset=index * 5200,
            endOffset=index * 5200 + 5200,
            status=status,
            retryCount=1 if status == "failed" else 0,
            previousContextSummary="Previous compressed context.",
            nextContextHint="Next compressed context.",
            contextChars=52,
            summary="Chunk summary.",
            resultId=f"perf_result_{index + 1:03d}" if status in {"completed", "failed"} else None,
            errorMessage="Synthetic failed chunk for query pressure." if status == "failed" else None,
            updatedAt=now,
        ))
        task_status = "completed" if status == "completed" else "failed" if status == "failed" else "running" if status == "running" else "waiting"
        task = AgentTask(
            taskId=f"perf_task_{index + 1:03d}",
            jobId="perf_backend_job",
            chunkId=chunk_id,
            chapterTitle=f"Chapter {index // 10 + 1}",
            chapterIndex=index // 10,
            chunkIndex=index % 10,
            agentIndex=index % 8,
            attemptId=f"attempt_{index + 1:03d}",
            runAttempt=2 if status == "failed" else 1,
            status=task_status,
            phase="chunk_parse",
            assignmentReason="Backend perf audit assigned one chunk to this task.",
            currentStepLabel="completed" if task_status == "completed" else "streaming",
            lastHeartbeatAt=now,
            retryCount=1 if status == "failed" else 0,
            inputTokens=1800 + index,
            outputTokens=700 + index,
            totalTokens=2500 + index * 2,
            tokenSource="estimated",
            partialResult="partial output" if task_status == "running" else "",
            resultPreview="result preview",
            errorMessage="Synthetic task failure." if task_status == "failed" else None,
            failureCategory="schema_parse_failed" if task_status == "failed" else None,
            startedAt=now,
            completedAt=now if task_status in {"completed", "failed"} else None,
            inputKeys=["bookId", "chapterTitle", "chapterIndex", "chunkIndex", "chunkText", "previousContextSummary", "nextContextHint", "userInstruction", "outputFormat", "promptVersion"],
            inputChunkChars=5200,
            contextChars=52,
            schemaRepairCount=1 if index % 25 == 0 else 0,
        )
        tasks.append(task)
        if status in {"completed", "failed"}:
            results.append(ChunkResult(
                resultId=f"perf_result_{index + 1:03d}",
                chunkId=chunk_id,
                chapterTitle=f"Chapter {index // 10 + 1}",
                chapterIndex=index // 10,
                chunkIndex=index % 10,
                status="completed" if status == "completed" else "failed",
                resultText="Structured result text.",
                summary="Structured summary.",
                sceneCount=2 if status == "completed" else 0,
                schemaRepairCount=1 if index % 25 == 0 else 0,
                mergeStatus="merged" if status == "completed" else "failed",
                warnings=["Synthetic warning"] if index % 20 == 0 else [],
                qualityWarnings=["needs_review"] if status == "failed" else [],
                errorMessage="Synthetic result failure." if status == "failed" else None,
                rawOutput="{raw output}",
                tokens=TokenUsage(inputTokens=1800 + index, outputTokens=700 + index, totalTokens=2500 + index * 2, tokenSource="estimated"),
                completedAt=now,
            ))
    for chapter_index in range(10):
        chapters.append(ChapterResult(
            chapterTitle=f"Chapter {chapter_index + 1}",
            chapterIndex=chapter_index,
            summary="Chapter summary.",
            completedChunks=8 if chapter_index < 8 else 0,
            failedChunks=1 if chapter_index == 8 else 0,
            cancelledChunks=0,
            tokens=TokenUsage(inputTokens=18_000, outputTokens=7_000, totalTokens=25_000, tokenSource="estimated"),
            updatedAt=now,
        ))
    for index in range(500):
        task = tasks[index % len(tasks)]
        events.append(JobEventLog(
            eventId=f"perf_event_{index + 1:03d}",
            eventType="agent_task_partial" if index % 5 else "agent_task_completed",
            message=f"Perf event {index + 1}",
            createdAt=now,
            taskId=task.taskId,
            chunkId=task.chunkId,
            details={"index": index, "agentIndex": task.agentIndex, "partialChars": index * 3},
        ))
    return NovelProcessJob(
        jobId="perf_backend_job",
        bookId="perf_book",
        title="Backend Processing Perf Audit",
        status="running",
        userInstruction="Parse chunks for performance audit.",
        outputFormat="markdown",
        promptVersion="subagent-v1",
        maxConcurrency=8,
        maxRetries=2,
        providerSelection=ProviderSelectionRequest(
            connection_id="perf_connection",
            model_id="perf-model",
            base_url="https://example.invalid/v1",
            api_key="SECRET_API_KEY_SHOULD_NOT_RETURN",
            parameters=ProviderSelectionParameters(max_tokens=2048, temperature=0.2),
        ),
        chunks=chunks,
        agentTasks=tasks,
        chunkResults=results,
        chapterResults=chapters,
        eventLogs=events,
        totalChunks=100,
        completedChunks=80,
        failedChunks=8,
        cancelledChunks=0,
        runningTasks=8,
        actualInputTokens=sum(task.inputTokens for task in tasks),
        actualOutputTokens=sum(task.outputTokens for task in tasks),
        actualTotalTokens=sum(task.totalTokens for task in tasks),
        tokenSource="estimated",
        createdAt=now,
        updatedAt=now,
        startedAt=now,
    )


def main() -> None:
    tmp_path = Path(tempfile.mkdtemp(prefix="agentvn_novel_processing_perf_"))
    repo = NovelProcessJobRepository(tmp_path / "perf.sqlite")
    job = make_job()
    _, save_ms = elapsed_ms(lambda: repo.save_job(job))
    loaded, load_ms = elapsed_ms(lambda: repo.load_job(job.jobId))
    if loaded is None:
        raise RuntimeError("Repository did not load saved job.")
    service = NovelProcessService(storage_dir=tmp_path / "sidecars", repository=repo)
    service._jobs[job.jobId] = loaded
    public_job, public_query_ms = elapsed_ms(lambda: service.get_job(job.jobId))
    panel, panel_ms = elapsed_ms(lambda: _panel_job(public_job))
    panel_json = json.dumps(panel, ensure_ascii=False)
    panel_events, events_ms = elapsed_ms(lambda: list(reversed([_panel_event(public_job, event) for event in public_job.eventLogs]))[:200])
    paused_job, pause_query_ms = elapsed_ms(lambda: service.pause_job(job.jobId))
    cancelled_job, cancel_query_ms = elapsed_ms(lambda: service.cancel_job(job.jobId))
    cancelled_panel, cancelled_panel_ms = elapsed_ms(lambda: _panel_job(cancelled_job))
    result = {
        "ok": True,
        "databasePath": str(repo.database_path),
        "jobId": job.jobId,
        "chunkCount": len(job.chunks),
        "taskCount": len(job.agentTasks),
        "eventCount": len(job.eventLogs),
        "saveJobMs": save_ms,
        "loadJobMs": load_ms,
        "publicQueryMs": public_query_ms,
        "panelSnapshotMs": panel_ms,
        "panelSnapshotBytes": len(panel_json.encode("utf-8")),
        "panelEventQueryMs": events_ms,
        "panelEventCount": len(panel_events),
        "pauseQueryMs": pause_query_ms,
        "cancelQueryMs": cancel_query_ms,
        "cancelledPanelSnapshotMs": cancelled_panel_ms,
        "providerSelectionRedacted": bool(public_job.providerSelection and public_job.providerSelection.api_key == ""),
        "panelHasApiKey": "SECRET_API_KEY_SHOULD_NOT_RETURN" in panel_json,
        "cancelStatus": cancelled_job.status,
        "pauseStatus": paused_job.status,
        "routeFamilies": ["/api/novel/processing/execute/*", "/api/novel/process*"],
    }
    failures: list[str] = []
    if result["panelSnapshotMs"] > 200:
        failures.append(f"panel snapshot {result['panelSnapshotMs']:.1f}ms > 200ms")
    if result["cancelledPanelSnapshotMs"] > 200:
        failures.append(f"cancelled panel snapshot {result['cancelledPanelSnapshotMs']:.1f}ms > 200ms")
    if not result["providerSelectionRedacted"]:
        failures.append("providerSelection api_key was not redacted by public get_job")
    if result["panelHasApiKey"]:
        failures.append("panel snapshot leaked provider api key")
    result["failures"] = failures
    result["ok"] = len(failures) == 0
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
`;

function runHarness() {
  const harnessPath = path.join(OUT_DIR, "novel_processing_backend_perf_harness.py");
  fs.writeFileSync(harnessPath, pythonHarness, "utf8");
  const env = { ...process.env, AGENTVN_ROOT: ROOT };
  const attempts = [
    { command: UV, args: ["run", "python", harnessPath], cwd: BACKEND_DIR },
    { command: PYTHON, args: [harnessPath], cwd: ROOT },
  ];
  const errors = [];
  for (const attempt of attempts) {
    const result = spawnSync(attempt.command, attempt.args, {
      cwd: attempt.cwd,
      env,
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
      timeout: 120_000,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return {
        command: `${attempt.command} ${attempt.args.join(" ")}`,
        report: JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),
        stderr: result.stderr,
      };
    }
    errors.push({
      command: `${attempt.command} ${attempt.args.join(" ")}`,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
    });
  }
  return { errors };
}

const startedAt = new Date().toISOString();
const result = runHarness();
const report = {
  ok: Boolean(result.report?.ok),
  at: startedAt,
  command: result.command,
  metrics: result.report,
  errors: result.errors,
  stderr: result.stderr,
};
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

if (report.metrics) {
  console.table([{
    ok: report.ok,
    chunks: report.metrics.chunkCount,
    events: report.metrics.eventCount,
    saveJobMs: Math.round(report.metrics.saveJobMs),
    loadJobMs: Math.round(report.metrics.loadJobMs),
    panelSnapshotMs: Math.round(report.metrics.panelSnapshotMs),
    cancelledPanelSnapshotMs: Math.round(report.metrics.cancelledPanelSnapshotMs),
    panelSnapshotBytes: report.metrics.panelSnapshotBytes,
    providerSelectionRedacted: report.metrics.providerSelectionRedacted,
    panelHasApiKey: report.metrics.panelHasApiKey,
    failures: report.metrics.failures?.join("; ") ?? "",
  }]);
}
console.log(JSON.stringify({ ok: report.ok, reportPath: REPORT_PATH, command: report.command, failures: report.metrics?.failures, errors: report.errors }, null, 2));

if (!report.ok) process.exit(1);

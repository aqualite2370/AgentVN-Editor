# Novel Processing Shared Contracts

本文件是超长小说处理多会话开发的共享契约。后续会话必须引用这里列出的类型、配置和状态，不得在 UI、章节拆分、Subagent 执行或结果管理中重复定义冲突字段。

## Source Of Truth

- 后端类型源头：`backend/app/models/novel_processing.py`
- 后端服务边界：`backend/app/services/novel_processing_service.py`
- 后端 API 边界：`backend/app/api/routes_novel_processing.py`
- 前端类型镜像：`editor/src/novel-processing/contracts.ts`
- 配置入口：`backend/app/core/config.py` 中的 `settings.novel`
- 持久化占位表：`novel_processing_records`，由 `backend/app/db/init_db.py` 初始化

已有的 `backend/app/models/novel_process.py`、`backend/app/services/novel_process_service.py` 和 `/api/novel/process` 是执行层实现。新会话可以把本契约映射到执行层，但不能反向以执行层旧字段覆盖本契约字段。

## External References Reviewed

- [calibre](https://github.com/kovidgoyal/calibre): conversion/config 和 ebook 处理链路中的 TOC/章节选项。
- [Koodo Reader](https://github.com/koodo-reader/koodo-reader): 阅读器导入、导航和跨格式阅读模型。
- [epub.js navigation](https://github.com/futurepress/epub.js/blob/master/src/navigation.js): EPUB navigation/toc 解析模型。
- [KOReader reader TOC](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readertoc.lua): 阅读器端 TOC 填充、折叠和位置跳转。
- [Chapterize](https://github.com/JonathanReeve/chapterize/tree/master/chapterize): 文本章节检测和章节化工具。
- [LangGraph types](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/types.py): retry policy、checkpoint 和图执行状态思想。
- [Temporal TypeScript SDK workflow client](https://github.com/temporalio/sdk-typescript/blob/main/packages/client/src/workflow-client.ts): durable workflow handle、pause/resume/cancel 查询边界。
- [Celery states](https://github.com/celery/celery/blob/main/celery/states.py) 和 [Celery result backend](https://github.com/celery/celery/blob/main/celery/backends/base.py): 任务状态集合、重试和结果后端分离。

吸收的设计点：

- 章节来源优先级应从结构化目录开始：`epub_toc`、`html_heading`、`markdown_heading`、`docx_heading`，最后才是 `txt_rule` 或 `fallback_auto`。
- TXT 章节检测需要记录 `confidence` 和 `anomalyFlags`，不要把启发式结果当成可靠 TOC。
- 任务状态和结果状态要分离：`AgentTask`、`ChunkRecord` 和 `ChunkResult` 分别记录运行、调度和输出。
- 支持重试、暂停、继续、取消和超时疑似状态时，事件日志必须可追溯。
- 结果后端独立于执行器：后续 Subagent 会话可以替换执行实现，但写入同一契约。

## Config

配置从 `settings.novel` 读取，默认值如下。环境变量可通过 Pydantic nested settings 覆盖，例如 `NOVEL__MAXCONCURRENTAGENTS=4`。

| Key | Default | Notes |
| --- | ---: | --- |
| `novel.largeTextThresholdChars` | `300000` | 达到后建议拆分。 |
| `novel.largeTextThresholdWords` | `100000` | 达到后建议拆分。 |
| `novel.maxDirectProcessChars` | `1200000` | 超过后禁止整本直处理。 |
| `novel.chunkTargetChars` | `8000` | 默认切片目标长度。 |
| `novel.chunkMaxChars` | `12000` | 单切片上限。 |
| `novel.chunkMinChars` | `2000` | 尾片合并阈值。 |
| `novel.chunkOverlapChars` | `500` | 相邻切片上下文重叠。 |
| `novel.maxConcurrentAgents` | `3` | 并发范围 `1..10`。 |
| `novel.maxRetryCount` | `2` | 失败块默认重试次数。 |
| `novel.lowChapterConfidenceThreshold` | `0.65` | 低置信章节需要 UI 标记。 |
| `novel.previousContextSummaryMaxChars` | `800` | 上文摘要注入上限。 |
| `novel.chapterSummaryMaxChars` | `1500` | 章节汇总摘要上限。 |

## Types

所有共享 JSON 字段使用 lower camel case。Python 模型也保留 camelCase 字段名，避免前后端转换歧义。

### BookImportRecord

导入检测记录。用于决定是否提醒用户进行章节拆分。

核心字段：`bookId`、`fileName`、`originalPath`、`fileSizeBytes`、`fileHash`、`encoding`、`fileType`、`charCount`、`wordCount`、`estimatedTokens`、`hasStructuredChapters`、`largeTextLevel`、`recommendedAction`、`createdAt`、`updatedAt`。

### ChapterRecord

章节边界记录。`startOffset`/`endOffset` 是原书字符偏移；`sourceType` 标明来源；`confidence` 低于配置阈值时，拆分/勾选 UI 应提醒用户复核。

核心字段：`chapterId`、`bookId`、`index`、`volumeIndex`、`volumeTitle`、`title`、`normalizedTitle`、`startOffset`、`endOffset`、`charCount`、`wordCount`、`estimatedTokens`、`confidence`、`sourceType`、`status`、`anomalyFlags`、`createdAt`、`updatedAt`。

### ChunkRecord

切片调度记录。`overlapBefore`/`overlapAfter` 只描述上下文重叠长度；真实输入文本由后续执行层按偏移取用。

核心字段：`chunkId`、`chapterId`、`bookId`、`indexInChapter`、`globalIndex`、`startOffset`、`endOffset`、`charCount`、`estimatedTokens`、`overlapBefore`、`overlapAfter`、`status`、`assignedAgentId`、`resultId`、`retryCount`、`createdAt`、`updatedAt`。

### NovelProcessJob

整次处理任务记录。它描述用户选择、并发、重试和总体进度，不直接保存所有输出文本。

核心字段：`jobId`、`bookId`、`selectedChapterIds`、`totalChapters`、`totalChunks`、`completedChunks`、`failedChunks`、`skippedChunks`、`cancelledChunks`、`totalEstimatedTokens`、`actualInputTokens`、`actualOutputTokens`、`actualTotalTokens`、`maxConcurrency`、`maxRetryCount`、`userInstruction`、`outputFormat`、`promptVersion`、`status`、`createdAt`、`startedAt`、`pausedAt`、`finishedAt`、`updatedAt`。

### AgentTask

单个 Subagent 对单个 chunk 的运行快照。后续执行会话应写入 `heartbeatAt` 以支持 `timeout_suspected`。

核心字段：`agentTaskId`、`jobId`、`bookId`、`chapterId`、`chunkId`、`agentIndex`、`status`、`inputTokens`、`outputTokens`、`totalTokens`、`startedAt`、`finishedAt`、`heartbeatAt`、`errorMessage`、`retryCount`、`partialResult`、`resultPreview`。

### ChunkResult

单个切片的最终或可恢复输出。`summary` 和 `continuityNotes` 供下一切片、章节合并和断点续跑使用。

核心字段：`resultId`、`jobId`、`bookId`、`chapterId`、`chunkId`、`chunkIndex`、`resultText`、`summary`、`continuityNotes`、`warnings`、`inputTokens`、`outputTokens`、`totalTokens`、`promptVersion`、`modelName`、`createdAt`、`updatedAt`。

### ChapterResult

章节级合并结果。它引用 `chunkResultIds`，保留章节汇总和 token 统计。

核心字段：`chapterResultId`、`jobId`、`bookId`、`chapterId`、`chapterIndex`、`title`、`mergedText`、`summary`、`chunkResultIds`、`inputTokens`、`outputTokens`、`totalTokens`、`status`、`createdAt`、`updatedAt`。

### JobEventLog

任务事件日志。UI 面板和断点续跑应优先读取它来解释任务变化。

核心字段：`eventId`、`jobId`、`bookId`、`chapterId`、`chunkId`、`agentTaskId`、`level`、`type`、`message`、`payload`、`createdAt`。

## Enums

`ChapterSourceType` 固定为：

- `epub_toc`
- `html_heading`
- `markdown_heading`
- `docx_heading`
- `txt_rule`
- `manual`
- `fallback_auto`

统一状态 `NovelProcessingStatus` 固定为：

- `pending`
- `waiting`
- `running`
- `paused`
- `completed`
- `failed`
- `failed_partial`
- `retrying`
- `cancelled`
- `skipped`
- `timeout_suspected`

## State Transitions

推荐任务主流程：

`pending -> waiting -> running -> completed`

暂停与继续：

`running -> paused -> waiting -> running`

取消：

`pending|waiting|running|paused|retrying -> cancelled`

失败与重试：

`running -> failed|failed_partial -> retrying -> waiting -> running`

跳过：

`pending|waiting -> skipped`

超时疑似：

`running -> timeout_suspected -> retrying|failed|cancelled|running`

约束：

- `completed`、`cancelled`、`skipped` 是终态，除非用户显式创建新 job 或发起 retry。
- `ChapterRecord.status` 描述章节拆分/复核状态，`ChunkRecord.status` 描述调度状态，`AgentTask.status` 描述运行状态。
- `ChunkResult` 和 `ChapterResult` 不应用来表达正在运行；运行态写入 `AgentTask.partialResult` 和 `JobEventLog`。

## Interfaces

当前后端提供 `/api/novel/processing` API，也提供同名服务函数。前端请优先引用 `NOVEL_PROCESSING_ROUTES` 和 `NovelProcessingApiContract`。

- `analyzeNovelImport(file)`
- `createBookImportRecord(fileInfo)`
- `splitBookIntoChapters(bookId, options)`
- `listChapters(bookId)`
- `updateChapterBoundaries(bookId, changes)`
- `createChunksForSelectedChapters(bookId, chapterIds, options)`
- `createNovelProcessJob(bookId, chapterIds, options)`
- `getNovelProcessJob(jobId)`
- `listNovelProcessJobs(bookId)`
- `pauseNovelProcessJob(jobId)`
- `resumeNovelProcessJob(jobId)`
- `cancelNovelProcessJob(jobId)`
- `retryFailedChunks(jobId)`
- `getJobEvents(jobId, limit)`
- `getChunkResult(chunkId)`
- `getChapterResult(chapterId)`
- `exportJobResult(jobId, format)`

## Multi-Session Rules

- 会话 1 章节拆分：只负责把 `ChapterRecord` 写准，不新增章节状态枚举。
- 会话 2 切片：只负责生成 `ChunkRecord`，遵守配置里的 target/max/min/overlap。
- 会话 3 Subagent 执行：写 `AgentTask`、更新 `ChunkRecord.status`、产出 `ChunkResult`。
- 会话 4 流式汇总：写 `ChapterResult`，通过 `JobEventLog` 追加合并事件。
- 会话 5 断点续跑/任务面板：只读取这些共享状态，不创建平行 job 类型。
- 会话 6 结果管理/导出：通过 `ChunkResult`、`ChapterResult` 和 `exportJobResult` 组织输出。

如需新增字段，必须先在 `backend/app/models/novel_processing.py` 加入，并同步 `editor/src/novel-processing/contracts.ts` 与本文档。

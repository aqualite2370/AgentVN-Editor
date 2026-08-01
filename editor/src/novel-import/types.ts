import type { MemoryMode } from "../types/memory";
import type { GameCommand } from "../types/commands";
import type { SceneBeat } from "../types/scene";
import type { NovelProcessingState } from "./novelProcessing";

export type NovelFileType = "txt" | "md" | "epub" | "html" | "htm" | "xhtml" | "docx" | "json" | "unknown";
export type ImportStatus = "idle" | "imported" | "chunked" | "ai_scanning" | "outline_ready" | "scene_planning" | "blueprint_generating" | "imported_to_graph" | "chapters_split" | "scenes_split" | "characters_extracted" | "adapted";
export type ProgressiveImportStatus = "idle" | "running" | "paused" | "cancelled" | "completed";
export type NovelAiStage = "landing" | "scan" | "outline" | "planning" | "generate" | "report";
export type NovelRecommendedAction = "direct" | "split_recommended" | "split_required";
export type NovelProcessingTier = "small" | "medium" | "large" | "oversized";
export type NovelImportEntryMode = "direct" | "chapter_split";
export type ChapterSourceType = "epub_toc" | "html_heading" | "markdown_heading" | "docx_heading" | "txt_rule" | "manual" | "fallback_auto";
export type ChapterStatus = "confirmed" | "needs_review" | "manual_review";
export type ChapterAnomalyFlag =
  | "too_short"
  | "too_long"
  | "low_confidence"
  | "duplicate_title"
  | "non_incremental_index"
  | "toc_duplicate"
  | "suspicious_ad"
  | "fallback_generated";

export interface ChapterStructureHint {
  title: string;
  start_offset: number;
  end_offset?: number;
  source_type: ChapterSourceType;
  level?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface NovelTextThresholds {
  small_text_chars: number;
  small_text_words: number;
  large_text_chars: number;
  large_text_words: number;
  max_direct_process_chars: number;
}

export interface NovelChapterStructureDetection {
  detected: boolean;
  method: "txt_pattern" | "markdown_heading" | "html_heading" | "docx_heading" | "epub_toc" | "epub_spine" | "none";
  confidence: number;
  heading_count: number;
  sample_headings: string[];
  notes: string[];
}

export interface NovelImportPreflight {
  file_name: string;
  file_size_bytes: number;
  file_type: NovelFileType;
  mime_type?: string;
  encoding: string;
  encoding_confidence: number;
  encoding_warning?: string;
  total_chars: number;
  estimated_words: number;
  estimated_tokens: number;
  has_chapter_structure: boolean;
  chapter_structure: NovelChapterStructureDetection;
  is_large_text: boolean;
  exceeds_direct_process_limit: boolean;
  recommended_action: NovelRecommendedAction;
  recommendation_label: string;
  processing_tier: NovelProcessingTier;
  time_hint: string;
  direct_process_risks: string[];
  thresholds: NovelTextThresholds;
  file_hash_sha256?: string;
  analyzed_at: string;
}

export interface ChapterRecord {
  chapterId: string;
  bookId: string;
  index: number;
  title: string;
  normalizedTitle: string;
  startOffset: number;
  endOffset: number;
  charCount: number;
  wordCount: number;
  estimatedTokens: number;
  confidence: number;
  sourceType: ChapterSourceType;
  status: ChapterStatus;
  anomalyFlags: ChapterAnomalyFlag[];
  metadata?: Record<string, unknown>;
}

export interface ChapterSplitPreview {
  detectedChapterCount: number;
  firstTwentyTitles: string[];
  averageChapterLength: number;
  shortestChapter?: Pick<ChapterRecord, "chapterId" | "index" | "title" | "charCount" | "confidence" | "anomalyFlags">;
  longestChapter?: Pick<ChapterRecord, "chapterId" | "index" | "title" | "charCount" | "confidence" | "anomalyFlags">;
  anomalyChapters: Array<Pick<ChapterRecord, "chapterId" | "index" | "title" | "charCount" | "confidence" | "anomalyFlags">>;
  rulesUsed: string[];
  recommendedActions: Array<"confirm" | "adjust_rules" | "manual_merge" | "manual_split" | "fallback_slice">;
}

export interface ChapterSplitReport {
  bookId: string;
  sourceType: ChapterSourceType;
  overallConfidence: number;
  needsHumanConfirmation: boolean;
  anomalyRatio: number;
  tocRange?: { startOffset: number; endOffset: number; candidateCount: number };
  tocReferenceTitles: string[];
  usedFallback: boolean;
  lowConfidenceReason?: string;
  preview: ChapterSplitPreview;
}

export interface SourceDocument {
  document_id: string;
  title: string;
  author?: string;
  file_name: string;
  file_type: NovelFileType;
  language: string;
  raw_text: string;
  normalized_text: string;
  imported_at: string;
  total_chars: number;
  file_hash?: string;
  original_path?: string;
  source_paths?: string[];
  file_size?: number;
  metadata: Record<string, unknown>;
}

export interface BookImportRecord {
  record_id: string;
  document_id: string;
  file_name: string;
  file_hash_sha256?: string;
  entry_mode: NovelImportEntryMode;
  status: "direct_ready" | "split_preview";
  created_at: string;
  preflight: NovelImportPreflight;
}

export interface NovelPendingImport {
  document: SourceDocument;
  preflight: NovelImportPreflight;
}

export interface TextChunk {
  chunk_id: string;
  document_id: string;
  index: number;
  text: string;
  start_offset: number;
  end_offset: number;
  estimated_tokens: number;
  chapter_hint?: string;
  scene_hint?: string;
}

export interface ChapterCandidate {
  chapter_id: string;
  book_id?: string;
  title: string;
  normalized_title?: string;
  index: number;
  start_offset: number;
  end_offset: number;
  char_count?: number;
  word_count?: number;
  estimated_tokens?: number;
  source_type?: ChapterSourceType;
  status?: ChapterStatus;
  anomaly_flags?: ChapterAnomalyFlag[];
  summary: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface SceneCandidate {
  scene_candidate_id: string;
  chapter_id: string;
  title: string;
  display_name?: string;
  index: number;
  start_offset: number;
  end_offset: number;
  location_hint?: string;
  time_hint?: string;
  characters: string[];
  source_span?: SourceSpan;
  source_excerpt: string;
  summary: string;
  commands: GameCommand[];
  confidence: number;
}

export interface SourceSpan {
  start_offset: number;
  end_offset: number;
}

export interface CharacterCandidate {
  character_id: string;
  name: string;
  aliases: string[];
  first_seen_offset: number;
  description: string;
  speaking_style_hint?: string;
  confidence: number;
}

export interface CharacterCandidateReview {
  character: CharacterCandidate;
  score: number;
  status: "candidate" | "promoted" | "ignored";
  reasons: string[];
  evidence: {
    sceneRefs: number;
    commandRefs: number;
    aliasMatches: string[];
  };
}

export interface SourceMapping {
  document_id: string;
  start_offset: number;
  end_offset: number;
  source_excerpt: string;
  adapted_command_ids: string[];
}

export interface AdaptedScene {
  adapted_scene_id: string;
  source_scene_candidate_id: string;
  scene_beat: SceneBeat;
  source_mapping: SourceMapping;
  warnings: string[];
  needs_review: boolean;
}

export interface ImportOptions {
  language: string;
  target_style: string;
  preserve_original_dialogue: boolean;
  narration_density: "low" | "medium" | "high";
  split_scene_aggressiveness: "low" | "medium" | "high";
  generate_background_hints: boolean;
  generate_sprite_hints: boolean;
  generate_bgm_hints: boolean;
  generate_animation_hints: boolean;
  memory_mode: MemoryMode;
  max_chunk_chars: number;
  max_scene_chars: number;
  allow_branch_suggestions: boolean;
}

export interface NovelImportSession {
  session_id: string;
  document?: SourceDocument;
  import_record?: BookImportRecord;
  chunks: TextChunk[];
  chapters: ChapterCandidate[];
  chapter_split_report?: ChapterSplitReport;
  scenes: SceneCandidate[];
  characters: CharacterCandidate[];
  character_candidates_review?: CharacterCandidateReview[];
  adapted_scenes: AdaptedScene[];
  asset_suggestions: AssetSuggestion[];
  branch_suggestions: BranchSuggestion[];
  conflict_points: ConflictPoint[];
  ai_chunk_analyses: NovelAiChunkAnalysis[];
  scan_partials: Record<string, NovelAiChunkPartial>;
  outline_partials: NovelAiOutlinePartial;
  planned_chapter_ids: string[];
  validation_reports: NovelImportValidationReport[];
  ai_outline?: NovelAiOutline;
  quality_report?: NovelImportQualityReport;
  quality_risk_accepted: boolean;
  ai_stage: NovelAiStage;
  status: ImportStatus;
  created_at: string;
  updated_at: string;
  import_options: ImportOptions;
}

export type PersistentRecordStatus =
  | "pending"
  | "waiting"
  | "running"
  | "retrying"
  | "paused"
  | "completed"
  | "failed"
  | "failed_partial"
  | "cancelled"
  | "timeout_suspected";

export interface TokenUsageRecord {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated: boolean;
}

export interface PersistentBookImportRecord {
  bookId: string;
  title: string;
  fileName: string;
  fileType: NovelFileType;
  fileHash: string;
  fileSize: number;
  originalPath: string;
  sourcePaths: string[];
  importedAt: string;
  updatedAt: string;
  totalChars: number;
  language: string;
  metadata: Record<string, unknown>;
}

export interface PersistentChapterRecord {
  chapterId: string;
  bookId: string;
  index: number;
  title: string;
  startOffset: number;
  endOffset: number;
  summary: string;
  confidence: number;
  status: PersistentRecordStatus;
  updatedAt: string;
}

export interface PersistentChunkRecord {
  chunkId: string;
  bookId: string;
  index: number;
  startOffset: number;
  endOffset: number;
  textHash: string;
  estimatedTokens: number;
  chapterHint?: string;
  sceneHint?: string;
  status: PersistentRecordStatus;
  updatedAt: string;
}

export interface PersistentNovelProcessJob {
  jobId: string;
  bookId: string;
  status: PersistentRecordStatus;
  stage: NovelAiStage;
  currentTargetId?: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  promptVersion: string;
  modelName?: string;
  agentParams: Record<string, unknown>;
  tokenUsage: TokenUsageRecord;
  retryCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  heartbeatAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PersistentAgentTask {
  taskId: string;
  jobId: string;
  bookId: string;
  targetType: "chunk" | "chapter" | "scene" | "outline" | "job";
  targetId: string;
  status: PersistentRecordStatus;
  promptVersion: string;
  modelName?: string;
  agentParams: Record<string, unknown>;
  retryCount: number;
  tokenUsage: TokenUsageRecord;
  startedAt?: string;
  updatedAt: string;
  heartbeatAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface ChunkResult {
  chunkId: string;
  bookId: string;
  status: PersistentRecordStatus;
  resultText: string;
  partialResult?: NovelAiChunkPartial;
  summary: string;
  continuityNotes: string[];
  tokenUsage: TokenUsageRecord;
  generatedAt?: string;
  promptVersion: string;
  modelName?: string;
  retryCount: number;
  errorMessage?: string;
}

export interface ChapterResult {
  chapterId: string;
  bookId: string;
  status: PersistentRecordStatus;
  title: string;
  resultText: string;
  summary: string;
  continuityNotes: string[];
  chunkIds: string[];
  sceneIds: string[];
  tokenUsage: TokenUsageRecord;
  generatedAt?: string;
  promptVersion: string;
  modelName?: string;
  retryCount: number;
  errorMessage?: string;
}

export interface JobEventLog {
  eventId: string;
  jobId: string;
  bookId?: string;
  taskId?: string;
  targetType?: PersistentAgentTask["targetType"];
  targetId?: string;
  level: "info" | "warning" | "error" | "success";
  type: string;
  message: string;
  createdAt: string;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

export interface NovelPersistenceState {
  schemaVersion: "1.0.0";
  sessionSnapshot?: NovelImportSession;
  importJobSnapshot?: ProgressiveImportJob;
  progressSnapshot?: ProgressState;
  processingSnapshot?: NovelProcessingState;
  inspectableResults: NovelAiInspectableResult[];
  errors: string[];
  warnings: string[];
  books: Record<string, PersistentBookImportRecord>;
  activeBookId?: string;
  chapters: Record<string, PersistentChapterRecord>;
  chunks: Record<string, PersistentChunkRecord>;
  jobs: Record<string, PersistentNovelProcessJob>;
  activeJobId?: string;
  tasks: Record<string, PersistentAgentTask>;
  chunkResults: Record<string, ChunkResult>;
  chapterResults: Record<string, ChapterResult>;
  events: JobEventLog[];
  updatedAt: string;
}

export interface NovelAiChunkAnalysis {
  chunk_id: string;
  index: number;
  summary: string;
  chapter_candidates: ChapterCandidate[];
  characters: CharacterCandidate[];
  locations: string[];
  timeline: string[];
  foreshadowing: string[];
  warnings: string[];
  confidence: number;
}

export interface NovelAiChunkSummary {
  chunk_id: string;
  index: number;
  summary: string;
  confidence: number;
  warnings: string[];
}

export interface NovelAiChunkEntityIndex {
  chapter_candidates: ChapterCandidate[];
  characters: CharacterCandidate[];
  locations: string[];
  warnings: string[];
}

export interface NovelAiChunkTimelineNotes {
  timeline: string[];
  foreshadowing: string[];
  warnings: string[];
}

export interface NovelAiChunkPartial {
  document_id?: string;
  chunk_id?: string;
  start_offset?: number;
  end_offset?: number;
  text_hash?: string;
  summary?: NovelAiChunkSummary;
  entities?: NovelAiChunkEntityIndex;
  timeline?: NovelAiChunkTimelineNotes;
}

export interface NovelAiOutline {
  document_id: string;
  title: string;
  summary: string;
  main_plot: string;
  chapters: ChapterCandidate[];
  characters: CharacterCandidate[];
  timeline: string[];
  locations: string[];
  branch_or_foreshadowing: string[];
  conflict_points: ConflictPoint[];
  warnings: string[];
  needs_review: boolean;
  coverage_confidence: number;
}

export interface NovelAiOutlineMainline {
  document_id: string;
  title: string;
  summary: string;
  main_plot: string;
  needs_review: boolean;
  coverage_confidence: number;
  warnings: string[];
}

export interface NovelAiOutlineStructure {
  chapters: ChapterCandidate[];
  timeline: string[];
  branch_or_foreshadowing: string[];
  conflict_points: ConflictPoint[];
  warnings: string[];
}

export interface NovelAiOutlineIndex {
  characters: CharacterCandidate[];
  locations: string[];
  warnings: string[];
}

export interface NovelAiOutlinePartial {
  mainline?: NovelAiOutlineMainline;
  structure?: NovelAiOutlineStructure;
  index?: NovelAiOutlineIndex;
}

export interface ProgressiveImportJob {
  importLineId: string;
  graphImportMode?: "blank_autoconnect" | "append_isolated";
  layoutStartPosition?: { x: number; y: number };
  layoutColumnGap?: number;
  layoutRowGap?: number;
  layoutColumns?: number;
  status: ProgressiveImportStatus;
  total: number;
  generatedCount: number;
  failedSceneIds: string[];
  skippedSceneIds?: string[];
  lastInsertedNodeId?: string;
  cancelRequested: boolean;
  pauseRequested?: boolean;
  skipRequested?: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface AssetSuggestion {
  suggestion_id: string;
  asset_type: string;
  description: string;
  suggested_asset_id: string;
  prompt_hint: string;
  source_scene_id: string;
  source_scene_display_name?: string;
}

export interface BranchSuggestion {
  suggestion_id: string;
  source_scene_id: string;
  source_scene_display_name?: string;
  choice_display_name?: string;
  choice_text: string;
  branch_summary: string;
  confidence: number;
  enabled_by_default: boolean;
}

export type ConflictPointType =
  | "timeline"
  | "motivation"
  | "fact"
  | "missing_transition"
  | "branch_opportunity";

export interface ConflictPoint {
  conflict_id: string;
  source_scene_id: string;
  source_scene_display_name?: string;
  conflict_type: ConflictPointType;
  description: string;
  mainline_resolution: string;
  suggests_branch: boolean;
  confidence: number;
  branch_suggestion_ids: string[];
}

export interface AdaptSceneRequest {
  scene_candidate: SceneCandidate;
  known_characters: CharacterCandidate[];
  previous_scene_summary?: string;
  import_options: ImportOptions;
  memory_mode: MemoryMode;
}

export interface AdaptSceneResponse {
  adapted_scene: AdaptedScene;
  character_updates: CharacterCandidate[];
  asset_suggestions: AssetSuggestion[];
  branch_suggestions: BranchSuggestion[];
  conflict_points: ConflictPoint[];
  warnings: string[];
}

export interface ImportReport {
  total_chars: number;
  chapter_count: number;
  scene_count: number;
  adapted_scene_count: number;
  character_count: number;
  warning_count: number;
  unresolved_speaker_count: number;
  missing_asset_suggestion_count: number;
  branch_suggestion_count: number;
}

export type NovelImportRiskLevel = "low" | "medium" | "high";

export interface NovelImportQualityMetric {
  key: string;
  label: string;
  value: string;
  score: number;
  status: "good" | "warning" | "danger";
}

export interface NovelImportQualityIssue {
  code: string;
  severity: "info" | "warning" | "danger" | "blocked";
  message: string;
  evidence?: string;
  action?: string;
  sourceSceneId?: string;
}

export interface NovelImportQualityReport {
  score: number;
  threshold: number;
  risk_level: NovelImportRiskLevel;
  risk_flag: boolean;
  reasons: string[];
  metrics: NovelImportQualityMetric[];
  dimensions: NovelImportQualityMetric[];
  blocking_issues: NovelImportQualityIssue[];
  scene_coverage_ratio: number;
  suggested_scene_count: number;
  planned_scene_count: number;
  branch_suggestion_count: number;
  usable_branch_suggestion_count: number;
  character_count: number;
  dialogue_command_count: number;
  narration_command_count: number;
  dialogue_narration_ratio: number | null;
  unparsed_paragraph_ratio: number;
}

export interface ProgressState {
  phase: string;
  current: number;
  total: number;
  message: string;
  cancellable: boolean;
  stageLabel?: string;
  detail?: string;
  startedAt?: number;
  updatedAt?: number;
  lastResponseMs?: number;
}

export type NovelAiInspectablePhase = "scan" | "outline" | "planning" | "blueprint";
export type NovelAiInspectableStatus = "waiting" | "streaming" | "parsed" | "review" | "failed";
export type NovelImportValidationStatus = "passed" | "fixed" | "blocked";

export interface NovelImportValidationReport {
  id: string;
  phase: "planning" | "blueprint";
  status: NovelImportValidationStatus;
  title: string;
  sceneId?: string;
  sourceSceneCandidateId?: string;
  checkedAt: string;
  passed: string[];
  fixes: string[];
  warnings: string[];
  errors: string[];
}

export interface NovelAiInspectableResult {
  id: string;
  phase: NovelAiInspectablePhase;
  title: string;
  chapterId?: string;
  chapterTitle?: string;
  chapterIndex?: number;
  sourceRange?: { start: number; end: number };
  status: NovelAiInspectableStatus;
  modelLabel: string;
  summary: string;
  payload: unknown;
  warnings: string[];
  error?: string;
  createdAt: string;
}

export const defaultImportOptions: ImportOptions = {
  language: "zh-CN",
  target_style: "visual_novel",
  preserve_original_dialogue: true,
  narration_density: "medium",
  split_scene_aggressiveness: "medium",
  generate_background_hints: true,
  generate_sprite_hints: true,
  generate_bgm_hints: false,
  generate_animation_hints: true,
  memory_mode: "none",
  max_chunk_chars: 6000,
  max_scene_chars: 2200,
  allow_branch_suggestions: true,
};

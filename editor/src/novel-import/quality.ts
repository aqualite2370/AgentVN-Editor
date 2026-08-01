import type { AdaptedScene, NovelImportQualityIssue, NovelImportQualityMetric, NovelImportQualityReport, NovelImportSession, SceneCandidate } from "./types";
import type { GameCommand } from "../types/commands";

const QUALITY_THRESHOLD = 70;

export function suggestedSceneCountForText(totalChars: number, maxSceneChars = 2200): number {
  if (totalChars <= 0) return 1;
  return Math.max(1, Math.ceil(totalChars / Math.max(900, maxSceneChars)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function mergeSpans(spans: Array<{ start: number; end: number }>, totalChars: number): Array<{ start: number; end: number }> {
  const normalized = spans
    .map((span) => ({
      start: Math.max(0, Math.min(totalChars, Math.floor(span.start))),
      end: Math.max(0, Math.min(totalChars, Math.ceil(span.end))),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of normalized) {
    const last = merged[merged.length - 1];
    if (!last || span.start > last.end) merged.push({ ...span });
    else last.end = Math.max(last.end, span.end);
  }
  return merged;
}

function coverageRatio(spans: Array<{ start: number; end: number }>, totalChars: number): number {
  if (totalChars <= 0) return 0;
  return clamp01(mergeSpans(spans, totalChars).reduce((sum, span) => sum + span.end - span.start, 0) / totalChars);
}

function paragraphRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /\S(?:[\s\S]*?\S)?(?=\n\s*\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;
    if (value.trim()) ranges.push({ start, end });
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  return ranges;
}

function spanContains(spans: Array<{ start: number; end: number }>, point: number): boolean {
  return spans.some((span) => point >= span.start && point <= span.end);
}

function unparsedParagraphRatio(text: string, spans: Array<{ start: number; end: number }>, totalChars: number): number {
  const paragraphs = paragraphRanges(text);
  if (paragraphs.length === 0) return 0;
  const merged = mergeSpans(spans, totalChars);
  const uncovered = paragraphs.filter((paragraph) => !spanContains(merged, Math.floor((paragraph.start + paragraph.end) / 2)));
  return clamp01(uncovered.length / paragraphs.length);
}

function sceneSpan(scene: SceneCandidate): { start: number; end: number } {
  return {
    start: scene.source_span?.start_offset ?? scene.start_offset,
    end: scene.source_span?.end_offset ?? scene.end_offset,
  };
}

function adaptedSpan(scene: AdaptedScene): { start: number; end: number } {
  return {
    start: scene.source_mapping.start_offset,
    end: scene.source_mapping.end_offset,
  };
}

function collectCommands(session: NovelImportSession): GameCommand[] {
  const adaptedCommands = session.adapted_scenes.flatMap((scene) => scene.scene_beat.commands);
  if (adaptedCommands.length > 0) return adaptedCommands;
  return session.scenes.flatMap((scene) => scene.commands ?? []);
}

const lowQualityVisibleTextPattern = /章节原文缺失|原文内容缺失|原文缺失|原文不可用|原文未提供|未返回结构化\s*scenes|fallback\s*scene|待复核的\s*subagent\s*输出|source text is incomplete|source is incomplete/i;

function commandVisibleText(command: GameCommand): string[] {
  const record = command as unknown as Record<string, unknown>;
  return ["text", "speaker", "character_id", "background_id", "sprite_id", "image_id", "image_display_name", "caption", "alt"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string");
}

function collectLowQualityIssues(session: NovelImportSession): NovelImportQualityIssue[] {
  const issues: NovelImportQualityIssue[] = [];
  const adaptedScenes = session.adapted_scenes;
  const sceneRows = adaptedScenes.length > 0
    ? adaptedScenes.map((scene) => ({
      sceneId: scene.scene_beat.scene_id,
      title: scene.scene_beat.title,
      summary: scene.scene_beat.summary,
      warnings: scene.warnings,
      commands: scene.scene_beat.commands,
    }))
    : session.scenes.map((scene) => ({
      sceneId: scene.scene_candidate_id,
      title: scene.title,
      summary: scene.summary,
      warnings: [],
      commands: scene.commands ?? [],
    }));
  for (const scene of sceneRows) {
    const visible = [
      scene.title,
      scene.summary,
      ...scene.warnings,
      ...scene.commands.flatMap(commandVisibleText),
    ].join("\n");
    const match = visible.match(lowQualityVisibleTextPattern);
    if (match) {
      issues.push({
        code: "player_visible_low_quality_text",
        severity: "blocked",
        message: `玩家可见文本包含低质量诊断话术：${match[0]}`,
        evidence: visible.slice(0, 260),
        action: "重跑对应场景或手动改写，禁止把诊断话术写入最终剧情。",
        sourceSceneId: scene.sceneId,
      });
    }
  }
  return issues;
}

function metric(input: NovelImportQualityMetric): NovelImportQualityMetric {
  return input;
}

export function evaluateNovelImportQuality(session: NovelImportSession): NovelImportQualityReport {
  const totalChars = session.document?.total_chars ?? 0;
  const maxSceneChars = session.import_options.max_scene_chars || 2200;
  const suggestedSceneCount = suggestedSceneCountForText(totalChars, maxSceneChars);
  const sceneSpans = session.scenes.map(sceneSpan);
  const adaptedSpans = session.adapted_scenes.map(adaptedSpan);
  const allSpans = adaptedSpans.length > 0 ? adaptedSpans : sceneSpans;
  const sceneCoverage = coverageRatio(allSpans, totalChars);
  const unparsedRatio = unparsedParagraphRatio(session.document?.normalized_text ?? "", allSpans, totalChars);
  const plannedSceneCount = session.scenes.length;
  const branchSuggestionCount = session.branch_suggestions.length;
  const usableBranchSuggestionCount = session.branch_suggestions.filter((suggestion) => suggestion.confidence >= 0.6).length;
  const characterCount = session.characters.length;
  const commands = collectCommands(session);
  const dialogueCommandCount = commands.filter((command) => command.type === "dialog").length;
  const narrationCommandCount = commands.filter((command) => command.type === "narration").length;
  const backgroundCommandCount = commands.filter((command) => command.type === "background").length;
  const spriteCommandCount = commands.filter((command) => command.type === "sprite").length;
  const brokenCommandCount = commands.filter((command) => {
    if (command.type === "dialog") return !command.text.trim();
    if (command.type === "narration") return !command.text.trim();
    if (command.type === "background") return !command.background_id.trim();
    if (command.type === "show_image") return !command.image_id.trim();
    if (command.type === "sprite") return !command.character_id.trim();
    return false;
  }).length;
  const spokenCommandCount = dialogueCommandCount + narrationCommandCount;
  const lowQualityIssues = collectLowQualityIssues(session);
  const dialogueNarrationRatio = spokenCommandCount > 0 ? dialogueCommandCount / spokenCommandCount : null;
  const ratioScore = dialogueNarrationRatio === null
    ? 0.5
    : dialogueNarrationRatio >= 0.2 && dialogueNarrationRatio <= 0.85
      ? 1
      : dialogueNarrationRatio >= 0.1 && dialogueNarrationRatio <= 0.92
        ? 0.55
        : 0.2;
  const branchTarget = session.import_options.allow_branch_suggestions ? 1 : 0;
  const branchScore = branchTarget === 0 ? 0.5 : Math.max(0.75, clamp01(usableBranchSuggestionCount / branchTarget));
  const sceneCountScore = clamp01(plannedSceneCount / suggestedSceneCount);
  const characterScore = clamp01(characterCount / 2);
  const commandCompletenessScore = commands.length === 0 ? 0.35 : clamp01(1 - brokenCommandCount / Math.max(1, commands.length));
  const lowQualityTextScore = lowQualityIssues.length === 0 ? 1 : 0;
  const assetReadinessScore = plannedSceneCount === 0 ? 0.5 : clamp01((backgroundCommandCount + spriteCommandCount) / Math.max(1, plannedSceneCount));
  const score = Math.round(
    sceneCoverage * 24 +
    sceneCountScore * 15 +
    branchScore * 12 +
    characterScore * 12 +
    ratioScore * 8 +
    (1 - unparsedRatio) * 9 +
    commandCompletenessScore * 8 +
    lowQualityTextScore * 8 +
    assetReadinessScore * 4,
  );

  const reasons: string[] = [];
  if (plannedSceneCount < suggestedSceneCount) reasons.push(`场景数不足：建议至少 ${suggestedSceneCount} 个，当前 ${plannedSceneCount} 个。`);
  if (sceneCoverage < 0.82) reasons.push(`场景覆盖率偏低：当前 ${percent(sceneCoverage)}。`);
  if (!session.import_options.allow_branch_suggestions) reasons.push("分支建议已关闭，本次导入会缺少可改编分歧提示。");
  if (characterCount === 0) reasons.push("未识别到可用角色。");
  if (dialogueNarrationRatio !== null && dialogueNarrationRatio < 0.15) reasons.push(`对白占比偏低：当前 ${percent(dialogueNarrationRatio)}。`);
  if (dialogueNarrationRatio !== null && dialogueNarrationRatio > 0.9) reasons.push(`旁白占比偏低：对白/旁白比例失衡，当前对白 ${percent(dialogueNarrationRatio)}。`);
  if (unparsedRatio > 0.15) reasons.push(`未解析段落偏高：当前 ${percent(unparsedRatio)}。`);
  if (brokenCommandCount > 0) reasons.push(`命令字段不完整：发现 ${brokenCommandCount} 条对白、旁白或素材命令缺字段。`);
  if (lowQualityIssues.length > 0) reasons.push(`玩家可见文本存在 ${lowQualityIssues.length} 处低质量诊断话术，必须修复后再发布。`);

  const hasBlockedIssue = lowQualityIssues.some((issue) => issue.severity === "blocked");
  const riskFlag = score < QUALITY_THRESHOLD || reasons.length > 0 || hasBlockedIssue;
  const riskLevel = hasBlockedIssue ? "high" : score >= QUALITY_THRESHOLD && reasons.length <= 1 ? "low" : score >= 55 ? "medium" : "high";
  const metrics = [
    metric({ key: "scene_coverage", label: "场景覆盖率", value: percent(sceneCoverage), score: Math.round(sceneCoverage * 100), status: sceneCoverage >= 0.9 ? "good" : sceneCoverage >= 0.75 ? "warning" : "danger" }),
    metric({ key: "scene_count", label: "场景数", value: `${plannedSceneCount}/${suggestedSceneCount}`, score: Math.round(sceneCountScore * 100), status: plannedSceneCount >= suggestedSceneCount ? "good" : plannedSceneCount >= Math.max(1, suggestedSceneCount - 1) ? "warning" : "danger" }),
    metric({ key: "branches", label: "分支建议", value: `${usableBranchSuggestionCount}/${branchTarget || 1}`, score: Math.round(branchScore * 100), status: !session.import_options.allow_branch_suggestions || usableBranchSuggestionCount < branchTarget ? "warning" : "good" }),
    metric({ key: "characters", label: "角色识别", value: `${characterCount}`, score: Math.round(characterScore * 100), status: characterCount >= 2 ? "good" : characterCount === 1 ? "warning" : "danger" }),
    metric({ key: "dialogue_ratio", label: "对白/旁白", value: dialogueNarrationRatio === null ? "无对白/旁白" : percent(dialogueNarrationRatio), score: Math.round(ratioScore * 100), status: ratioScore >= 1 ? "good" : ratioScore >= 0.5 ? "warning" : "danger" }),
    metric({ key: "unparsed", label: "未解析段落", value: percent(unparsedRatio), score: Math.round((1 - unparsedRatio) * 100), status: unparsedRatio <= 0.08 ? "good" : unparsedRatio <= 0.18 ? "warning" : "danger" }),
    metric({ key: "commands", label: "命令完整性", value: `${commands.length - brokenCommandCount}/${commands.length || 1}`, score: Math.round(commandCompletenessScore * 100), status: commandCompletenessScore >= 0.95 ? "good" : commandCompletenessScore >= 0.82 ? "warning" : "danger" }),
    metric({ key: "low_quality_text", label: "低质文本风险", value: lowQualityIssues.length === 0 ? "0" : `${lowQualityIssues.length}`, score: Math.round(lowQualityTextScore * 100), status: lowQualityIssues.length === 0 ? "good" : "danger" }),
    metric({ key: "asset_readiness", label: "素材演出就绪", value: `${backgroundCommandCount + spriteCommandCount}/${plannedSceneCount || 1}`, score: Math.round(assetReadinessScore * 100), status: assetReadinessScore >= 0.9 ? "good" : assetReadinessScore >= 0.55 ? "warning" : "danger" }),
  ];
  const dimensions = metrics.filter((item) => [
    "scene_coverage",
    "scene_count",
    "characters",
    "branches",
    "commands",
    "low_quality_text",
    "asset_readiness",
  ].includes(item.key));

  return {
    score,
    threshold: QUALITY_THRESHOLD,
    risk_level: riskLevel,
    risk_flag: riskFlag,
    reasons,
    metrics,
    dimensions,
    blocking_issues: lowQualityIssues,
    scene_coverage_ratio: sceneCoverage,
    suggested_scene_count: suggestedSceneCount,
    planned_scene_count: plannedSceneCount,
    branch_suggestion_count: branchSuggestionCount,
    usable_branch_suggestion_count: usableBranchSuggestionCount,
    character_count: characterCount,
    dialogue_command_count: dialogueCommandCount,
    narration_command_count: narrationCommandCount,
    dialogue_narration_ratio: dialogueNarrationRatio,
    unparsed_paragraph_ratio: unparsedRatio,
  };
}

import {
  parseCustomComponentMarkup,
  type CustomComponentDefinition,
} from "../renpy/customComponentMarkup";
import type { UILayoutScreenId } from "../../../shared/cartridge/uiSkin";

export const assistantCreationCapabilities = [
  { id: "read_assistant_context", kind: "agent-tool", label: "读取本次授权快照",
    description: "只读取本次选入的组件、图片别名和控件必要字段；不访问store、工程文件或未授权素材。" },
  { id: "read_assistant_draft", kind: "agent-tool", label: "读取隔离草稿",
    description: "查看本任务当前候选，不能读取其他工程或会话。" },
  { id: "build_assistant_draft", kind: "agent-tool", label: "构建与修改隔离草稿",
    description: "替换本任务候选；类型与授权先校验，不自动合并。" },
  { id: "validate_assistant_draft", kind: "agent-tool", label: "请求本机共享安全校验",
    description: "由所属编辑器实际运行白名单解析器；返回成功、失败或不可用。" },
  { id: "preview_assistant_draft", kind: "agent-tool", label: "请求实际Runtime预览",
    description: "在只读独立Runtime中渲染并返回有限几何/图片诊断，未完成不能声称成功。" },
  {
    id: "submit_assistant_component_draft",
    kind: "agent-tool",
    label: "提交组件与控件修改提案",
    description: "提交最终受限组件候选及最多8个同页面授权控件建议。工程仍须人工审核及基线匹配。",
  },
  {
    id: "editor.validateDraft",
    kind: "editor-step",
    label: "本地安全校验",
    description: "AgentVN 在收到工具结果后用白名单解析器校验；不合格时拒绝并保留旧草稿。",
  },
  {
    id: "editor.previewDraft",
    kind: "editor-step",
    label: "静态预览与审核",
    description: "动作按钮不可执行；审核面板显示动作、绑定和只读源码。",
  },
  {
    id: "user.savePersonalComponent",
    kind: "user-action",
    label: "保存到个人组件库",
    description: "仅用户明确点击后保存；不会自动添加到当前工程布局。",
  },
] as const;

export interface AssistantCreationDraft {
  schemaVersion: 1;
  name: string;
  description: string;
  html: string;
  css: string;
  definition: CustomComponentDefinition;
  assets?: AssistantCreationAuthorizedAsset[];
  generatedAt: string;
  savedComponentId?: string;
  projectBaseline?: AssistantCreationProjectBaseline;
  projectMerge?: AssistantCreationProjectMergeRecord;
}

export interface AssistantCreationProjectMergeRecord {
  projectId: string;
  screenId: "title" | "player" | "game_menu" | "save_load" | "preferences" | "history" | "gallery" | "about" | "help";
  componentId: string;
  appliedAt: string;
}

export interface AssistantCreationReviewItem {
  id: string;
  draft: AssistantCreationDraft;
  screenId: UILayoutScreenId;
  rect: { x: number; y: number; width: number; height: number };
  included: boolean;
}

/** Local-only snapshots captured when a creation request starts; never sent to the model. */
export interface AssistantCreationProjectBaseline {
  projectId: string;
  layoutType: "renpy";
  screens: Partial<Record<
    "title" | "player" | "game_menu" | "save_load" | "preferences" | "history" | "gallery" | "about" | "help",
    string
  >>;
}

export interface AssistantCreationAuthorizedAsset {
  id: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface AssistantCreationDraftParseOptions {
  /** Assets copied from component packages the user explicitly selected for this session. */
  authorizedAssets?: readonly AssistantCreationAuthorizedAsset[];
  /** Existing layout elements the user explicitly selected for this request. */
  authorizedTargets?: readonly AssistantCreationAuthorizedElementTarget[];
}

export interface AssistantCreationAuthorizedComponentContext {
  id: string;
  name: string;
  description: string;
  html: string;
  css: string;
  assets: Array<{ id: string; filename: string; mime_type: string }>;
}

export interface AssistantCreationAuthorizedElementTarget {
  targetId: string;
  screenId: UILayoutScreenId;
  componentType: string;
  label?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface AssistantCreationElementEdit {
  targetId: string;
  screenId: UILayoutScreenId;
  label?: string;
  rect?: Partial<{ x: number; y: number; width: number; height: number }>;
}

export interface AssistantCreationElementEditTarget extends AssistantCreationAuthorizedElementTarget {
  /** Kept in local history only; never serialize this identifier to the model. */
  componentId: string;
}

export interface AssistantCreationElementEditReviewItem {
  id: string;
  baseline: AssistantCreationProjectBaseline;
  target: AssistantCreationElementEditTarget;
  edit: AssistantCreationElementEdit;
  included: boolean;
  appliedAt?: string;
}

export interface AssistantCreationElementEditBatchResult {
  ok: boolean;
  edits?: AssistantCreationElementEdit[];
  issues: string[];
}

export interface AssistantCreationAuthorization {
  components: AssistantCreationAuthorizedComponentContext[];
  authorizedAssets: AssistantCreationAuthorizedAsset[];
}

export function buildAssistantCreationAuthorization(
  selected: readonly {
    name: string;
    description?: string;
    html: string;
    css: string;
    assets?: readonly AssistantCreationAuthorizedAsset[];
  }[],
): AssistantCreationAuthorization {
  if (selected.length > 8) throw new Error("每个创造会话最多授权 8 个个人组件。");
  const components: AssistantCreationAuthorizedComponentContext[] = [];
  const authorizedAssets: AssistantCreationAuthorizedAsset[] = [];
  let totalAssetBytes = 0;
  selected.forEach((component, componentIndex) => {
    const parsed = parseCustomComponentMarkup(component.html, component.css);
    if (!parsed.ok || !parsed.component) {
      throw new Error(`“${component.name}”无法通过本地组件安全校验：${parsed.issues.join(" ")}`);
    }
    if ((component.assets?.length ?? 0) > 16) {
      throw new Error(`“${component.name}”包含过多素材，未加入创造上下文。`);
    }
    const prefix = `selected-${componentIndex + 1}`;
    const idMap = new Map((component.assets ?? []).map((asset) => [asset.id, `${prefix}-${asset.id}`]));
    if (idMap.size !== (component.assets?.length ?? 0)) {
      throw new Error(`“${component.name}”包含重复素材编号，未加入创造上下文。`);
    }
    const referencedAssets = new Set<string>();
    const visit = (node: CustomComponentDefinition["root"]) => {
      if (node.assetId) referencedAssets.add(node.assetId);
      node.children.forEach(visit);
    };
    visit(parsed.component.root);
    const missingAssets = [...referencedAssets].filter((id) => !idMap.has(id));
    if (missingAssets.length) {
      throw new Error(`“${component.name}”引用了组件包中不存在的素材：${missingAssets.join("、")}。`);
    }
    const html = component.html.replace(
      /(\bdata-asset\s*=\s*["'])([^"']+)(["'])/g,
      (match, before: string, id: string, after: string) => {
        const authorizedId = idMap.get(id);
        return authorizedId ? `${before}${authorizedId}${after}` : match;
      },
    );
    const assets = (component.assets ?? []).filter((asset) => referencedAssets.has(asset.id)).map((asset) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(asset.id)
        || !asset.filename.trim()
        || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(asset.mimeType)
        || !(asset.bytes instanceof Uint8Array)
        || !asset.bytes.byteLength
        || asset.bytes.byteLength > 8 * 1024 * 1024) {
        throw new Error(`“${component.name}”包含无效或超限的图片素材。`);
      }
      totalAssetBytes += asset.bytes.byteLength;
      if (totalAssetBytes > 32 * 1024 * 1024) {
        throw new Error("本次授权素材总量超过 32 MiB，尚未发起模型请求。");
      }
      const id = idMap.get(asset.id)!;
      authorizedAssets.push({
        id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        bytes: new Uint8Array(asset.bytes),
      });
      return { id, filename: asset.filename, mime_type: asset.mimeType };
    });
    components.push({
      id: prefix,
      name: component.name,
      description: component.description ?? "",
      html,
      css: component.css,
      assets,
    });
  });
  return { components, authorizedAssets };
}

export interface AssistantCreationResult {
  ok: boolean;
  draft?: AssistantCreationDraft;
  issues: string[];
}

export interface AssistantCreationBatchResult {
  ok: boolean;
  drafts?: AssistantCreationDraft[];
  screenIds?: UILayoutScreenId[];
  edits?: AssistantCreationElementEdit[];
  issues: string[];
}

const reviewScreenIds = new Set<UILayoutScreenId>([
  "title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about", "help",
]);

const elementEditKeys = new Set(["target_id", "screen_id", "label", "rect"]);
const rectKeys = new Set(["x", "y", "width", "height"]);

/**
 * Validate a typed proposal against the exact controls the user authorized.
 * This parser intentionally accepts no component structure, action, style, or
 * arbitrary project data; callers keep the private component id locally.
 */
export function parseAssistantCreationElementEditBatchValue(
  value: unknown,
  authorizedTargets: readonly AssistantCreationAuthorizedElementTarget[],
): AssistantCreationElementEditBatchResult {
  if (!Array.isArray(authorizedTargets) || authorizedTargets.length < 1 || authorizedTargets.length > 8) {
    return { ok: false, issues: ["必须先明确选择 1–8 个现有控件，才能授权 Agent 提出修改。"] };
  }
  const authorizedById = new Map(authorizedTargets.map((target) => [target.targetId, target]));
  if (authorizedById.size !== authorizedTargets.length || authorizedTargets.some((target) =>
    !target || typeof target.targetId !== "string" || !target.targetId
    || !reviewScreenIds.has(target.screenId)
    || typeof target.componentType !== "string" || !target.componentType
    || (target.label !== undefined && typeof target.label !== "string")
    || (target.rect !== undefined && !isValidFullRect(target.rect)))) {
    return { ok: false, issues: ["本次授权控件清单无效；没有创建修改提案。"] };
  }
  const payload = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (!payload || Object.keys(payload).length !== 1 || !Array.isArray(payload.edits)
    || payload.edits.length < 1 || payload.edits.length > 8) {
    return { ok: false, issues: ["控件修改提案必须包含 1–8 项；没有创建提案。"] };
  }

  const seen = new Set<string>();
  const edits: AssistantCreationElementEdit[] = [];
  let page: UILayoutScreenId | undefined;
  for (const [index, raw] of payload.edits.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, issues: [`第 ${index + 1} 项不是有效控件修改。`] };
    }
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !elementEditKeys.has(key))
      || typeof entry.target_id !== "string" || typeof entry.screen_id !== "string") {
      return { ok: false, issues: [`第 ${index + 1} 项包含不支持的控件或字段；没有创建提案。`] };
    }
    const target = authorizedById.get(entry.target_id);
    if (!target || target.screenId !== entry.screen_id) {
      return { ok: false, issues: [`第 ${index + 1} 项目标不在用户授权范围内；没有创建提案。`] };
    }
    if (seen.has(entry.target_id)) {
      return { ok: false, issues: ["同一控件不能在一个提案中重复修改。"] };
    }
    if (page && page !== target.screenId) {
      return { ok: false, issues: ["一次控件修改只能针对同一页面；没有创建提案。"] };
    }
    page = target.screenId;

    let label: string | undefined;
    if (entry.label !== undefined) {
      if (typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 160) {
        return { ok: false, issues: [`第 ${index + 1} 项的文字标签无效。`] };
      }
      label = entry.label.trim();
    }

    let rect: AssistantCreationElementEdit["rect"];
    if (entry.rect !== undefined) {
      if (!target.rect) {
        return { ok: false, issues: [`第 ${index + 1} 项没有可用于校验的原始控件位置。`] };
      }
      if (!entry.rect || typeof entry.rect !== "object" || Array.isArray(entry.rect)) {
        return { ok: false, issues: [`第 ${index + 1} 项的控件位置无效。`] };
      }
      const rawRect = entry.rect as Record<string, unknown>;
      const rectEntries = Object.entries(rawRect);
      if (!rectEntries.length || rectEntries.some(([key, candidate]) => !rectKeys.has(key)
        || typeof candidate !== "number" || !Number.isFinite(candidate))) {
        return { ok: false, issues: [`第 ${index + 1} 项的控件位置包含不支持的值。`] };
      }
      const candidateRect = { ...target.rect, ...rawRect };
      if (!isValidFullRect(candidateRect)) {
        return { ok: false, issues: [`第 ${index + 1} 项的位置超出画布或尺寸范围。`] };
      }
      rect = Object.fromEntries(rectEntries) as AssistantCreationElementEdit["rect"];
    }
    if (label === undefined && rect === undefined) {
      return { ok: false, issues: [`第 ${index + 1} 项没有包含可应用的修改。`] };
    }
    seen.add(entry.target_id);
    edits.push({
      targetId: target.targetId,
      screenId: target.screenId,
      ...(label !== undefined ? { label } : {}),
      ...(rect ? { rect } : {}),
    });
  }
  return { ok: true, edits, issues: [] };
}

function isValidFullRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rect = value as Record<string, unknown>;
  if (Object.keys(rect).length !== 4
    || !["x", "y", "width", "height"].every((key) => typeof rect[key] === "number" && Number.isFinite(rect[key]))) {
    return false;
  }
  const { x, y, width, height } = rect as { x: number; y: number; width: number; height: number };
  return x >= 0 && y >= 0 && width > 0 && height > 0
    && width <= 100 && height <= 100 && x + width <= 100 && y + height <= 100;
}

const safeBindings = [
  "project.title",
  "project.author",
  "runtime.scene_title",
  "runtime.speaker",
] as const;

const safeBindingSet = new Set<string>(safeBindings);

function parseJsonObject(answer: string): Record<string, unknown> | undefined {
  const trimmed = answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function parseAssistantCreationDraft(
  answer: string,
  now = new Date().toISOString(),
  options: AssistantCreationDraftParseOptions = {},
): AssistantCreationResult {
  const payload = parseJsonObject(answer);
  if (!payload) {
    return { ok: false, issues: ["模型没有返回有效的组件 JSON；草稿未创建。"] };
  }
  return parseAssistantCreationDraftValue(payload, now, options);
}

export function parseAssistantCreationDraftValue(
  value: unknown,
  now = new Date().toISOString(),
  options: AssistantCreationDraftParseOptions = {},
): AssistantCreationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: ["组件结果格式无效；草稿未创建。"] };
  }
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  if (keys.join(",") !== ["css", "description", "html", "name"].join(",")) {
    return { ok: false, issues: ["组件结果字段无效；仅接受 name、description、html、css。"] };
  }
  const { name, description, html, css } = payload;
  if (typeof name !== "string" || !name.trim() || name.length > 160
    || typeof description !== "string" || description.length > 1000
    || typeof html !== "string" || typeof css !== "string") {
    return { ok: false, issues: ["组件名称、说明或标记格式无效；草稿未创建。"] };
  }

  const parsed = parseCustomComponentMarkup(html, css);
  if (!parsed.ok || !parsed.component) {
    return { ok: false, issues: parsed.issues };
  }
  const referencedAssets = new Set<string>();
  const inspectAssets = (node: CustomComponentDefinition["root"]) => {
    if (node.tag === "img" || node.assetId) {
      if (node.assetId) referencedAssets.add(node.assetId);
    }
    node.children.forEach(inspectAssets);
  };
  inspectAssets(parsed.component.root);
  const authorizedAssets = options.authorizedAssets ?? [];
  if (!Array.isArray(authorizedAssets) || authorizedAssets.some((asset) =>
    !asset || typeof asset !== "object" || typeof asset.id !== "string"
    || typeof asset.filename !== "string" || typeof asset.mimeType !== "string")) {
    return { ok: false, issues: ["本会话授权素材清单格式无效；草稿未创建。"] };
  }
  const authorizedById = new Map(authorizedAssets.map((asset) => [asset.id, asset]));
  const invalidAuthorizedAsset = authorizedAssets.some((asset) =>
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(asset.id)
    || !asset.filename.trim()
    || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(asset.mimeType)
    || !(asset.bytes instanceof Uint8Array)
    || !asset.bytes.byteLength
    || asset.bytes.byteLength > 8 * 1024 * 1024);
  if (invalidAuthorizedAsset || authorizedById.size !== authorizedAssets.length
    || authorizedAssets.reduce((size, asset) => size + asset.bytes.byteLength, 0) > 32 * 1024 * 1024) {
    return { ok: false, issues: ["本会话授权素材清单无效或超出安全限制；草稿未创建。"] };
  }
  const hasUnauthorizedAssets = [...referencedAssets].some((assetId) => !authorizedById.has(assetId));
  if (hasUnauthorizedAssets) {
    return { ok: false, issues: ["草稿引用了未授权或未选入本会话的素材；草稿未创建。"] };
  }
  const usedAssets = [...referencedAssets].map((assetId) => authorizedById.get(assetId)!);
  /* Keep only referenced asset copies in the isolated draft, never the whole selected library. */
  const assetCopies = usedAssets.map((asset) => ({
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    bytes: new Uint8Array(asset.bytes),
  }));
  const unauthorizedBindings = new Set<string>();
  const inspectBindings = (node: CustomComponentDefinition["root"]) => {
    if (node.binding && !safeBindingSet.has(node.binding)) unauthorizedBindings.add(node.binding);
    node.children.forEach(inspectBindings);
  };
  inspectBindings(parsed.component.root);
  if (unauthorizedBindings.size) {
    return {
      ok: false,
      issues: [`组件引用了未授权的数据绑定：${[...unauthorizedBindings].join("、")}。`],
    };
  }
  return {
    ok: true,
    issues: [],
    draft: {
      schemaVersion: 1,
      name: name.trim(),
      description: description.trim().slice(0, 1000),
      html,
      css,
      definition: parsed.component,
      ...(assetCopies.length ? { assets: assetCopies } : {}),
      generatedAt: now,
    },
  };
}

export function parseAssistantCreationDraftBatchValue(
  value: unknown,
  now = new Date().toISOString(),
  options: AssistantCreationDraftParseOptions = {},
): AssistantCreationBatchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: ["组件集合格式无效；草稿未创建。"] };
  }
  const payload = value as Record<string, unknown>;
  const legacySingle = Object.keys(payload).sort().join(",") === "css,description,html,name";
  const allowedBatchKeys = new Set(["components", "edits"]);
  const rawComponents = legacySingle ? [payload] : payload.components ?? [];
  const rawEdits = legacySingle ? [] : payload.edits ?? [];
  if ((!legacySingle && (Object.keys(payload).some((key) => !allowedBatchKeys.has(key))
    || !Array.isArray(rawComponents) || !Array.isArray(rawEdits)))
    || !Array.isArray(rawComponents) || !Array.isArray(rawEdits)
    || rawComponents.length + rawEdits.length < 1 || rawComponents.length + rawEdits.length > 16) {
    return { ok: false, issues: ["组件与控件提案合计必须包含 1–16 项；草稿未创建。"] };
  }
  const drafts: AssistantCreationDraft[] = [];
  let totalAssetBytes = 0;
  const screenIds: UILayoutScreenId[] = [];
  for (let index = 0; index < rawComponents.length; index += 1) {
    const candidate = rawComponents[index];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, issues: [`第 ${index + 1} 项不是有效组件对象；整批未创建。`] };
    }
    const entry = candidate as Record<string, unknown>;
    const screenId = entry.screen_id ?? "title";
    if (typeof screenId !== "string" || !reviewScreenIds.has(screenId as UILayoutScreenId)) {
      return { ok: false, issues: [`第 ${index + 1} 项指定了不支持的目标页面；整批未创建。`] };
    }
    const { screen_id: _screenId, ...draftValue } = entry;
    const result = parseAssistantCreationDraftValue(draftValue, now, options);
    if (!result.ok || !result.draft) {
      return {
        ok: false,
        issues: result.issues.map((issue) => `第 ${index + 1} 项“${entry.name ?? "未命名"}”：${issue}`),
      };
    }
    totalAssetBytes += result.draft.assets?.reduce((sum, asset) => sum + asset.bytes.byteLength, 0) ?? 0;
    if (totalAssetBytes > 32 * 1024 * 1024) {
      return { ok: false, issues: ["组件集合复制后的授权素材总量超过 32 MiB；整批未创建。"] };
    }
    drafts.push(result.draft);
    screenIds.push(screenId as UILayoutScreenId);
  }
  let edits: AssistantCreationElementEdit[] = [];
  if (rawEdits.length) {
    const editResult = parseAssistantCreationElementEditBatchValue(
      { edits: rawEdits },
      options.authorizedTargets ?? [],
    );
    if (!editResult.ok || !editResult.edits) return { ok: false, issues: editResult.issues };
    edits = editResult.edits;
  }
  if (drafts.length && edits.length
    && new Set([...screenIds, ...edits.map((edit) => edit.screenId)]).size > 1) {
    return { ok: false, issues: ["组件与控件修改提案必须位于同一页面；整批未创建。"] };
  }
  return {
    ok: true,
    ...(drafts.length ? { drafts, screenIds } : {}),
    ...(edits.length ? { edits } : {}),
    issues: [],
  };
}

export function validateAssistantCreationDraft(value: unknown): value is AssistantCreationDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<AssistantCreationDraft>;
  if (draft.schemaVersion !== 1
    || typeof draft.name !== "string"
    || typeof draft.description !== "string"
    || typeof draft.html !== "string"
    || typeof draft.css !== "string"
    || typeof draft.generatedAt !== "string"
    || (draft.assets !== undefined && (!Array.isArray(draft.assets) || draft.assets.some((asset) =>
      !asset || typeof asset !== "object" || typeof asset.id !== "string"
      || typeof asset.filename !== "string" || typeof asset.mimeType !== "string"
      || !(asset.bytes instanceof Uint8Array))))
    || (draft.savedComponentId !== undefined && typeof draft.savedComponentId !== "string")
    || (draft.projectBaseline !== undefined && !isAssistantCreationProjectBaseline(draft.projectBaseline))
    || (draft.projectMerge !== undefined && !isAssistantCreationProjectMergeRecord(draft.projectMerge))) return false;
  const parsed = parseAssistantCreationDraftValue({
    name: draft.name,
    description: draft.description,
    html: draft.html,
    css: draft.css,
  }, draft.generatedAt, { authorizedAssets: draft.assets });
  return parsed.ok
    && JSON.stringify(parsed.draft?.definition) === JSON.stringify(draft.definition)
      && JSON.stringify(parsed.draft?.assets?.map(({ id, filename, mimeType }) => ({ id, filename, mimeType })))
      === JSON.stringify(draft.assets?.map(({ id, filename, mimeType }) => ({ id, filename, mimeType })));
}

export function isAssistantCreationProjectBaseline(value: unknown): value is AssistantCreationProjectBaseline {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const baseline = value as Partial<AssistantCreationProjectBaseline>;
  if (typeof baseline.projectId !== "string" || !baseline.projectId
    || baseline.layoutType !== "renpy"
    || !baseline.screens || typeof baseline.screens !== "object" || Array.isArray(baseline.screens)) return false;
  const allowed = new Set([
    "title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about", "help",
  ]);
  return Object.entries(baseline.screens).every(([screenId, snapshot]) =>
    allowed.has(screenId) && typeof snapshot === "string" && snapshot.length <= 512_000);
}

export function validateAssistantCreationElementEditReviewItem(
  value: unknown,
): value is AssistantCreationElementEditReviewItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<AssistantCreationElementEditReviewItem>;
  const target = item.target;
  const edit = item.edit;
  if (typeof item.id !== "string" || !item.id || item.id.length > 180
    || !isAssistantCreationProjectBaseline(item.baseline)
    || !target || typeof target !== "object"
    || typeof target.componentId !== "string" || !target.componentId || target.componentId.length > 160
    || typeof target.targetId !== "string" || !/^target-[1-8]$/.test(target.targetId)
    || !reviewScreenIds.has(target.screenId)
    || typeof target.componentType !== "string" || !target.componentType
    || (target.label !== undefined && typeof target.label !== "string")
    || (target.rect !== undefined && !isValidFullRect(target.rect))
    || !edit || typeof edit !== "object"
    || edit.targetId !== target.targetId || edit.screenId !== target.screenId
    || (edit.label !== undefined && (typeof edit.label !== "string" || !edit.label.trim() || edit.label.length > 160))
    || (edit.rect !== undefined && (!edit.rect || typeof edit.rect !== "object"
      || Object.keys(edit.rect).length === 0
      || Object.entries(edit.rect).some(([key, entry]) =>
        !rectKeys.has(key) || typeof entry !== "number" || !Number.isFinite(entry))))
    || (edit.label === undefined && edit.rect === undefined)
    || typeof item.included !== "boolean"
    || (item.appliedAt !== undefined && (!Number.isFinite(Date.parse(item.appliedAt))))) return false;
  return true;
}

function isAssistantCreationProjectMergeRecord(value: unknown): value is AssistantCreationProjectMergeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<AssistantCreationProjectMergeRecord>;
  return typeof record.projectId === "string" && record.projectId.length > 0
    && typeof record.componentId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(record.componentId)
    && typeof record.appliedAt === "string" && Number.isFinite(Date.parse(record.appliedAt))
    && ["title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about", "help"]
      .includes(String(record.screenId));
}

import { Check, Copy, Eye, Layers3, Sparkles } from "lucide-react";
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import {
  parseAssistantCreationDraftValue,
  type AssistantCreationDraft,
  type AssistantCreationElementEditReviewItem,
  type AssistantCreationElementEditTarget,
  type AssistantCreationReviewItem,
} from "../../assistant/creationAgent";
import {
  planAssistantCreationElementEditBatch,
  planAssistantCreationProjectMergeBatch,
} from "../../assistant/assistantCreationProjectMerge";
import type { UILayoutScreenId } from "../../../../shared/cartridge/uiSkin";
import { useProjectStore } from "../../store/projectStore";
import type { PersonalComponentRecord } from "../../renpy/personalComponentLibrary";
import { stableSerialize } from "../../utils/stableSerialize";
import { AssistantCreationDraftPreview } from "./AssistantCreationDraftPreview";
import { AssistantProjectAssetAuthorization } from "./AssistantProjectAssetAuthorization";

const RenpyRuntimePreview = lazy(() =>
  import("../advanced/RenpyRuntimePreview").then(module => ({ default: module.RenpyRuntimePreview })));

const examples = [
  {
    id: "title-actions",
    title: "标题页操作",
    prompt: "为标题页构建一个轻量的作品标题与“开始游戏”“继续游戏”操作区，文字按钮不使用大块容器。",
    html: '<div class="root"><span class="title" data-bind="project.title"></span><button type="button" class="button" aria-label="开始游戏" data-action="start_game">开始游戏</button><button type="button" class="button" aria-label="继续游戏" data-action="open_save_load">继续游戏</button></div>',
    css: ".root { display: flex; flex-direction: column; align-items: start; gap: 10px; padding: 14px; background-color: #15243b; } .title { color: #ffffff; font-size: 22px; font-weight: 700; } .button { color: #ffffff; background-color: #263c5c; border-color: #7894ba; border-width: 1px; border-style: solid; padding: 9px 14px; border-radius: 4px; }",
  },
  {
    id: "quick-controls",
    title: "剧情快捷操作",
    prompt: "为剧情界面构建一组克制的“自动播放”“快进”“帮助”按钮，采用紧凑横向排布与清晰焦点状态。",
    html: '<div class="root"><button type="button" class="button" aria-label="切换自动播放" data-action="toggle_auto">自动</button><button type="button" class="button" aria-label="切换快进" data-action="toggle_skip">快进</button><button type="button" class="button" aria-label="打开帮助" data-action="open_help">帮助</button></div>',
    css: ".root { display: flex; flex-direction: row; align-items: center; gap: 8px; padding: 10px; background-color: #111827; } .button { color: #f4f7ff; background-color: #273449; border-color: #51647d; border-width: 1px; border-style: solid; padding: 8px 11px; border-radius: 4px; font-size: 13px; } .button:focus-visible { border-color: #92bfff; }",
  },
  {
    id: "project-info",
    title: "作品信息卡片",
    prompt: "构建一个简洁的作品信息卡片，展示作品标题和作者，不添加按钮或外部资源。",
    html: '<div class="root"><span class="label">作品</span><span class="title" data-bind="project.title"></span><span class="body" data-bind="project.author"></span></div>',
    css: ".root { display: flex; flex-direction: column; gap: 7px; padding: 16px; background-color: #18202c; border-color: #46566d; border-width: 1px; border-style: solid; border-radius: 6px; } .label { color: #9aabc2; font-size: 11px; } .title { color: #f7f8fc; font-size: 19px; font-weight: 700; } .body { color: #bdc8d8; font-size: 13px; }",
  },
] as const;

function makeExampleDraft(example: typeof examples[number]): AssistantCreationDraft {
  const parsed = parseAssistantCreationDraftValue({
    name: example.title,
    description: "内置安全示例：可先查看效果，再将需求带入创造对话。",
    html: example.html,
    css: example.css,
  });
  if (!parsed.ok || !parsed.draft) throw new Error(parsed.issues.join(" "));
  return parsed.draft;
}

const exampleDrafts = examples.map(makeExampleDraft);

const screenLabels: Record<UILayoutScreenId, string> = {
  title: "标题",
  player: "对白",
  game_menu: "共享游戏菜单",
  save_load: "存档与读档",
  preferences: "选项",
  history: "历史",
  gallery: "画廊",
  about: "关于",
  help: "帮助",
};

export function AssistantCreationWorkbenchStudio({
  draft,
  reviewItems,
  elementEditItems,
  busy,
  onSave,
  onMerge,
  onMergeBatch,
  onReviewItemsChange,
  onElementEditItemsChange,
  onElementEditTargetsChange,
  onMergeElementEdits,
  onChoosePrompt,
  personalComponents,
  authorizedComponentIds,
  onToggleAuthorizedComponent,
  authorizedProjectAssetIds = [],
  onToggleAuthorizedProjectAsset,
}: {
  draft?: AssistantCreationDraft;
  reviewItems?: AssistantCreationReviewItem[];
  elementEditItems?: AssistantCreationElementEditReviewItem[];
  busy: boolean;
  onSave: (draft?: AssistantCreationDraft) => void;
  onMerge: (screenId: UILayoutScreenId, rect: { x: number; y: number; width: number; height: number }) =>
    { ok: boolean; reason: string };
  onMergeBatch?: (items: AssistantCreationReviewItem[]) => { ok: boolean; reason: string };
  onReviewItemsChange?: (items: AssistantCreationReviewItem[]) => void;
  onElementEditItemsChange?: (items: AssistantCreationElementEditReviewItem[]) => void;
  onElementEditTargetsChange?: (targets: AssistantCreationElementEditTarget[]) => void;
  onMergeElementEdits?: (items: AssistantCreationElementEditReviewItem[]) => { ok: boolean; reason: string };
  onChoosePrompt: (prompt: string) => void;
  personalComponents: PersonalComponentRecord[];
  authorizedComponentIds: string[];
  onToggleAuthorizedComponent: (componentId: string, checked: boolean) => void;
  authorizedProjectAssetIds?: string[];
  onToggleAuthorizedProjectAsset?: (id: string, checked: boolean) => void;
}) {
  const project = useProjectStore();
  const projectId = useProjectStore(state => state.projectId);
  const [selectedExampleId, setSelectedExampleId] = useState<string>(examples[0].id);
  const [componentSearch, setComponentSearch] = useState("");
  const [selectedReviewItemId, setSelectedReviewItemId] = useState<string>();
  const [batchStatus, setBatchStatus] = useState<string>();
  const [batchRuntimePreviewOpen, setBatchRuntimePreviewOpen] = useState(false);
  const [previewMobile, setPreviewMobile] = useState(false);
  const [elementTargetScreenId, setElementTargetScreenId] = useState<UILayoutScreenId>("title");
  const [authorizedElementSelection, setAuthorizedElementSelection] = useState<{
    projectId: string;
    ids: string[];
  }>(() => ({ projectId, ids: [] }));
  const authorizedElementIds = authorizedElementSelection.projectId === projectId
    ? authorizedElementSelection.ids
    : [];
  const setAuthorizedElementIds = (update: string[] | ((current: string[]) => string[])) => {
    setAuthorizedElementSelection(current => {
      const currentIds = current.projectId === projectId ? current.ids : [];
      return {
        projectId,
        ids: typeof update === "function" ? update(currentIds) : update,
      };
    });
  };
  const [elementEditPreviewOpen, setElementEditPreviewOpen] = useState(false);
  const [elementEditStatus, setElementEditStatus] = useState<string>();
  const currentLayout = useProjectStore(state => state.settings.runtimeUILayout);
  const currentAssets = useProjectStore(state => state.assetManifest);
  const layoutType = useProjectStore(state => state.settings.runtimeUILayoutProfiles?.activeType ?? "agentvn");
  const selectedIndex = Math.max(0, examples.findIndex(example => example.id === selectedExampleId));
  const selectedExample = examples[selectedIndex];
  const exampleDraft = useMemo(() => exampleDrafts[selectedIndex], [selectedIndex]);
  const targetScreen = currentLayout?.screens.find(screen => screen.screen_id === elementTargetScreenId);
  const editableComponents = (targetScreen?.components ?? []).filter(component =>
    component.visible !== false && component.locked !== true && Boolean(component.rect));
  const authorizedElementTargets = useMemo(() => {
    if (!targetScreen) return [];
    return targetScreen.components
      .filter(component => authorizedElementIds.includes(component.component_id)
        && component.visible !== false && component.locked !== true && Boolean(component.rect))
      .map((component, index): AssistantCreationElementEditTarget => ({
        targetId: `target-${index + 1}`,
        screenId: targetScreen.screen_id,
        componentId: component.component_id,
        componentType: component.component_type,
        ...(component.label !== undefined ? { label: component.label } : {}),
        ...(component.rect ? { rect: { ...component.rect } } : {}),
      }));
  }, [authorizedElementIds, targetScreen]);
  const reviewItem = reviewItems?.find(item => item.id === selectedReviewItemId) ?? reviewItems?.[0];
  const previewDraft = reviewItem?.draft ?? draft ?? exampleDraft;
  const isBatchReview = Boolean(reviewItems?.length);
  const isElementEditReview = Boolean(elementEditItems?.length);
  const visibleComponents = personalComponents.filter((component) =>
    `${component.name} ${component.description}`.toLocaleLowerCase("zh-CN")
      .includes(componentSearch.trim().toLocaleLowerCase("zh-CN")));
  const batchPreviewPlan = useMemo(() => {
    const included = reviewItems?.filter(item => item.included) ?? [];
    const baseline = included[0]?.draft.projectBaseline;
    if (!batchRuntimePreviewOpen || !currentLayout || !baseline || included.length === 0
      || included.some(item => !item.draft.projectBaseline
        || item.draft.projectBaseline.projectId !== baseline.projectId)) return undefined;
    return planAssistantCreationProjectMergeBatch({
      currentProjectId: projectId,
      currentLayout,
      currentAssets,
      baseline,
      items: included.map(item => ({
        itemId: item.id,
        screenId: item.screenId,
        rect: item.rect,
        draft: item.draft,
        componentId: `assistant-preview-${item.id.replace(/[^A-Za-z0-9._:-]/g, "-")}`,
      })),
      createAssetId: (() => {
        let index = 0;
        return () => `assistant-preview-asset-${++index}`;
      })(),
    });
  }, [batchRuntimePreviewOpen, currentAssets, currentLayout, projectId, reviewItems]);
  const placementConflicts = useMemo(() => {
    const included = reviewItems?.filter(item => item.included && !item.draft.projectMerge) ?? [];
    const conflicts: Array<{ first: string; second: string; screenId: UILayoutScreenId }> = [];
    for (let firstIndex = 0; firstIndex < included.length; firstIndex += 1) {
      const first = included[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < included.length; secondIndex += 1) {
        const second = included[secondIndex];
        if (first.screenId !== second.screenId) continue;
        const overlap = first.rect.x < second.rect.x + second.rect.width
          && first.rect.x + first.rect.width > second.rect.x
          && first.rect.y < second.rect.y + second.rect.height
          && first.rect.y + first.rect.height > second.rect.y;
        if (overlap) {
          conflicts.push({ first: first.draft.name, second: second.draft.name, screenId: first.screenId });
        }
      }
    }
    return conflicts;
  }, [reviewItems]);
  const includedElementEdits = elementEditItems?.filter(item => item.included && !item.appliedAt) ?? [];
  const elementEditBaseline = includedElementEdits[0]?.baseline;
  const elementEditPlan = useMemo(() => {
    if (!elementEditPreviewOpen || !currentLayout || !elementEditBaseline || !includedElementEdits.length) {
      return undefined;
    }
    if (includedElementEdits.some(item => stableSerialize(item.baseline) !== stableSerialize(elementEditBaseline))) {
      return { status: "conflict" as const, reason: "修改候选的工程基线不一致。" };
    }
    return planAssistantCreationElementEditBatch({
      currentProjectId: projectId,
      currentLayout,
      baseline: elementEditBaseline,
      authorizedTargets: includedElementEdits.map(item => item.target),
      edits: includedElementEdits.map(item => item.edit),
    });
  }, [currentLayout, elementEditBaseline, elementEditPreviewOpen, includedElementEdits, projectId]);

  useEffect(() => {
    if (reviewItems?.length && !reviewItems.some(item => item.id === selectedReviewItemId)) {
      setSelectedReviewItemId(reviewItems[0].id);
    }
  }, [reviewItems, selectedReviewItemId]);

  useEffect(() => {
    onElementEditTargetsChange?.(authorizedElementTargets);
  }, [authorizedElementTargets, onElementEditTargetsChange]);

  useLayoutEffect(() => {
    setAuthorizedElementSelection(current => current.projectId === projectId
      ? current
      : { projectId, ids: [] });
  }, [projectId]);

  useEffect(() => {
    if (elementEditItems?.length && authorizedElementIds.length) {
      setAuthorizedElementIds([]);
    }
  }, [elementEditItems, authorizedElementIds.length]);

  const updateElementEditItem = (id: string, included: boolean) => {
    if (!elementEditItems || !onElementEditItemsChange) return;
    onElementEditItemsChange(elementEditItems.map(item =>
      item.id === id ? { ...item, included } : item));
    setElementEditStatus(undefined);
  };

  const updateReviewItem = (
    id: string,
    update: Partial<Pick<AssistantCreationReviewItem, "included" | "screenId" | "rect">>,
  ) => {
    if (!reviewItems || !onReviewItemsChange) return;
    if (update.included === false && (selectedReviewItemId ?? reviewItems[0]?.id) === id) {
      const nextIncludedItem = reviewItems.find(item =>
        item.id !== id && item.included && !item.draft.projectMerge);
      setSelectedReviewItemId(nextIncludedItem?.id);
    }
    onReviewItemsChange(reviewItems.map(item => item.id === id
      ? { ...item, ...update, rect: update.rect ? { ...item.rect, ...update.rect } : item.rect }
      : item));
    setBatchStatus(undefined);
  };

  return (
    <aside className="assistant-creation-workbench-studio"
      data-testid="assistant-creation-workbench-studio"
      data-has-draft={Boolean(draft || reviewItems?.length || elementEditItems?.length)}
      aria-label="组件预览与调用示例">
      <header className="assistant-creation-studio-heading">
        <div>
          <span className="assistant-creation-eyebrow"><Eye size={13} />同窗预览</span>
          <h4>{isBatchReview ? `审核组件候选 · ${reviewItems!.length} 项`
            : isElementEditReview ? `审核现有控件修改 · ${elementEditItems!.length} 项`
            : draft ? "正在审核生成草稿" : "组件示例与构建起点"}</h4>
        </div>
        <span className={`assistant-creation-studio-state${draft || isBatchReview || isElementEditReview ? " is-draft" : ""}`}>
          {isElementEditReview ? <><Check size={12} />隔离修改</>
            : draft || isBatchReview ? <><Check size={12} />隔离草稿</> : "示例模式"}
        </span>
      </header>
      {!draft && !isBatchReview && !isElementEditReview && (
        <div className="assistant-creation-example-picker" role="group" aria-label="选择组件构建示例">
          {examples.map(example => (
            <button key={example.id} type="button" data-testid="assistant-creation-example-choice"
              aria-pressed={selectedExampleId === example.id}
              onClick={() => setSelectedExampleId(example.id)}>
              {example.title}
            </button>
          ))}
        </div>
      )}
      <section className="assistant-creation-authorized-components"
        data-testid="assistant-creation-authorized-components"
        aria-label="本会话可用的个人组件">
        <header>
          <strong>本会话授权组件</strong>
          <span>{authorizedComponentIds.length}/8 · 不选则不向 AI 提供个人组件</span>
        </header>
        <label className="assistant-creation-component-search">
          <span>搜索个人组件</span>
          <input aria-label="搜索个人组件" value={componentSearch}
            onChange={(event) => setComponentSearch(event.currentTarget.value)}
            placeholder="按名称或说明筛选" />
        </label>
        {visibleComponents.length ? (
          <ul>
            {visibleComponents.map((component) => (
              <li key={component.id}>
                <label>
                  <input type="checkbox" aria-label={`授权组件 ${component.name}`}
                    checked={authorizedComponentIds.includes(component.id)} disabled={busy}
                    onChange={(event) => onToggleAuthorizedComponent(component.id, event.currentTarget.checked)} />
                  <span><strong>{component.name}</strong>
                    <small>{component.assets?.length ?? 0} 个随包图片素材 · 只向 AI 发送组件结构与素材名称，不发送图片字节</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : <p>{personalComponents.length ? "没有匹配的个人组件。" : "个人组件库为空；可先在“客户端布局 → 个人组件”创建或导入。"}</p>}
      </section>
      {onToggleAuthorizedProjectAsset && <AssistantProjectAssetAuthorization assets={currentAssets}
        selectedIds={authorizedProjectAssetIds} busy={busy} onToggle={onToggleAuthorizedProjectAsset} />}
      <section className="assistant-creation-element-authorization"
        data-testid="assistant-creation-authorized-element-targets"
        aria-label="授权修改已有控件">
        <header>
          <strong>修改现有布局控件</strong>
          <span>仅本次请求 · 默认不授权 · 最多 8 项</span>
        </header>
        {layoutType === "renpy" && currentLayout?.layout_type === "renpy" ? (
          <>
            <label className="assistant-creation-element-page">
              <span>选择页面</span>
              <select aria-label="选择控件页面" value={elementTargetScreenId}
                disabled={busy}
                onChange={event => {
                  setElementTargetScreenId(event.currentTarget.value as UILayoutScreenId);
                  setAuthorizedElementIds([]);
                  onElementEditTargetsChange?.([]);
                }}>
                {currentLayout.screens.map(screen => (
                  <option key={screen.screen_id} value={screen.screen_id}>
                    {screenLabels[screen.screen_id] ?? screen.screen_id}
                  </option>
                ))}
              </select>
            </label>
            {editableComponents.length ? (
              <ul>
                {editableComponents.map((component, index) => {
                  const label = component.label?.trim() || screenLabels[component.component_type as UILayoutScreenId]
                    || component.component_type;
                  const checked = authorizedElementIds.includes(component.component_id);
                  return (
                    <li key={component.component_id}>
                      <label>
                        <input type="checkbox" aria-label={`授权修改 ${label}`}
                          checked={checked} disabled={busy || (!checked && authorizedElementIds.length >= 8)}
                          onChange={event => {
                            const checkedNow = event.currentTarget.checked;
                            setAuthorizedElementIds(current => checkedNow
                              ? [...current, component.component_id].slice(-8)
                              : current.filter(id => id !== component.component_id));
                          }} />
                        <span><strong>{label}</strong>
                          <small>{component.component_type} · {Math.round(component.rect!.x)}%, {Math.round(component.rect!.y)}%</small>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : <p>当前页面没有可编辑的控件。</p>}
            <p className="assistant-creation-element-authorization-note">
              授权后，Agent 只能建议修改这些控件的文案或位置/尺寸；不发送工程控件 ID，不开放动作、样式或结构修改。
            </p>
            {authorizedElementTargets.length > 0 && (
              <output aria-live="polite" data-testid="assistant-creation-element-authorization-count">
                本次将授权 {authorizedElementTargets.length} 个控件
              </output>
            )}
          </>
        ) : <p>请切换到“进阶”布局后，才能选择并授权现有页面控件。</p>}
      </section>
      {elementEditItems?.length ? (
        <section className="assistant-creation-element-edit-review"
          data-testid="assistant-creation-element-edit-review" aria-label="审核现有控件修改">
          <header>
            <div>
              <strong>审核现有控件修改 · {elementEditItems.length} 项</strong>
              <span>仅勾选项会预览和应用；工程尚未修改。</span>
            </div>
            <span>{elementEditItems.filter(item => item.appliedAt).length
              ? `${elementEditItems.filter(item => item.appliedAt).length} 项已应用`
              : "隔离提案"}</span>
          </header>
          <ol>
            {elementEditItems.map(item => {
              const rectSummary = (rect?: { x: number; y: number; width: number; height: number }) =>
                rect ? `X ${rect.x}% · Y ${rect.y}% · 宽 ${rect.width}% · 高 ${rect.height}%` : "未设置";
              const currentComponent = currentLayout?.screens.find(screen => screen.screen_id === item.target.screenId)
                ?.components.find(component => component.component_id === item.target.componentId);
              const targetChanged = !item.appliedAt && (!currentComponent
                || currentComponent.component_type !== item.target.componentType
                || currentComponent.label !== item.target.label
                || stableSerialize(currentComponent.rect) !== stableSerialize(item.target.rect));
              return (
                <li key={item.id} data-included={item.included} data-applied={Boolean(item.appliedAt)}>
                  <label>
                    <input type="checkbox" aria-label={`审核修改 ${item.target.label ?? item.target.componentType}`}
                      checked={item.included} disabled={busy || Boolean(item.appliedAt)}
                      onChange={event => updateElementEditItem(item.id, event.currentTarget.checked)} />
                    <span><strong>{item.target.label || item.target.componentType}</strong>
                      <small>{screenLabels[item.target.screenId]} · {item.target.componentType}</small>
                    </span>
                  </label>
                  <dl>
                    {item.edit.label !== undefined && (
                      <div><dt>文字</dt><dd><del>{item.target.label || "（空）"}</del><span aria-hidden="true"> → </span>
                        <strong>{item.edit.label}</strong></dd></div>
                    )}
                    {item.edit.rect && (
                      <div><dt>位置/尺寸</dt><dd><del>{rectSummary(item.target.rect)}</del><span aria-hidden="true"> → </span>
                        <strong>{rectSummary({ ...(item.target.rect ?? { x: 0, y: 0, width: 1, height: 1 }), ...item.edit.rect })}</strong></dd></div>
                    )}
                    {targetChanged && <div role="alert">原控件已变化，当前预览和应用将被阻止</div>}
                  </dl>
                </li>
              );
            })}
          </ol>
          <div className="assistant-creation-element-edit-actions">
            <span role="status">{elementEditStatus || `${includedElementEdits.length} 项待应用`}</span>
            <button type="button" disabled={!includedElementEdits.length}
              aria-expanded={elementEditPreviewOpen}
              onClick={() => setElementEditPreviewOpen(open => !open)}>
              {elementEditPreviewOpen ? "收起页面预览" : "预览修改后的 Runtime 页面"}
            </button>
            <button type="button" data-testid="assistant-creation-merge-element-edits"
              disabled={busy || !includedElementEdits.length || !onMergeElementEdits
                || elementEditItems.some(item => item.included && item.appliedAt !== undefined)}
              onClick={() => {
                if (!onMergeElementEdits) return;
                const result = onMergeElementEdits(includedElementEdits);
                setElementEditStatus(result.reason);
              }}>审核并应用所选修改</button>
          </div>
          {elementEditPreviewOpen && (
            <div className="assistant-creation-element-edit-runtime" data-testid="assistant-creation-element-edit-runtime">
              {elementEditPlan?.status === "ready" ? (
                <div className="assistant-creation-runtime-preview-stage"
                  style={{ "--assistant-runtime-preview-height-ratio": previewMobile ? "0.4497" : "0.5625" } as CSSProperties}>
                  <Suspense fallback={<div role="status" className="assistant-creation-runtime-preview-placeholder">
                    正在载入隔离的修改预览…
                  </div>}>
                    <RenpyRuntimePreview
                      key={`element-edit:${elementEditBaseline?.projectId}:${includedElementEdits[0]?.id}:${previewMobile}`}
                      draft={elementEditPlan.layout}
                      page={includedElementEdits[0].target.screenId}
                      mobile={previewMobile}
                      assetManifest={currentAssets}
                      interactive={false}
                    />
                  </Suspense>
                </div>
              ) : <p role="status">{elementEditPlan?.status === "conflict"
                ? elementEditPlan.reason
                : "选择至少一个未应用的修改后预览。"}</p>}
              <div className="assistant-creation-runtime-preview-device" role="group" aria-label="控件修改预览设备">
                <button type="button" aria-pressed={!previewMobile} onClick={() => setPreviewMobile(false)}>桌面</button>
                <button type="button" aria-pressed={previewMobile} onClick={() => setPreviewMobile(true)}>移动</button>
              </div>
            </div>
          )}
        </section>
      ) : null}
      {isBatchReview && (
        <section className="assistant-creation-review-batch" data-testid="assistant-creation-review-batch"
          aria-label="逐项审核组件候选">
          <header>
            <strong>逐项审核</strong>
            <span>取消勾选的候选不会写入工程；提交时整批一次核验。</span>
          </header>
          <ol>
            {reviewItems!.map((item, index) => {
              const baselinePageIds = Object.keys(item.draft.projectBaseline?.screens ?? {}) as UILayoutScreenId[];
              const pageIds = baselinePageIds.length ? baselinePageIds : Object.keys(screenLabels) as UILayoutScreenId[];
              return <li key={item.id} data-included={item.included}>
                <div className="assistant-creation-review-item-heading">
                  <label>
                    <input type="checkbox" aria-label={`应用候选 ${item.draft.name}`}
                      checked={item.included} disabled={busy || Boolean(item.draft.projectMerge)}
                      onChange={event => updateReviewItem(item.id, { included: event.currentTarget.checked })} />
                    <span>{index + 1}. {item.draft.name}</span>
                  </label>
                  <button type="button" aria-pressed={reviewItem?.id === item.id}
                    onClick={() => setSelectedReviewItemId(item.id)}>预览</button>
                </div>
                <div className="assistant-creation-review-item-fields">
                  <label><span>目标页面</span>
                    <select aria-label={`${item.draft.name} 目标页面`} value={item.screenId}
                      disabled={busy || Boolean(item.draft.projectMerge)}
                      onChange={event => updateReviewItem(item.id, {
                        screenId: event.currentTarget.value as UILayoutScreenId,
                      })}>
                      {pageIds.map(id => <option key={id} value={id}>{screenLabels[id]}</option>)}
                    </select>
                  </label>
                  {(["x", "y", "width", "height"] as const).map(key => (
                    <label key={key}>
                      <span>{{ x: "X", y: "Y", width: "宽", height: "高" }[key]} %</span>
                      <input aria-label={`${item.draft.name} ${key}`}
                        type="number" min={key === "width" || key === "height" ? 1 : 0}
                        max={100} step={1} value={item.rect[key]}
                        disabled={busy || Boolean(item.draft.projectMerge)}
                        onChange={event => {
                          const value = Number(event.currentTarget.value);
                          if (Number.isFinite(value)) updateReviewItem(item.id, {
                            rect: { [key]: value } as AssistantCreationReviewItem["rect"],
                          });
                        }} />
                    </label>
                  ))}
                </div>
              </li>;
            })}
          </ol>
          <div className="assistant-creation-review-batch-actions">
            <span role="status">{batchStatus || `${reviewItems!.filter(item => item.included).length} 项已选中`}</span>
            <button type="button" data-testid="assistant-creation-merge-batch"
              disabled={busy || !reviewItems!.some(item => item.included) || !onMergeBatch
                || placementConflicts.length > 0
                || reviewItems!.some(item => item.included && !item.draft.projectBaseline)
                || reviewItems!.some(item => item.included
                  && (item.rect.x < 0 || item.rect.y < 0 || item.rect.width <= 0 || item.rect.height <= 0
                    || item.rect.x + item.rect.width > 100 || item.rect.y + item.rect.height > 100))}
              onClick={() => {
                if (!onMergeBatch) return;
                try {
                  const result = onMergeBatch(reviewItems!.filter(item => item.included));
                  setBatchStatus(result.reason);
                } catch (error) {
                  setBatchStatus(error instanceof Error
                    ? `批量应用失败：${error.message}`
                    : "批量应用失败；工程未修改。");
                }
              }}>审核并批量应用</button>
          </div>
          <p className={`assistant-creation-placement-conflicts${placementConflicts.length ? " has-conflicts" : ""}`}
            data-testid="assistant-creation-placement-conflicts"
            data-conflicted={placementConflicts.length > 0}
            role={placementConflicts.length ? "alert" : "status"}>
            {placementConflicts.length
              ? `检测到 ${placementConflicts.length} 处位置重叠：${placementConflicts.map(conflict =>
                `“${conflict.first}”与“${conflict.second}”在“${screenLabels[conflict.screenId]}”页面相互覆盖`,
              ).join("；")}。请调整页面或坐标后再应用。`
              : "所选候选没有位置重叠。"}
          </p>
          <div className="assistant-creation-batch-runtime" data-testid="assistant-creation-batch-runtime">
            <header>
              <strong>整批 Runtime 预览</strong>
              <button type="button" disabled={!reviewItems!.some(item => item.included)}
                aria-expanded={batchRuntimePreviewOpen}
                onClick={() => setBatchRuntimePreviewOpen(open => !open)}>
                {batchRuntimePreviewOpen ? "收起 Runtime 预览" : "预览所选候选组合"}
              </button>
            </header>
            {batchRuntimePreviewOpen && (
              <>
                <div className="assistant-creation-runtime-preview-device" role="group" aria-label="批量 Runtime 预览设备">
                  <button type="button" aria-pressed={!previewMobile} onClick={() => setPreviewMobile(false)}>桌面</button>
                  <button type="button" aria-pressed={previewMobile} onClick={() => setPreviewMobile(true)}>移动</button>
                </div>
                {batchPreviewPlan?.status === "ready" && reviewItem ? (
                  <div className="assistant-creation-runtime-preview-stage"
                    style={{ "--assistant-runtime-preview-height-ratio": previewMobile ? "0.4497" : "0.5625" } as CSSProperties}>
                    <Suspense fallback={<div role="status" className="assistant-creation-runtime-preview-placeholder">
                      正在载入隔离 Runtime 预览…
                    </div>}>
                      <RenpyRuntimePreview
                        draft={batchPreviewPlan.layout}
                        page={reviewItem.screenId}
                        mobile={previewMobile}
                        assetManifest={batchPreviewPlan.assets}
                        interactive={false}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <p role="status">{batchPreviewPlan?.status === "conflict"
                    ? batchPreviewPlan.reason
                    : "至少选择一个通过工程基线校验的候选才能预览。"}</p>
                )}
              </>
            )}
          </div>
        </section>
      )}
      {(!isElementEditReview || draft || isBatchReview) && <div className="assistant-creation-studio-preview-shell">
        <div className="assistant-creation-studio-preview-label">
          <span><Layers3 size={13} />{isBatchReview ? "当前候选预览" : draft ? "生成结果" : "效果预览"}</span>
          <span>{draft || isBatchReview ? "尚未合并到工程" : "静态安全预览"}</span>
        </div>
        <AssistantCreationDraftPreview
          key={`${reviewItem?.id ?? (draft ? "draft" : "example")}-${previewDraft.name}`}
          draft={previewDraft}
          busy={busy || (!draft && !isBatchReview)}
          onSave={() => onSave(reviewItem?.draft ?? draft)}
          onMerge={isBatchReview ? undefined : onMerge}
          hideProjectMerge={isBatchReview}
          hideRuntimePreview={isBatchReview}
          readOnly={!draft && !isBatchReview}
          previewBindings={{
            "project.title": project.title,
            "project.author": project.author,
          }}
        />
      </div>}
      {!draft && !isBatchReview && !isElementEditReview && (
        <>
          <section className="assistant-creation-integration-example"
            data-testid="assistant-creation-integration-example" aria-label="组件调用示例">
            <header><Copy size={13} /><strong>组件调用示例</strong></header>
            <p>按钮使用受限的 <code>data-action</code> 绑定 AgentVN 操作；保存后从“客户端布局 → 个人组件”添加到目标页面。</p>
            <pre><code>{`<button type="button" class="button"\n  data-action="open_help">打开帮助</button>`}</code></pre>
          </section>
          <button type="button" className="assistant-creation-use-example"
            onClick={() => onChoosePrompt(selectedExample.prompt)}>
            <Sparkles size={14} />用“{selectedExample.title}”填入构建需求
          </button>
        </>
      )}
      {draft && !isBatchReview && (
        <p className="assistant-creation-review-hint">
          草稿目前只存在于本次创造会话。保存到个人组件库后，再手动添加到工程布局；预览不会执行动作。
        </p>
      )}
    </aside>
  );
}

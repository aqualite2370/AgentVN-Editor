import { createElement, lazy, Suspense, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { AssistantCreationDraft } from "../../assistant/creationAgent";
import { planAssistantCreationProjectMerge } from "../../assistant/assistantCreationProjectMerge";
import type { CustomComponentAction, CustomComponentNode } from "../../renpy/customComponentMarkup";
import type { UILayoutScreenId } from "../../../../shared/cartridge/uiSkin";
import { useProjectStore } from "../../store/projectStore";
import { stableSerialize } from "../../utils/stableSerialize";
import { assistantCreationDefaultRect } from "../../assistant/creationPlacement";

const RenpyRuntimePreview = lazy(() =>
  import("../advanced/RenpyRuntimePreview").then((module) => ({ default: module.RenpyRuntimePreview })));

const actionLabels: Record<CustomComponentAction, string> = {
  start_game: "开始游戏",
  open_save_load: "打开存档/读档",
  open_preferences: "打开选项",
  open_history: "打开历史",
  open_gallery: "打开画廊",
  open_about: "打开关于",
  open_help: "打开帮助",
  close_menu: "收起菜单",
  rollback: "回退",
  toggle_auto: "切换自动播放",
  toggle_skip: "切换快进",
  quick_save: "快速存档",
  quick_load: "快速读档",
};

const bindingExamples: Record<string, string> = {
  "project.title": "示例作品标题",
  "project.author": "示例作者",
  "runtime.scene_title": "当前场景",
  "runtime.speaker": "角色名称",
};

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

type ComponentRect = { x: number; y: number; width: number; height: number };

function toReactStyle(style: Record<string, string> | undefined): CSSProperties {
  if (!style) return {};
  return Object.fromEntries(Object.entries(style).map(([key, value]) => [
    key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    ["opacity", "font-weight", "line-height", "flex"].includes(key) ? Number(value) : value,
  ])) as CSSProperties;
}

function assetDataUrl(asset: NonNullable<AssistantCreationDraft["assets"]>[number]): string {
  let binary = "";
  for (let offset = 0; offset < asset.bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...asset.bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${asset.mimeType};base64,${btoa(binary)}`;
}

function renderNode(
  node: CustomComponentNode,
  index: number,
  draft: AssistantCreationDraft,
  bindings: Record<string, string>,
): ReactNode {
  const tag = node.tag;
  const className = node.className;
  const children = node.binding
    ? bindings[node.binding] ?? bindingExamples[node.binding] ?? ""
    : node.text !== undefined
      ? node.text
      : node.children.map((child, childIndex) => renderNode(child, childIndex, draft, bindings));
  const attributes = {
    key: `${tag}-${index}`,
    className,
    "aria-label": node.ariaLabel,
    "data-preview-action": node.action,
    style: toReactStyle(className ? draft.definition.styles[`.${className}`] : undefined),
    ...(tag === "img" ? {
      src: draft.assets?.find((asset) => asset.id === node.assetId)
        ? assetDataUrl(draft.assets.find((asset) => asset.id === node.assetId)!)
        : undefined,
      alt: node.ariaLabel ?? "",
      "data-asset-id": node.assetId,
    } : {}),
    ...(tag === "button" ? { type: "button", disabled: true, tabIndex: -1 } : {}),
  };
  return createElement(tag, attributes, ...(tag === "img" ? [] : [children]));
}

export function AssistantCreationDraftPreview({
  draft,
  busy,
  onSave,
  readOnly = false,
  previewBindings,
  onMerge,
  hideProjectMerge = false,
  hideRuntimePreview = false,
}: {
  draft: AssistantCreationDraft;
  busy: boolean;
  onSave: () => void;
  readOnly?: boolean;
  previewBindings?: Record<string, string>;
  onMerge?: (screenId: UILayoutScreenId, rect: ComponentRect) => { ok: boolean; reason: string };
  hideProjectMerge?: boolean;
  hideRuntimePreview?: boolean;
}) {
  const projectId = useProjectStore((state) => state.projectId);
  const currentLayout = useProjectStore((state) => state.settings.runtimeUILayout);
  const activeLayoutType = useProjectStore((state) => state.settings.runtimeUILayoutProfiles?.activeType ?? "agentvn");
  const currentAssets = useProjectStore((state) => state.assetManifest);
  const [screenId, setScreenId] = useState<UILayoutScreenId>("title");
  const [rect, setRect] = useState<ComponentRect>(() =>
    assistantCreationDefaultRect(0, 1, "title"));
  const [mergeStatus, setMergeStatus] = useState<string>();
  const [actualPreviewOpen, setActualPreviewOpen] = useState(false);
  const [previewMobile, setPreviewMobile] = useState(false);
  const baselineScreens = Object.keys(draft.projectBaseline?.screens ?? {}) as UILayoutScreenId[];
  const selectedScreenId = baselineScreens.includes(screenId) ? screenId : baselineScreens[0];
  const selectedScreen = selectedScreenId
    ? currentLayout?.screens.find((screen) => screen.screen_id === selectedScreenId)
    : undefined;
  const mergeProblem = draft.projectMerge
    ? "此草稿已应用到所属工程。"
    : !draft.projectBaseline
      ? "此草稿没有生成时的页面基线；只能保存到个人组件库，请在“进阶”布局中重新构建以应用到工程。"
      : projectId !== draft.projectBaseline.projectId
        ? "当前工程与草稿所属工程不同；请切回原工程后再应用。"
        : activeLayoutType !== "renpy" || currentLayout?.layout_type !== "renpy"
          ? "请切回“进阶”布局后审核并应用。"
          : !selectedScreenId || !selectedScreen
            ? "目标页面已不存在，不能应用此草稿。"
            : stableSerialize(selectedScreen) !== draft.projectBaseline.screens[selectedScreenId]
            ? `“${screenLabels[selectedScreenId]}”页面在草稿生成后发生了变化；为避免覆盖新内容，已阻止合并。`
            : "";
  const actualPreviewPlan = useMemo(() => {
    if (!actualPreviewOpen || !selectedScreenId || !currentLayout) return undefined;
    const suffix = draft.generatedAt.replace(/[^a-zA-Z0-9]/g, "").slice(-24) || "draft";
    let assetIndex = 0;
    return planAssistantCreationProjectMerge({
      currentProjectId: projectId,
      currentLayout,
      currentAssets,
      baseline: draft.projectBaseline,
      targetScreenId: selectedScreenId,
      rect,
      draft,
      componentId: `assistant-preview-${suffix}`,
      createAssetId: () => `assistant-preview-${suffix}-${++assetIndex}`,
    });
  }, [actualPreviewOpen, currentAssets, currentLayout, draft, projectId, rect, selectedScreenId]);
  const actions = new Set<CustomComponentAction>();
  const bindings = new Set<string>();
  const inspect = (node: CustomComponentNode) => {
    if (node.action) actions.add(node.action);
    if (node.binding) bindings.add(node.binding);
    node.children.forEach(inspect);
  };
  inspect(draft.definition.root);
  return (
    <section className="assistant-creation-draft" data-testid={readOnly
      ? "assistant-creation-example-preview" : "assistant-creation-draft"}
      aria-label={readOnly ? "组件示例预览" : "隔离组件草稿"}>
      <header>
        <div>
          <span className="assistant-creation-eyebrow">隔离草稿 · 尚未应用到工程</span>
          <h4>{draft.name}</h4>
          <p>{draft.description}</p>
        </div>
        <span className="assistant-creation-validity">结构校验通过</span>
      </header>
      <div className="assistant-creation-preview" aria-label="组件静态预览">
        {renderNode(draft.definition.root, 0, draft, previewBindings ?? {})}
      </div>
      {!readOnly && !hideRuntimePreview && (
        <section className="assistant-creation-runtime-preview-shell" data-testid="assistant-creation-runtime-preview">
          <div className="assistant-creation-runtime-preview-heading">
            <span>实际 Runtime 页面预览</span>
            <button type="button" disabled={busy || Boolean(mergeProblem) || !onMerge}
              onClick={() => setActualPreviewOpen((open) => !open)}>
              {actualPreviewOpen ? "隐藏完整 Runtime 预览" : "预览完整 Runtime 页面"}
            </button>
          </div>
          {actualPreviewOpen && (
            <>
              <div className="assistant-creation-runtime-preview-device" role="group" aria-label="Runtime 预览设备">
                <button type="button" aria-pressed={!previewMobile} onClick={() => setPreviewMobile(false)}>桌面</button>
                <button type="button" aria-pressed={previewMobile} onClick={() => setPreviewMobile(true)}>移动</button>
              </div>
              {actualPreviewPlan?.status === "ready" && selectedScreenId ? (
                <div className="assistant-creation-runtime-preview-stage"
                  style={{ "--assistant-runtime-preview-height-ratio": previewMobile ? "0.4497" : "0.5625" } as CSSProperties}>
                  <Suspense fallback={<div role="status" className="assistant-creation-runtime-preview-placeholder">
                    正在载入隔离的实际 Runtime 页面…
                  </div>}>
                    <RenpyRuntimePreview
                      key={`${draft.generatedAt}:${selectedScreenId}:${previewMobile ? "mobile" : "desktop"}`}
                      draft={actualPreviewPlan.layout}
                      page={selectedScreenId}
                      mobile={previewMobile}
                      assetManifest={actualPreviewPlan.assets}
                      interactive={false}
                    />
                  </Suspense>
                </div>
              ) : (
                <p role="status">{actualPreviewPlan?.status === "conflict"
                  ? actualPreviewPlan.reason
                  : "当前工程没有可用于预览的布局。"}</p>
              )}
            </>
          )}
        </section>
      )}
      <details className="assistant-creation-review">
        <summary>审核组件结构与权限</summary>
        <div className="assistant-creation-review-content">
          <p><strong>可触发的白名单动作：</strong>
            <span data-testid="assistant-draft-actions">
              {actions.size ? [...actions].map((action) => actionLabels[action]).join("、") : "无"}
            </span>
          </p>
          <p><strong>可读取的数据绑定：</strong>
            <span data-testid="assistant-draft-bindings">
              {bindings.size ? [...bindings].join("、") : "无"}
            </span>
          </p>
          <p><strong>授权素材：</strong><span data-testid="assistant-draft-assets">
            {draft.assets?.length
              ? draft.assets.map((asset) => `${asset.filename} (${asset.mimeType})`).join("、")
              : "未使用；本会话未授权素材。"}
          </span></p>
          <pre aria-label="组件源码（只读文本）"><code>{`<!-- HTML -->\n${draft.html}\n\n/* CSS */\n${draft.css}`}</code></pre>
          <small>源码以文本展示并由受限解析器校验；预览不执行脚本或按钮动作。</small>
        </div>
      </details>
      <footer>
        <small>{readOnly
          ? "这是内置示例；按钮不可执行，也不会写入个人库或工程。"
          : "预览中的按钮已禁用；工程布局、素材与编辑器状态未被修改。"}</small>
        {!readOnly && (
          <button type="button" disabled={busy || Boolean(draft.savedComponentId)}
            onClick={onSave}>
            {draft.savedComponentId ? "已保存到个人组件库" : "保存到个人组件库"}
          </button>
        )}
      </footer>
      {!readOnly && (
        <section className="assistant-creation-project-merge" aria-label="应用到进阶布局"
          data-testid="assistant-creation-project-merge">
          <header>
            <strong>审核后应用到工程</strong>
            <span>只新增一个独立组件；不会覆盖页面或修改个人库原件。</span>
          </header>
          <div className="assistant-creation-project-merge-fields">
            <label>
              <span>目标页面</span>
              <select aria-label="选择目标页面" value={selectedScreenId ?? ""}
                disabled={busy || !baselineScreens.length || Boolean(draft.projectMerge)}
                onChange={(event) => setScreenId(event.currentTarget.value as UILayoutScreenId)}>
                {baselineScreens.map((id) => <option key={id} value={id}>{screenLabels[id]}</option>)}
              </select>
            </label>
            {(["x", "y", "width", "height"] as const).map((key) => (
              <label key={key}>
                <span>{{ x: "X", y: "Y", width: "宽", height: "高" }[key]} %</span>
                <input aria-label={`组件${{ x: "X", y: "Y", width: "宽", height: "高" }[key]}百分比`}
                  type="number" min={key === "width" || key === "height" ? 1 : 0}
                  max={100} step={1} value={rect[key]}
                  disabled={busy || Boolean(draft.projectMerge)}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (!Number.isFinite(value)) return;
                    setRect((current) => ({ ...current, [key]: value }));
                    setMergeStatus(undefined);
                  }} />
              </label>
            ))}
          </div>
          <div className="assistant-creation-project-merge-actions">
            <small role={mergeProblem ? "status" : undefined}
              data-testid="assistant-creation-merge-readiness">
              {mergeStatus || mergeProblem || `将添加到“${selectedScreenId ? screenLabels[selectedScreenId] : "未选择"}”页面，并导入 ${draft.assets?.length ?? 0} 项已授权素材。`}
            </small>
            {!draft.projectMerge && (
              <button type="button" data-testid="assistant-creation-merge-button"
                disabled={busy || Boolean(mergeProblem) || !onMerge
                  || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
                  || rect.x + rect.width > 100 || rect.y + rect.height > 100}
                onClick={() => {
                  if (!selectedScreenId || !onMerge) return;
                  setMergeStatus("正在核对工程与页面基线…");
                  try {
                    const result = onMerge(selectedScreenId, rect);
                    setMergeStatus(result.reason);
                  } catch (error) {
                    setMergeStatus(error instanceof Error
                      ? `应用失败：${error.message}`
                      : "应用失败；工程未修改。");
                  }
                }}>
                审核并应用到进阶布局
              </button>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

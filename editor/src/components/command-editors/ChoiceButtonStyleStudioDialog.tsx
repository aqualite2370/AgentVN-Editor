import { Image, Palette, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RuntimeScript, Scene } from "../../../../shared/cartridge/types";
import type { UILayoutComponentStyle } from "../../../../shared/cartridge/uiSkin";
import {
  LIVE_PREVIEW_PROTOCOL_VERSION,
  type LivePreviewRuntimeMessage,
  type PreviewStartSpec,
} from "../../../../shared/preview/livePreviewProtocol";
import {
  assetIdFromUILayoutReference,
  toUILayoutAssetReference,
} from "../../../../shared/cartridge/uiAssetReference";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { createEditorLivePreviewData } from "../../cartridge/exportCartridge";
import { useProjectStore } from "../../store/projectStore";
import type { ChoiceCommand } from "../../types/commands";
import { manifestAssetsFromProjectAssets } from "../../utils/projectAssets";
import { AssetPicker } from "../common/AssetPicker";
import { RangeControl } from "../common/RangeControl";
import { RichSelect } from "../common/RichSelect";

export type ChoiceButtonStyleScope = "button" | "scene" | "project";

const runtimePreviewUrl = new URL("./gamecli-preview/?preview=1&embedded=1", window.location.href).toString();
const runtimePreviewOrigin = new URL(runtimePreviewUrl).origin;
const previewDebounceMs = 120;

const imageFitOptions = [
  { value: "stretch", label: "拉伸填满" },
  { value: "cover", label: "裁切铺满" },
  { value: "contain", label: "完整显示" },
] as const;

const shadowOptions = [
  { value: "none", label: "无阴影" },
  { value: "soft", label: "柔和阴影" },
  { value: "strong", label: "强调阴影" },
] as const;

function liveAssetUrls(assets: ReturnType<typeof useProjectStore.getState>["assetManifest"]): Record<string, string> {
  return Object.fromEntries(assets.flatMap((asset) => {
    const source = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
    return source ? [[asset.asset_id, source]] : [];
  }));
}

function cleanStyle(style: UILayoutComponentStyle): UILayoutComponentStyle {
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined && value !== ""),
  ) as UILayoutComponentStyle;
}

function projectChoiceStyle(): UILayoutComponentStyle {
  const layout = useProjectStore.getState().settings.runtimeUILayout;
  return layout?.screens
    .find((screen) => screen.screen_id === "player")
    ?.components.find((component) => component.component_type === "choice_option")
    ?.style ?? {};
}

function initialStyle(command: ChoiceCommand, choiceIndex: number): UILayoutComponentStyle {
  return cleanStyle({
    ...projectChoiceStyle(),
    ...(command.button_style ?? {}),
    ...(command.choices[choiceIndex]?.button_style ?? {}),
  });
}

function previewCommand(
  command: ChoiceCommand,
  choiceIndex: number,
  draft: UILayoutComponentStyle,
): ChoiceCommand {
  const choices = command.choices.length > 0
    ? command.choices
    : [{
        choice_id: "choice_preview",
        choice_display_name: "示例选项",
        text: "示例选项",
        target_scene_id: "choice_style_end",
        conditions: [],
      }];
  return {
    ...command,
    button_style: undefined,
    choices: choices.map((choice, index) => ({
      ...choice,
      text: choice.text || choice.choice_display_name || `选项 ${index + 1}`,
      target_scene_id: "choice_style_end",
      button_style: index === choiceIndex ? draft : choice.button_style,
    })),
  };
}

export function ChoiceButtonStyleStudioDialog({
  command,
  choiceIndex,
  onApply,
  onClose,
}: {
  command: ChoiceCommand;
  choiceIndex: number;
  onApply: (style: UILayoutComponentStyle, scope: ChoiceButtonStyleScope) => void;
  onClose: () => void;
}) {
  const project = useProjectStore();
  const [draft, setDraft] = useState<UILayoutComponentStyle>(() => initialStyle(command, choiceIndex));
  const [scope, setScope] = useState<ChoiceButtonStyleScope>("button");
  const [runtimeStatus, setRuntimeStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const [runtimeMessage, setRuntimeMessage] = useState("正在连接预览…");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const sessionRef = useRef(globalThis.crypto?.randomUUID?.() ?? `choice-style-${Date.now()}`);
  const initial = useMemo(() => initialStyle(command, choiceIndex), [choiceIndex, command]);
  const selectedImageAssetId = assetIdFromUILayoutReference(draft.backgroundImage) ?? "";

  function updateDraft(patch: Partial<UILayoutComponentStyle>) {
    setDraft((current) => cleanStyle({ ...current, ...patch }));
  }

  function previewStart(requestId: string): PreviewStartSpec {
    return {
      requestId,
      target: { sceneId: "choice_style_preview", commandIndex: 0 },
      entryPath: [],
      mode: "stable_frame",
      playbackRate: 1,
      reducedMotion: true,
    };
  }

  async function initializeRuntimePreview() {
    if (!iframeRef.current?.contentWindow) return;
    setRuntimeStatus("connecting");
    setRuntimeMessage("正在更新预览…");
    try {
      const currentProject = useProjectStore.getState();
      const previewChoice = previewCommand(command, choiceIndex, draft);
      const previewScene: Scene = {
        scene_id: "choice_style_preview",
        title: "选项按钮样式预览",
        summary: "使用实际 GameCLI 渲染的选项按钮。",
        chapter: 0,
        tags: ["preview"],
        commands: [previewChoice],
      };
      const endScene: Scene = {
        scene_id: "choice_style_end",
        title: "预览结束",
        summary: "",
        chapter: 0,
        tags: ["preview"],
        commands: [{ type: "narration", text: "按钮点击预览完成。" }],
        is_ending: true,
        ending_id: "choice_style_end",
      };
      const script: RuntimeScript = {
        schema_version: "1.1.0",
        game_id: currentProject.projectId,
        title: currentProject.title,
        entry_scene_id: previewScene.scene_id,
        scenes: [previewScene, endScene],
      };
      const data = await createEditorLivePreviewData({
        script,
        gameId: currentProject.projectId,
        title: currentProject.title,
        author: currentProject.author,
        version: "0.1.0-choice-style-preview",
        language: "zh-CN",
        description: `${currentProject.title} 选项按钮样式预览`,
        includeGallery: false,
        includeMetadata: false,
        projectAssets: manifestAssetsFromProjectAssets(currentProject.assetManifest),
        projectAssetRefs: currentProject.assetManifest,
        uiSkin: currentProject.settings.runtimeUILayout,
        uiLayoutProfiles: currentProject.settings.runtimeUILayoutProfiles,
        packageAppearance: currentProject.settings.packageAppearance,
        characterDialogStyles: currentProject.settings.characterDialogStyles,
      });
      const requestId = `choice-style-${Date.now()}`;
      revisionRef.current += 1;
      iframeRef.current.contentWindow.postMessage({
        type: "agentvn.live-preview.init",
        protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
        sessionId: sessionRef.current,
        revision: revisionRef.current,
        requestId,
        runId: `choice-style-run-${revisionRef.current}`,
        manifest: data.manifest,
        script: data.script,
        uiSkin: data.uiSkin,
        assetUrls: liveAssetUrls(currentProject.assetManifest),
        start: previewStart(requestId),
        screen: "playing",
      }, runtimePreviewOrigin);
    } catch (error) {
      reportFrontendError("editor.choice-button-style-preview", error, { operation: "initialize" });
      setRuntimeStatus("error");
      setRuntimeMessage(error instanceof Error ? error.message : "预览更新失败。");
    }
  }

  useEffect(() => {
    dialogRef.current?.focus();
    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (!iframeRef.current?.contentWindow) return;
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => void initializeRuntimePreview(), previewDebounceMs);
    return () => {
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    };
  }, [draft, scope]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<LivePreviewRuntimeMessage>) => {
      if (event.origin !== runtimePreviewOrigin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.protocolVersion !== LIVE_PREVIEW_PROTOCOL_VERSION) return;
      if (event.data.sessionId !== sessionRef.current) return;
      if (event.data.type === "agentvn.live-preview.error") {
        setRuntimeStatus("error");
        setRuntimeMessage(event.data.message);
      }
      if (event.data.type === "agentvn.live-preview.ready") {
        setRuntimeStatus("ready");
        setRuntimeMessage("");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return createPortal(
    <div className="choice-style-studio-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="choice-style-studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choice-style-studio-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="choice-style-studio-header">
          <div>
            <h3 id="choice-style-studio-title">编辑选项按钮样式</h3>
          </div>
          <button data-help-key="editor.control" type="button" aria-label="关闭按钮样式编辑器" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="choice-style-studio-body">
          <div className="choice-style-preview-pane">
            {runtimeStatus !== "ready" && (
              <div className={`choice-style-runtime-status is-${runtimeStatus}`} role="status">
                {runtimeMessage}
              </div>
            )}
            <iframe
              ref={iframeRef}
              title="选项按钮预览"
              src={runtimePreviewUrl}
              onLoad={() => void initializeRuntimePreview()}
            />
            <div className="choice-style-preview-note">
              <span><Palette size={14} /> 当前高亮编辑第 {choiceIndex + 1} 个按钮</span>
            </div>
          </div>

          <div className="choice-style-control-pane">
            <section>
              <header><Image size={16} /><strong>按钮图片</strong></header>
              <AssetPicker
                label="背景图"
                field="choice.buttonStyle.backgroundImage"
                value={selectedImageAssetId}
                allowedTypes={["ui", "background", "sprite"]}
                helpKey="layout.backgroundImage"
                emptyLabel="暂无可用图片"
                placeholder="不使用背景图"
                variant="inline"
                onChange={(assetId) => updateDraft({
                  backgroundImage: assetId ? toUILayoutAssetReference(assetId) : undefined,
                })}
              />
              <label>
                图片显示预设
                <RichSelect
                  ariaLabel="选项按钮图片显示预设"
                  value={draft.backgroundFit ?? "stretch"}
                  options={[...imageFitOptions]}
                  onChange={(backgroundFit) => updateDraft({ backgroundFit })}
                />
              </label>
            </section>

            <section>
              <header><Palette size={16} /><strong>颜色与形状</strong></header>
              <div className="choice-style-color-grid">
                {([
                  ["backgroundColor", "底色", "#82b6ff"],
                  ["color", "文字", "#07111f"],
                  ["borderColor", "边框", "#d8e2ff"],
                ] as const).map(([field, label, fallback]) => (
                  <label key={field}>
                    {label}
                    <span>
                      <input data-help-key="editor.control"
                        type="color"
                        value={(draft[field] as string | undefined) ?? fallback}
                        onChange={(event) => updateDraft({ [field]: event.target.value })}
                      />
                      <input data-help-key="editor.control"
                        value={(draft[field] as string | undefined) ?? ""}
                        placeholder={fallback}
                        onChange={(event) => updateDraft({ [field]: event.target.value || undefined })}
                      />
                    </span>
                  </label>
                ))}
              </div>
              <div className="choice-style-slider-grid">
                {([
                  ["borderRadius", "圆角", 0, 48, 1, 10],
                  ["borderWidth", "边框", 0, 12, 1, 1],
                  ["padding", "内边距", 4, 32, 1, 12],
                  ["fontSize", "字号", 12, 40, 1, 20],
                  ["opacity", "透明度", 0.1, 1, 0.05, 1],
                ] as const).map(([field, label, min, max, step, fallback]) => (
                  <label key={field}>
                    <span>{label}<output>{Number(draft[field] ?? fallback)}</output></span>
                    <RangeControl
                      ariaLabel={`选项按钮${label}`}
                      value={Number(draft[field] ?? fallback)}
                      min={min}
                      max={max}
                      step={step}
                      onChange={(value) => updateDraft({ [field]: value })}
                    />
                  </label>
                ))}
              </div>
              <label>
                阴影
                <RichSelect
                  ariaLabel="选项按钮阴影"
                  value={draft.shadow ?? "soft"}
                  options={[...shadowOptions]}
                  onChange={(shadow) => updateDraft({ shadow })}
                />
              </label>
            </section>

            <section className="choice-style-scope">
              <header><strong>应用范围</strong></header>
              <label className={scope === "button" ? "is-selected" : ""}>
                <input data-help-key="editor.control" type="radio" name="choice-style-scope" checked={scope === "button"} onChange={() => setScope("button")} />
                <span><strong>只应用这个按钮</strong><small>仅改变当前选项，其他按钮保持原样。</small></span>
              </label>
              <label className={scope === "scene" ? "is-selected" : ""}>
                <input data-help-key="editor.control" type="radio" name="choice-style-scope" checked={scope === "scene"} onChange={() => setScope("scene")} />
                <span><strong>当前场景所有按钮</strong><small>这组选项统一使用当前样式。</small></span>
              </label>
              <label className={scope === "project" ? "is-selected" : ""}>
                <input data-help-key="editor.control" type="radio" name="choice-style-scope" checked={scope === "project"} onChange={() => setScope("project")} />
                <span><strong>整个工程</strong><small>保存为所有选项按钮的工程默认样式。</small></span>
              </label>
            </section>
          </div>
        </div>

        <footer className="choice-style-studio-footer">
          <button data-help-key="editor.control" type="button" onClick={() => setDraft(initial)}><RotateCcw size={15} /> 恢复打开时样式</button>
          <div>
            <button data-help-key="editor.control" type="button" onClick={onClose}>取消</button>
            <button data-help-key="editor.control" type="button" className="choice-style-apply" onClick={() => onApply(cleanStyle(draft), scope)}>应用样式</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

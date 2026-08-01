import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Film, Play, Wand2 } from "lucide-react";
import {
  animationPresetCategories,
  animationPresetTemplates,
  buildAnimationPresetFromTemplate,
  getAnimationTemplate,
  type AnimationPresetControlDefinition,
  type AnimationPresetCategoryId,
  type AnimationPresetDirection,
  type AnimationPresetTemplate,
  type AnimationPresetTweakValues,
} from "../../animation/presetLibrary";
import { previewAnimation } from "../../animation/animationPreview";
import { exportAnimationCommand } from "../../animation/exportAnimationCommand";
import type { AnimationPreset } from "../../animation/types";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { characterIdFromSpriteTarget, collectCharacterIdsFromNodes, spriteTargetForCharacter } from "../../utils/characterReferences";
import { assetTypeMatchesExpected } from "../../../../shared/cartridge/assetTaxonomy";
import {
  SPRITE_FOCUS_BACKDROP_OPACITY,
  SPRITE_FOCUS_COMPANION_BRIGHTNESS,
  SPRITE_FOCUS_KEYFRAME_OFFSETS,
  SPRITE_FOCUS_PRESET_ID,
} from "../../../../shared/animation/characterAnimation";
import type { AssetRef } from "../../types/assets";
import { AnimationTimeline } from "./AnimationTimeline";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";
import { RangeControl } from "../common/RangeControl";

type PreviewAssetTarget = Extract<AnimationPreset["target_type"], "sprite" | "background">;

function clonePreset(preset: AnimationPreset): AnimationPreset {
  return {
    ...preset,
    keyframes: preset.keyframes.map((keyframe) => ({ ...keyframe })),
  };
}

function createDefaultTarget(targetType: AnimationPreset["target_type"]): string {
  if (targetType === "sprite") return "sprite:selected";
  return targetType;
}

function createDefaultTweakValues(template: AnimationPresetTemplate): AnimationPresetTweakValues {
  return { ...template.defaults };
}

function createDraft(templateId: string, values: AnimationPresetTweakValues): AnimationPreset {
  return buildAnimationPresetFromTemplate(templateId, values);
}

function renderPreviewHint(targetType: AnimationPreset["target_type"]): string {
  if (targetType === "background") return "背景演出预览";
  if (targetType === "camera") return "镜头演出预览";
  return "立绘演出预览";
}

function assetSource(asset: AssetRef | undefined): string | undefined {
  if (!asset) return undefined;
  return asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url ?? asset.metadata.path ?? asset.metadata.filePath;
}

function scheduleIdleTask(callback: () => void, timeout = 180): () => void {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, timeout);
  return () => globalThis.clearTimeout(id);
}

export function AnimationEditorPanel() {
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const updateNodeData = useEditorStore((state) => state.updateNodeData);
  const node = useEditorStore((state) => state.nodes.find((item) => item.id === state.selectedNodeId));
  const assetManifest = useProjectStore((state) => state.assetManifest);

  const [categoryId, setCategoryId] = useState(animationPresetCategories[0].id);
  const [detailPhase, setDetailPhase] = useState<"idle" | "leaving" | "entering">("idle");
  const categoryTemplates = useMemo(
    () => animationPresetTemplates.filter((template) => template.category_id === categoryId),
    [categoryId],
  );
  const [templateId, setTemplateId] = useState(categoryTemplates[0]?.template_id ?? animationPresetTemplates[0].template_id);
  const currentTemplate = useMemo(() => getAnimationTemplate(templateId) ?? animationPresetTemplates[0], [templateId]);
  const [tweaks, setTweaks] = useState<AnimationPresetTweakValues>(() => createDefaultTweakValues(currentTemplate));
  const [draft, setDraft] = useState<AnimationPreset>(() => createDraft(currentTemplate.template_id, currentTemplate.defaults));
  const [target, setTarget] = useState(() => createDefaultTarget(currentTemplate.target_type));
  const [blocking, setBlocking] = useState(true);
  const [isAdvancedOpen, setAdvancedOpen] = useState(false);
  const [isExpertOpen, setExpertOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templatePickerPosition, setTemplatePickerPosition] = useState({ top: 0, left: 0, width: 360, maxHeight: 420, placement: "side" as "side" | "bottom" });
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [previewAssetOverrides, setPreviewAssetOverrides] = useState<Partial<Record<PreviewAssetTarget, string>>>({});
  const templatePickerId = useId();
  const templatePickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const templatePickerPopoverRef = useRef<HTMLDivElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const previewTargetRef = useRef<HTMLDivElement | null>(null);
  const previewFocusBackdropRef = useRef<HTMLDivElement | null>(null);
  const previewFocusCompanionRef = useRef<HTMLDivElement | null>(null);
  const switchTimerRef = useRef<number | null>(null);
  const enterTimerRef = useRef<number | null>(null);
  const currentCategory = useMemo(
    () => animationPresetCategories.find((category) => category.id === currentTemplate.category_id) ?? animationPresetCategories[0],
    [currentTemplate.category_id],
  );
  const spriteTargetId = characterIdFromSpriteTarget(target);
  const spriteTargetOptions = ["selected", "all", ...characterIds];
  if (spriteTargetId && !spriteTargetOptions.includes(spriteTargetId)) spriteTargetOptions.push(spriteTargetId);
  const sceneSpriteCommands = useMemo(
    () => node?.data.scene?.commands.filter((command) => command.type === "sprite") ?? [],
    [node?.data.scene?.commands],
  );
  const sceneBackgroundCommands = useMemo(
    () => node?.data.scene?.commands.filter((command) => command.type === "background") ?? [],
    [node?.data.scene?.commands],
  );
  const suggestedSpriteAsset = useMemo(() => {
    const targetCharacter = spriteTargetId && spriteTargetId !== "selected" && spriteTargetId !== "all" ? spriteTargetId : undefined;
    const matchingCommand = [...sceneSpriteCommands]
      .reverse()
      .find((command) => !targetCharacter || command.character_id === targetCharacter);
    const commandAsset = matchingCommand?.sprite_id
      ? assetManifest.find((asset) => asset.asset_id === matchingCommand.sprite_id)
      : undefined;
    return commandAsset ?? assetManifest.find((asset) => assetTypeMatchesExpected(asset.asset_type, "sprite"));
  }, [assetManifest, sceneSpriteCommands, spriteTargetId]);
  const suggestedBackgroundAsset = useMemo(() => {
    const matchingCommand = sceneBackgroundCommands[sceneBackgroundCommands.length - 1];
    const commandAsset = matchingCommand?.background_id
      ? assetManifest.find((asset) => asset.asset_id === matchingCommand.background_id)
      : undefined;
    return commandAsset ?? assetManifest.find((asset) => assetTypeMatchesExpected(asset.asset_type, "background"));
  }, [assetManifest, sceneBackgroundCommands]);
  const previewAssetType: PreviewAssetTarget | undefined =
    draft.target_type === "sprite" || draft.target_type === "background" ? draft.target_type : undefined;
  const hasPreviewAssetOverride = previewAssetType
    ? Object.prototype.hasOwnProperty.call(previewAssetOverrides, previewAssetType)
    : false;
  const previewAssetId = previewAssetType
    ? hasPreviewAssetOverride
      ? previewAssetOverrides[previewAssetType] ?? ""
      : (previewAssetType === "sprite" ? suggestedSpriteAsset : suggestedBackgroundAsset)?.asset_id ?? ""
    : "";
  const previewAsset = useMemo(
    () => assetManifest.find((asset) => asset.asset_id === previewAssetId),
    [assetManifest, previewAssetId],
  );
  const previewAssetSource = assetSource(previewAsset);

  const updateTemplatePickerPosition = useCallback(() => {
    const trigger = templatePickerTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const preferredWidth = Math.min(420, viewportWidth - margin * 2);
    const sideFits = rect.right + 10 + preferredWidth <= viewportWidth - margin;
    const placement = sideFits ? "side" : "bottom";
    const left = placement === "side"
      ? rect.right + 10
      : Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - preferredWidth - margin));
    const top = placement === "side"
      ? Math.min(Math.max(margin, rect.top), Math.max(margin, viewportHeight - margin - 420))
      : Math.min(rect.bottom + 8, viewportHeight - margin - 220);
    const maxHeight = Math.max(220, Math.min(460, viewportHeight - top - margin));
    setTemplatePickerPosition({ top, left, width: preferredWidth, maxHeight, placement });
  }, []);

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function clearSwitchTimers() {
    if (switchTimerRef.current !== null) window.clearTimeout(switchTimerRef.current);
    if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);
    switchTimerRef.current = null;
    enterTimerRef.current = null;
  }

  function applyTemplate(nextTemplate: AnimationPresetTemplate, nextCategoryId = nextTemplate.category_id) {
    setCategoryId(nextCategoryId);
    setTemplateId(nextTemplate.template_id);
    setTweaks(createDefaultTweakValues(nextTemplate));
    setDraft(createDraft(nextTemplate.template_id, nextTemplate.defaults));
    setTarget(createDefaultTarget(nextTemplate.target_type));
    if (nextTemplate.template_id === SPRITE_FOCUS_PRESET_ID) setBlocking(false);
  }

  function switchTemplate(nextTemplate: AnimationPresetTemplate, nextCategoryId = nextTemplate.category_id) {
    if (nextTemplate.template_id === templateId && nextCategoryId === categoryId) return;
    clearSwitchTimers();
    if (prefersReducedMotion()) {
      applyTemplate(nextTemplate, nextCategoryId);
      setDetailPhase("idle");
      return;
    }
    setDetailPhase("leaving");
    switchTimerRef.current = window.setTimeout(() => {
      applyTemplate(nextTemplate, nextCategoryId);
      setDetailPhase("entering");
      enterTimerRef.current = window.setTimeout(() => {
        setDetailPhase("idle");
        enterTimerRef.current = null;
      }, 220);
      switchTimerRef.current = null;
    }, 160);
  }

  function selectCategory(nextCategoryId: AnimationPresetCategoryId) {
    if (nextCategoryId === categoryId) return;
    const next = animationPresetTemplates.find((template) => template.category_id === nextCategoryId) ?? animationPresetTemplates[0];
    switchTemplate(next, nextCategoryId);
  }

  function openTemplatePicker() {
    setTemplatePickerOpen(true);
    window.requestAnimationFrame(updateTemplatePickerPosition);
  }

  function chooseCategory(nextCategoryId: AnimationPresetCategoryId) {
    selectCategory(nextCategoryId);
    openTemplatePicker();
  }

  function chooseTemplate(template: AnimationPresetTemplate) {
    switchTemplate(template);
    setTemplatePickerOpen(false);
  }

  useEffect(() => () => clearSwitchTimers(), []);

  useEffect(() => {
    setPreviewAssetOverrides({});
  }, [selectedNodeId]);

  useEffect(() => {
    return scheduleIdleTask(() => {
      setCharacterIds(collectCharacterIdsFromNodes(useEditorStore.getState().nodes));
    });
  }, [selectedNodeId, node?.data.scene?.commands, node?.data.choice, node?.data.animation]);

  useEffect(() => {
    if (!templatePickerOpen) return;
    updateTemplatePickerPosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (templatePickerTriggerRef.current?.contains(target) || templatePickerPopoverRef.current?.contains(target))) return;
      setTemplatePickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTemplatePickerOpen(false);
    };
    window.addEventListener("resize", updateTemplatePickerPosition);
    window.addEventListener("scroll", updateTemplatePickerPosition, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", updateTemplatePickerPosition);
      window.removeEventListener("scroll", updateTemplatePickerPosition, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [templatePickerOpen, updateTemplatePickerPosition]);

  function updateTweak<K extends keyof AnimationPresetTweakValues>(key: K, value: AnimationPresetTweakValues[K]) {
    const nextValues = { ...tweaks, [key]: value };
    setTweaks(nextValues);
    setDraft(createDraft(currentTemplate.template_id, nextValues));
  }

  function selectPreviewAsset(targetType: PreviewAssetTarget, assetId: string) {
    setPreviewAssetOverrides((current) => ({ ...current, [targetType]: assetId }));
  }

  function applyToNode() {
    if (!selectedNodeId) return;
    const command = exportAnimationCommand({ preset: draft, target, blocking });
    if (node?.data.nodeKind === "animation") updateNodeData(selectedNodeId, { animation: command });
    if (node?.data.scene) {
      updateNodeData(selectedNodeId, {
        scene: {
          ...node.data.scene,
          commands: [...node.data.scene.commands, command],
        },
      });
    }
  }

  function previewCurrentPreset() {
    const targetElement =
      draft.target_type === "sprite" || draft.target_type === "dialog" || draft.target_type === "ui"
        ? previewTargetRef.current
        : previewStageRef.current;
    if (!targetElement) return;
    if (!(prefersReducedMotion() && draft.preset_id === SPRITE_FOCUS_PRESET_ID)) {
      previewAnimation(targetElement, draft);
    }
    if (draft.preset_id !== SPRITE_FOCUS_PRESET_ID) return;
    previewFocusBackdropRef.current?.animate([
      { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[0], opacity: 0 },
      { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[1], opacity: SPRITE_FOCUS_BACKDROP_OPACITY },
      { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[2], opacity: SPRITE_FOCUS_BACKDROP_OPACITY },
      { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[3], opacity: 0 },
    ], { duration: draft.duration_ms, easing: draft.easing, fill: "both" });
    previewFocusCompanionRef.current?.animate([
      { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[0], filter: "brightness(1)" },
      { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[1], filter: `brightness(${SPRITE_FOCUS_COMPANION_BRIGHTNESS})` },
      { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[2], filter: `brightness(${SPRITE_FOCUS_COMPANION_BRIGHTNESS})` },
      { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[3], filter: "brightness(1)" },
    ], { duration: draft.duration_ms, easing: draft.easing, fill: "both" });
  }

  function renderControl(control: AnimationPresetControlDefinition) {
    if (control.type === "toggle") {
      return (
        <label className="check-row animation-control-card" key={control.key}>
          <input
            type="checkbox"
            checked={tweaks[control.key] as boolean}
            data-help-key={control.key === "loop" ? "animation.loop" : undefined}
            onChange={(event) => updateTweak(control.key, event.target.checked)}
          />
          <span>{control.label}</span>
        </label>
      );
    }

    if (control.type === "select") {
      return (
        <label className="animation-control-card" key={control.key}>
          <span>{control.label}</span>
          <RichSelect
            value={tweaks[control.key] as AnimationPresetDirection}
            options={control.options ?? []}
            helpKey="animation.direction"
            onChange={(nextDirection) => updateTweak(control.key, nextDirection as AnimationPresetDirection)}
          />
        </label>
      );
    }

    const value = tweaks[control.key] as number;
    return (
      <label className="animation-control-card" key={control.key}>
        <span>
          {control.label}
          <strong>{control.key === "duration_ms" ? `${Math.round(value)} ms` : value.toFixed(2)}</strong>
        </span>
        <RangeControl
          min={control.min ?? 0}
          max={control.max ?? 1}
          step={control.step ?? 1}
          value={value}
          helpKey={control.key === "duration_ms" ? "animation.duration" : undefined}
          ariaLabel={`动画参数 ${control.key}`}
          onChange={(nextValue) => updateTweak(control.key, nextValue)}
        />
      </label>
    );
  }

  const CurrentCategoryIcon = currentCategory.icon;

  return (
    <section className="advanced-card animation-editor-shell">
      <header className="animation-editor-header">
        <div>
          <h3>动效工作室</h3>
          <p>选择目标角色图像、挑选动作模板，再用真实预览确认效果后插入当前场景。</p>
        </div>
      </header>

      <div className="animation-editor-grid">
        <aside className="animation-template-sidebar">
          <button
            type="button"
            ref={templatePickerTriggerRef}
            className="animation-template-current-trigger"
            aria-haspopup="dialog"
            aria-expanded={templatePickerOpen}
            aria-controls={templatePickerOpen ? templatePickerId : undefined}
            data-help-key="animation.preset"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openTemplatePicker}
          >
            <CurrentCategoryIcon size={16} />
            <span>
              <strong>{currentTemplate.title}</strong>
              <small>{currentCategory.title}</small>
            </span>
          </button>
          <div className="animation-template-groups" role="tablist" aria-label="动画模板分类">
            {animationPresetCategories.map((category) => {
              const Icon = category.icon;
              const isActive = category.id === categoryId;
              return (
                <button
                  key={category.id}
                  type="button"
                  className={isActive ? "is-active" : ""}
                  data-help-key="animation.category"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseCategory(category.id)}
                >
                  <Icon size={16} />
                  <span>{category.title}</span>
                  <small>{category.summary}</small>
                </button>
              );
            })}
          </div>

        </aside>

        {templatePickerOpen && createPortal(
          <div
            ref={templatePickerPopoverRef}
            id={templatePickerId}
            className={`animation-template-popover is-${templatePickerPosition.placement}`}
            role="dialog"
            aria-label="动画模板选择"
            style={{
              top: templatePickerPosition.top,
              left: templatePickerPosition.left,
              width: templatePickerPosition.width,
              maxHeight: templatePickerPosition.maxHeight,
            } as CSSProperties}
          >
            <header className="animation-template-popover-header">
              <div>
                <strong>{currentCategory.title}</strong>
                <span>{currentCategory.summary}</span>
              </div>
              <button type="button" aria-label="关闭动画模板选择" data-help-key="animation.templatePicker.close" onClick={() => setTemplatePickerOpen(false)}>
                ×
              </button>
            </header>
            <div className={`animation-template-list is-${detailPhase}`}>
              {categoryTemplates.map((template) => {
                const TemplateIcon =
                  animationPresetCategories.find((category) => category.id === template.category_id)?.icon ?? currentCategory.icon;
                return (
                  <button
                    key={template.template_id}
                    type="button"
                    className={`animation-template-card${template.template_id === currentTemplate.template_id ? " is-active" : ""}`}
                    data-help-key="animation.preset"
                    data-template-id={template.template_id}
                    data-preset-id={template.preset_id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseTemplate(template)}
                  >
                    <TemplateIcon size={16} />
                    <span>
                      <strong>{template.title}</strong>
                      <p>{template.summary}</p>
                      <small>{template.recommended_scene}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}

        <div className={`animation-template-main is-${detailPhase}`}>
          <section className="animation-template-summary">
            <div>
              <span className="animation-template-kicker">
                <CurrentCategoryIcon size={14} />
                {currentTemplate.target_type === "sprite"
                  ? "立绘模板"
                  : currentTemplate.target_type === "background"
                    ? "背景模板"
                    : "镜头模板"}
              </span>
              <h4>{currentTemplate.title}</h4>
              <p>{currentTemplate.summary}</p>
              <small>推荐场景：{currentTemplate.recommended_scene}</small>
            </div>
          </section>

          <section className="animation-quick-controls">
            <header className="animation-section-header">
              <div>
                <h4>快速微调</h4>
                <p>只保留高频参数，够快也够稳。</p>
              </div>
            </header>
            <div className="animation-control-grid">{currentTemplate.controls.map(renderControl)}</div>
            <div className="advanced-grid-2 animation-target-row">
              <label>
                动画目标
                <input value={target} data-help-key="animation.target" aria-label="动画目标" onChange={(event) => setTarget(event.target.value)} />
              </label>
              {draft.target_type === "sprite" && (
                <div className="character-target-panel animation-character-target">
                  <label>
                    角色目标
                    <RichSelect
                      value={spriteTargetId || "selected"}
                      options={spriteTargetOptions.map((id) => ({ value: id, label: id === "selected" ? "当前立绘" : id === "all" ? "全部立绘" : id }))}
                      helpKey="animation.spriteTarget"
                      onChange={(nextTargetId) => setTarget(spriteTargetForCharacter(nextTargetId))}
                    />
                  </label>
                  <label>
                    自定义角色 ID
                    <input data-help-key="animation.spriteTargetCustom" value={spriteTargetId || ""} onChange={(event) => setTarget(spriteTargetForCharacter(event.target.value))} />
                  </label>
                </div>
              )}
              <label className="check-row">
                <input type="checkbox" checked={blocking} data-help-key="animation.blocking" aria-label="等待动画完成" onChange={(event) => setBlocking(event.target.checked)} />
                等待动画结束后再继续剧情
              </label>
            </div>
          </section>

          <section className="animation-preview-panel">
            <header className="animation-section-header">
              <div>
                <h4>预览与插入</h4>
                <p>
                  {previewAsset
                    ? `正在使用 ${previewAsset.metadata.filename ?? previewAsset.asset_id} 预览。`
                    : previewAssetType
                      ? `请选择${previewAssetType === "sprite" ? "角色图像" : "背景图"}素材进行真实预览。`
                      : "当前模板使用内置舞台进行预览。"}
                </p>
              </div>
            </header>
            {draft.target_type === "sprite" && (
              <AssetPicker
                label="预览立绘素材"
                field="animation_preview_sprite_id"
                value={previewAssetId}
                allowedTypes={["sprite"]}
                helpKey="animation.previewSpriteAsset"
                emptyLabel="暂无可用角色图像素材"
                placeholder="选择要用于动效预览的角色图像"
                onChange={(assetId) => selectPreviewAsset("sprite", assetId)}
              />
            )}
            {draft.target_type === "background" && (
              <AssetPicker
                label="预览背景素材"
                field="animation_preview_background_id"
                value={previewAssetId}
                allowedTypes={["background"]}
                helpKey="animation.previewBackgroundAsset"
                emptyLabel="暂无可用背景素材"
                placeholder="选择要用于切换动效预览的背景图"
                onChange={(assetId) => selectPreviewAsset("background", assetId)}
              />
            )}
            <div className={`animation-preview-stage is-${draft.target_type}`} ref={previewStageRef}>
              {draft.preset_id === SPRITE_FOCUS_PRESET_ID && <div className="animation-preview-focus-backdrop" ref={previewFocusBackdropRef} aria-hidden="true" />}
              <span className="animation-preview-hint">{renderPreviewHint(draft.target_type)}</span>
              {draft.preset_id === SPRITE_FOCUS_PRESET_ID && <div className="animation-preview-focus-companion" ref={previewFocusCompanionRef} aria-hidden="true">陪衬角色</div>}
              <div className={`animation-preview-target is-${draft.target_type}`} ref={previewTargetRef}>
                {draft.target_type === "sprite" && previewAssetSource ? (
                  <img src={previewAssetSource} alt={previewAsset?.metadata.filename ?? "角色图像预览"} />
                ) : draft.target_type === "sprite" ? (
                  <span>角色图像</span>
                ) : draft.target_type === "background" && previewAssetSource ? (
                  <img src={previewAssetSource} alt={previewAsset?.metadata.filename ?? "背景图预览"} />
                ) : draft.target_type === "background" ? (
                  <span>背景图</span>
                ) : draft.target_type === "camera" ? (
                  "镜头"
                ) : (
                  "场景"
                )}
              </div>
            </div>
            <div className="row-actions">
              <button type="button" data-help-key="animation.preview" onClick={previewCurrentPreset}>
                <Play size={16} />
                <span>预览播放</span>
              </button>
              <button type="button" data-help-key="animation.insert" onClick={applyToNode} disabled={!selectedNodeId}>
                <Wand2 size={16} />
                <span>插入到当前节点</span>
              </button>
            </div>
            {!selectedNodeId && <p className="animation-panel-note">先选中场景节点；旧工程也可以选中旧版动画节点继续维护。</p>}
            {node?.data.nodeKind === "animation" && <p className="animation-panel-note">当前会覆盖旧版动画节点里的动画指令；建议完成后使用节点上的转换入口迁移。</p>}
            {node?.data.scene && <p className="animation-panel-note">当前会把动画追加到场景节点的命令列表末尾。</p>}
          </section>

          <details className="animation-advanced-panel" open={isAdvancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary>
              <ChevronDown className="animation-advanced-chevron" size={16} />
              <Film size={16} />
              <span className="animation-advanced-title">
                <strong>高级定制</strong>
                <small>展开后用可视化控件微调名称、编号、缓动和关键帧；CSS 入口只在专家模式显示。</small>
              </span>
              <span>高级定制</span>
            </summary>
            <div className="advanced-grid-2 animation-advanced-fields">
              <label>
                动画名称
                <input value={draft.name} data-help-key="animation.name" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>
                动画编号
                <input value={draft.preset_id} data-help-key="animation.id" onChange={(event) => setDraft({ ...draft, preset_id: event.target.value })} />
              </label>
              <label>
                缓动函数
                <input
                  value={draft.easing}
                  data-help-key="animation.easing"
                  onChange={(event) => setDraft({ ...draft, easing: event.target.value })}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.loop}
                  data-help-key="animation.loop"
                  onChange={(event) => setDraft({ ...draft, loop: event.target.checked })}
                />
                循环播放
              </label>
            </div>
            <div className="animation-expert-toggle">
              <div>
                <strong>专家模式</strong>
                <small>仅当模板和关键帧控件无法表达效果时，再启用自定义 CSS。</small>
              </div>
              <button type="button" className={isExpertOpen ? "is-active" : ""} data-help-key="animation.expertMode" onClick={() => setExpertOpen((current) => !current)}>
                {isExpertOpen ? "隐藏 CSS 入口" : "显示 CSS 入口"}
              </button>
            </div>
            <AnimationTimeline keyframes={draft.keyframes} showExpertCss={isExpertOpen} onChange={(keyframes) => setDraft({ ...draft, keyframes })} />
          </details>
        </div>
      </div>
    </section>
  );
}

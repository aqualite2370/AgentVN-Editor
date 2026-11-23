import { type CSSProperties, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, Save, Square, Wand2 } from "lucide-react";
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
import { compileAnimationPreset } from "../../animation/keyframeCompiler";
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
  keyframesForCharacterAnimation,
  type CharacterSpriteAnimationConfig,
} from "../../../../shared/animation/characterAnimation";
import type { AssetRef } from "../../types/assets";
import { AnimationTimeline } from "./AnimationTimeline";
import { AssetPicker } from "../common/AssetPicker";
import { GlassSelectionGroup } from "../common/GlassSelectionGroup";
import { RichSelect } from "../common/RichSelect";
import { RangeControl } from "../common/RangeControl";
import { OperationResultDialog } from "../common/OperationResultDialog";
import { editorProjectOwner, ownsEditorProject, persistEditorProject } from "../../utils/editorProjectPersistence";
import { spriteDefaultFromPreset, useGlobalSpriteAnimation, type SpriteDefaultPhase } from "../../utils/spriteAnimationDefaults";

type PreviewAssetTarget = Extract<AnimationPreset["target_type"], "sprite" | "background">;

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

function savedDraft(template: AnimationPresetTemplate, config?: CharacterSpriteAnimationConfig): AnimationPreset {
  const preset = createDraft(template.template_id, template.defaults);
  return config ? {...preset, name: config.display_name || preset.name, preset_id: config.preset_id || preset.preset_id,
    duration_ms: config.duration_ms ?? preset.duration_ms, easing: config.easing || preset.easing,
    keyframes: keyframesForCharacterAnimation(config), loop: false, direction: "normal"} : preset;
}

function savedTemplate(phase: SpriteDefaultPhase): AnimationPresetTemplate {
  const config = useProjectStore.getState().settings.spriteAnimationDefaults?.[phase];
  return animationPresetTemplates.find(template => template.category_id === `sprite_${phase}` && template.preset_id === config?.preset_id)
    ?? animationPresetTemplates.find(template => template.category_id === `sprite_${phase}`)!;
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

export function AnimationEditorPanel({ active }: { active: boolean }) {
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const updateNodeData = useEditorStore((state) => state.updateNodeData);
  const node = useEditorStore((state) => state.nodes.find((item) => item.id === state.selectedNodeId));
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const projectId = useProjectStore(state => state.projectId);
  const loadGeneration = useEditorStore(state => state.projectLoadGeneration);
  const spriteDefaults = useProjectStore(state => state.settings.spriteAnimationDefaults);

  const [categoryId, setCategoryId] = useState(animationPresetCategories[0].id);
  const [playing, setPlaying] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const categoryTemplates = useMemo(
    () => animationPresetTemplates.filter((template) => template.category_id === categoryId),
    [categoryId],
  );
  const [templateId, setTemplateId] = useState(() => savedTemplate("enter").template_id);
  const currentTemplate = useMemo(() => getAnimationTemplate(templateId) ?? animationPresetTemplates[0], [templateId]);
  const [tweaks, setTweaks] = useState<AnimationPresetTweakValues>(() => createDefaultTweakValues(currentTemplate));
  const [draft, setDraft] = useState<AnimationPreset>(() => savedDraft(currentTemplate, useProjectStore.getState().settings.spriteAnimationDefaults?.enter));
  const [target, setTarget] = useState(() => createDefaultTarget(currentTemplate.target_type));
  const [blocking, setBlocking] = useState(true);
  const [applyExisting, setApplyExisting] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const [pendingSave, setPendingSave] = useState<{
    owner: ReturnType<typeof editorProjectOwner>; nodes: ReturnType<typeof useEditorStore.getState>["nodes"];
    settings: ReturnType<typeof useProjectStore.getState>["settings"];
    phase: SpriteDefaultPhase; config: CharacterSpriteAnimationConfig; count: number;
  }>();
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
  const previewSceneRef = useRef<HTMLDivElement | null>(null);
  const playbackRef = useRef<Animation[]>([]);
  const previewTargetRef = useRef<HTMLDivElement | null>(null);
  const previewFocusBackdropRef = useRef<HTMLDivElement | null>(null);
  const previewFocusCompanionRef = useRef<HTMLDivElement | null>(null);
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

  const cancelPreview = useCallback(() => {
    for (const animation of playbackRef.current) animation.cancel();
    playbackRef.current = [];
  }, []);

  const stopPreview = useCallback(() => {
    cancelPreview();
    setPlaying(false);
  }, [cancelPreview]);

  function applyTemplate(nextTemplate: AnimationPresetTemplate, nextCategoryId = nextTemplate.category_id, restoreSaved = false) {
    const phase = nextCategoryId === "sprite_enter" ? "enter" : nextCategoryId === "sprite_exit" ? "exit" : undefined;
    const config = restoreSaved && phase ? useProjectStore.getState().settings.spriteAnimationDefaults?.[phase] : undefined;
    stopPreview();
    setPreviewError("");
    setCategoryId(nextCategoryId);
    setTemplateId(nextTemplate.template_id);
    setTweaks({...createDefaultTweakValues(nextTemplate), ...(config?.duration_ms ? {duration_ms:config.duration_ms} : {})});
    setDraft(savedDraft(nextTemplate, config));
    setSaveStatus("");
    setBlocking(config ? Boolean(config.blocking) : nextTemplate.template_id !== SPRITE_FOCUS_PRESET_ID);
    setTarget(createDefaultTarget(nextTemplate.target_type));
  }

  function selectCategory(nextCategoryId: AnimationPresetCategoryId) {
    if (nextCategoryId === categoryId) return;
    const next = nextCategoryId === "sprite_enter" ? savedTemplate("enter") : nextCategoryId === "sprite_exit" ? savedTemplate("exit")
      : animationPresetTemplates.find((template) => template.category_id === nextCategoryId) ?? animationPresetTemplates[0];
    applyTemplate(next, nextCategoryId, true);
  }

  function openTemplatePicker() {
    setTemplatePickerOpen(true);
    window.requestAnimationFrame(updateTemplatePickerPosition);
  }

  function chooseCategory(nextCategoryId: AnimationPresetCategoryId) {
    selectCategory(nextCategoryId);
    openTemplatePicker();
  }

  function closeTemplatePicker(restoreFocus = false) {
    setTemplatePickerOpen(false);
    if (restoreFocus) templatePickerTriggerRef.current?.focus({ preventScroll: true });
  }

  function chooseTemplate(template: AnimationPresetTemplate) {
    if (template.template_id !== templateId) applyTemplate(template);
    closeTemplatePicker(true);
  }

  useLayoutEffect(() => {
    if (!active) {
      stopPreview();
      setTemplatePickerOpen(false);
    }
    return cancelPreview;
  }, [active, cancelPreview, stopPreview]);

  useLayoutEffect(() => {
    const stage = previewStageRef.current;
    const scene = previewSceneRef.current;
    if (!active || !stage || !scene) return;
    const fit = () => {
      scene.style.transform = `scale(${Math.min(stage.clientWidth / 1280, stage.clientHeight / 720)})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setPendingSave(undefined);
    setAdvancedOpen(false);
    setExpertOpen(false);
    applyTemplate(savedTemplate("enter"), "sprite_enter", true);
  }, [projectId, loadGeneration]);

  const defaultPhase: SpriteDefaultPhase | undefined = categoryId === "sprite_enter" ? "enter" : categoryId === "sprite_exit" ? "exit" : undefined;

  async function commitGlobal(request: NonNullable<typeof pendingSave>, replaceExisting: boolean) {
    if (savingRef.current) return;
    if (!ownsEditorProject(request.owner)) return;
    if (useEditorStore.getState().nodes !== request.nodes
      || useProjectStore.getState().settings !== request.settings) {
      setSaveStatus("工程内容已变化，请重新确认保存。"); return;
    }
    savingRef.current = true; setSaving(true); setSaveStatus("正在保存…");
    try {
      const project = useProjectStore.getState();
      project.setSpriteAnimationDefaults({...project.settings.spriteAnimationDefaults, [request.phase]:request.config});
      if (replaceExisting) {
        const result = useGlobalSpriteAnimation(request.nodes, request.phase);
        if (result.nodes.some((item, index) => item !== request.nodes[index])) useEditorStore.getState().setNodes(result.nodes);
      }
      await persistEditorProject();
      if (mountedRef.current && ownsEditorProject(request.owner)) setSaveStatus(`全局${request.phase === "enter" ? "入场" : "退场"}已保存${replaceExisting ? `，已应用到 ${request.count} 个事件` : ""}。`);
    } catch (error) {
      if (mountedRef.current && ownsEditorProject(request.owner)) setSaveStatus(`保存失败，设置仍保留，可重试：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  function saveGlobal() {
    if (!defaultPhase || savingRef.current) return;
    try {
      const config = spriteDefaultFromPreset(draft, defaultPhase, blocking);
      if (!CSS.supports("animation-timing-function", config.easing || "ease-out")) throw new Error("缓动函数无效，请检查后保存。");
      const nodes = useEditorStore.getState().nodes;
      const request = {owner:editorProjectOwner(), nodes, settings:useProjectStore.getState().settings,
        phase:defaultPhase, config, count:useGlobalSpriteAnimation(nodes, defaultPhase).count};
      if (applyExisting && request.count) setPendingSave(request);
      else void commitGlobal(request, false);
    } catch (error) { setSaveStatus(error instanceof Error ? error.message : String(error)); }
  }

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
    templatePickerPopoverRef.current?.querySelector<HTMLElement>(".animation-template-card.is-active, .animation-template-card")?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (templatePickerTriggerRef.current?.contains(target) || templatePickerPopoverRef.current?.contains(target))) return;
      setTemplatePickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeTemplatePicker(true);
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
    const next = createDraft(currentTemplate.template_id, nextValues);
    if (key === "duration_ms") setDraft(current => ({ ...current, duration_ms: next.duration_ms }));
    else if (key === "loop") setDraft(current => ({ ...current, loop: next.loop, direction: next.direction }));
    else {
      // Change only the generated properties affected by this template control.
      // Keep custom metadata, frame offsets, extra frames and unrelated fields.
      const previous = createDraft(currentTemplate.template_id, tweaks);
      const fields = ["opacity", "x", "y", "scale", "rotate", "blur", "brightness"] as const;
      setDraft(current => ({ ...current, keyframes: current.keyframes.map((frame, index) => {
        const before = previous.keyframes[index];
        const after = next.keyframes[index];
        if (!before || !after || frame.offset !== before.offset) return frame;
        const updated = { ...frame };
        for (const field of fields) {
          if (before[field] !== after[field]) updated[field] = after[field];
        }
        return updated;
      }) }));
    }
  }

  function selectPreviewAsset(targetType: PreviewAssetTarget, assetId: string) {
    stopPreview();
    setPreviewAssetOverrides((current) => ({ ...current, [targetType]: assetId }));
  }

  function applyToNode() {
    if (!selectedNodeId) return;
    if (draft.target_type === "sprite" && (categoryId === "sprite_enter" || categoryId === "sprite_exit")) {
      useEditorStore.getState().setNotice("这只会插入一次演出；要统一每次入退场，请使用顶部的全局保存。", "info");
    }
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

  const previewTiming = useMemo(() => ({
    duration_ms: draft.duration_ms,
    easing: draft.easing,
    loop: draft.loop,
    direction: draft.direction,
    keyframes: draft.keyframes,
  }), [draft.duration_ms, draft.easing, draft.loop, draft.direction, draft.keyframes]);

  useLayoutEffect(() => {
    const animations = playbackRef.current;
    if (!animations.length) return;
    if (!CSS.supports("animation-timing-function", previewTiming.easing)) {
      setPreviewError("缓动函数无效，请在高级定制中修改后播放。");
      return;
    }
    const compiled = compileAnimationPreset(previewTiming);
    // Keep the current cycle and phase if the duration changes during playback.
    const lead = animations[0];
    const oldDuration = Number(lead.effect?.getTiming().duration) || 1;
    const progress = Number(lead.currentTime ?? 0) / oldDuration;
    try {
      for (const animation of animations) {
        const effect = animation.effect as KeyframeEffect;
        if (effect.target === previewTargetRef.current) effect.setKeyframes(compiled.keyframes);
        effect.updateTiming({ ...compiled.options, duration: previewTiming.duration_ms });
        if (oldDuration !== previewTiming.duration_ms) animation.currentTime = progress * previewTiming.duration_ms;
      }
      setPreviewError("");
    } catch {
      setPreviewError("无法更新预览，请检查关键帧的进度顺序。");
    }
  }, [previewTiming]);

  function previewCurrentPreset() {
    const element = previewTargetRef.current;
    if (!element) return;
    if (!CSS.supports("animation-timing-function", draft.easing)) {
      setPreviewError("缓动函数无效，请在高级定制中修改后播放。");
      return;
    }
    stopPreview();
    setPreviewError("");
    const { keyframes, options } = compileAnimationPreset(draft);
    const animations = playbackRef.current;
    try {
      const focusPreset = draft.preset_id === SPRITE_FOCUS_PRESET_ID;
      if (!(focusPreset && prefersReducedMotion())) animations.push(element.animate(keyframes, options));
      const backdrop = previewFocusBackdropRef.current;
      const companion = previewFocusCompanionRef.current;
      if (focusPreset && backdrop && companion) {
        animations.push(backdrop.animate(SPRITE_FOCUS_KEYFRAME_OFFSETS.map((offset, index) => ({
          offset, opacity: index === 1 || index === 2 ? SPRITE_FOCUS_BACKDROP_OPACITY : 0,
        })), options));
        animations.push(companion.animate(SPRITE_FOCUS_KEYFRAME_OFFSETS.map((offset, index) => ({
          offset, filter: `brightness(${index === 1 || index === 2 ? SPRITE_FOCUS_COMPANION_BRIGHTNESS : 1})`,
        })), options));
      }
      if (!animations.length) return;
      setPlaying(true);
      void Promise.all(animations.map(animation => animation.finished)).then(() => {
        if (playbackRef.current === animations) stopPreview();
      }, () => { /* A replay, stop or workspace change cancelled this run. */ });
    } catch {
      stopPreview();
      setPreviewError("无法播放，请检查关键帧参数。");
    }
  }

  function renderControl(control: AnimationPresetControlDefinition) {
    if (control.type === "toggle") {
      return (
        <label className="check-row animation-control-card" key={control.key}>
          <input
            type="checkbox"
            checked={control.key === "loop" ? draft.loop : Boolean(tweaks[control.key])}
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
          {defaultPhase && <small>{spriteDefaults?.[defaultPhase] ? "已设全局默认" : "尚未设置全局默认"} · 单个事件可独立覆盖</small>}
        </div>
        {defaultPhase && <div className="animation-global-actions">
          <label className="check-row"><input type="checkbox" checked={applyExisting} disabled={saving}
            onChange={event => setApplyExisting(event.target.checked)} />同步应用到现有{defaultPhase === "enter" ? "入场" : "退场"}事件</label>
          <button type="button" onClick={saveGlobal} disabled={saving} data-help-key="animation.saveGlobal">
            <Save size={16} /><span>{saving ? "正在保存…" : `保存全局${defaultPhase === "enter" ? "入场" : "退场"}`}</span>
          </button>
        </div>}
        {saveStatus && <p className="animation-global-status" role="status">{saveStatus}</p>}
      </header>

      <OperationResultDialog open={Boolean(pendingSave)} tone="warning" label="全局立绘动画"
        title={`统一应用${pendingSave?.phase === "exit" ? "退场" : "入场"}动画？`}
        message={`将 ${pendingSave?.count ?? 0} 个现有事件改为继承全局设置；另一阶段与强调动画保持原样。`}
        icon={<Save size={20} />} testId="sprite-animation-default-confirmation" confirmLabel="取消" inertBackground suppressHoverHelp
        contextAction={{label:"确认应用", dismissOnClick:true, onClick:() => {
          if (pendingSave) void commitGlobal(pendingSave, true);
        }}} onDismiss={() => setPendingSave(undefined)} />

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
          <GlassSelectionGroup
            className="animation-template-groups"
            role="tablist"
            ariaLabel="动画模板分类"
            selectedKey={categoryId}
          >
            {animationPresetCategories.map((category) => {
              const Icon = category.icon;
              const isActive = category.id === categoryId;
              return (
                <button
                  key={category.id}
                  type="button"
                  className={isActive ? "is-active" : ""}
                  role="tab"
                  aria-selected={isActive}
                  data-glass-selected={isActive}
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
          </GlassSelectionGroup>

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
              <button type="button" aria-label="关闭动画模板选择" data-help-key="animation.templatePicker.close" onClick={() => closeTemplatePicker(true)}>
                ×
              </button>
            </header>
            <div className="animation-template-list selection-scroll-region">
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
                    onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })}
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

        <section className="animation-preview-panel">
          <header className="animation-section-header">
            <div>
              <h4>{currentTemplate.title} · 预览</h4>
              <p>{currentTemplate.summary} {currentTemplate.recommended_scene}</p>
            </div>
          </header>
          <div className="animation-preview-fit">
            <div className={`animation-preview-stage is-${draft.target_type}`} ref={previewStageRef}>
              <div className="animation-preview-scene" ref={previewSceneRef}>
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
            </div>
          </div>
          <div className="row-actions animation-preview-actions">
            <button type="button" data-help-key="animation.preview" onClick={previewCurrentPreset}>
              <Play size={16} />
              <span>{playing ? "重新播放" : "预览播放"}</span>
            </button>
            <button type="button" data-help-key="animation.stopPreview" onClick={stopPreview} disabled={!playing}>
              <Square size={14} /><span>停止</span>
            </button>
            <button type="button" data-help-key="animation.insert" onClick={applyToNode} disabled={!selectedNodeId}>
              <Wand2 size={16} />
              <span>插入到当前节点</span>
            </button>
          </div>
          {previewError && <p role="status" className="animation-panel-note">{previewError}</p>}
          {!selectedNodeId && <p className="animation-panel-note">先选中场景节点；旧工程也可以选中旧版动画节点继续维护。</p>}
          {node?.data.nodeKind === "animation" && <p className="animation-panel-note">当前会覆盖旧版动画节点里的动画指令；建议完成后使用节点上的转换入口迁移。</p>}
          {node?.data.scene && <p className="animation-panel-note">当前会把动画追加到场景节点的命令列表末尾。</p>}
        </section>
        <div className="animation-property-panel">
          <div className="animation-inspector-modes" role="group" aria-label="动画参数面板">
            <button type="button" aria-pressed={!isAdvancedOpen} onClick={() => setAdvancedOpen(false)}>基础参数</button>
            <button type="button" aria-pressed={isAdvancedOpen} onClick={() => setAdvancedOpen(true)}>高级定制</button>
          </div>
          {isAdvancedOpen ? (
          <section className="animation-advanced-panel">
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
            <AnimationTimeline
              key={templateId}
              keyframes={draft.keyframes}
              showExpertCss={isExpertOpen}
              onToggleExpertCss={() => setExpertOpen(current => !current)}
              onChange={keyframes => setDraft(current => ({ ...current, keyframes }))}
            />
          </section>
          ) : (
          <section className="animation-quick-controls">
            <header className="animation-section-header">
              <h4>快速微调</h4>
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
          )}
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
        </div>
      </div>
    </section>
  );
}

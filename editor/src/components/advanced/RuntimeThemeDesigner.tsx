import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react";
import { CheckCircle2, Monitor, Palette, RotateCcw, Save, Smartphone, Type } from "lucide-react";
import {
  applyRuntimeThemePreset,
  applyRuntimeThemeTokens,
  cloneUISkinLayout,
  componentStylesFromThemeTokens,
  defaultRuntimeThemePresetId,
  runtimeThemePresets,
  type RuntimeThemePreset,
} from "../../../../shared/cartridge/uiThemePresets";
import {
  getDefaultUISkinLayout,
  validateUISkinHealth,
  validateUISkinLayout,
  type UILayoutComponentStyle,
  type UILayoutComponentType,
  type UILayoutTokens,
  type UISkinLayout,
} from "../../../../shared/cartridge/uiSkin";
import { useProjectStore } from "../../store/projectStore";
import { RichSelect, type RichSelectOption } from "../common/RichSelect";
import { RangeControl } from "../common/RangeControl";

type PreviewScreen = "title" | "player" | "settings" | "save";
type ThemeScope = "tokens" | "slider" | UILayoutComponentType;
type UISkinValidationResult = ReturnType<typeof validateUISkinLayout>;

interface UISkinValidationState {
  ready: boolean;
  schemaValidation: UISkinValidationResult;
  healthValidation: UISkinValidationResult;
}

const pendingUISkinValidation: UISkinValidationResult = { ok: true, errors: [], warnings: [] };

function runSkinValidation(skin: UISkinLayout, assetPaths: string[], assetIds: string[]): Omit<UISkinValidationState, "ready"> {
  return {
    schemaValidation: validateUISkinLayout(skin),
    healthValidation: validateUISkinHealth(skin, { availableAssetPaths: assetPaths, availableAssetIds: assetIds }),
  };
}

function scheduleIdleTask(callback: () => void, timeout = 180): () => void {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, timeout);
  return () => globalThis.clearTimeout(id);
}

const baseColorTokenControls: Array<{ key: keyof UILayoutTokens; label: string; fallback: string }> = [
  { key: "colorBackground", label: "背景", fallback: "#060812" },
  { key: "colorSurface", label: "面板", fallback: "#0d121f" },
  { key: "colorSurfaceStrong", label: "强面板", fallback: "#192234" },
  { key: "colorInk", label: "主文字", fallback: "#f6f8ff" },
  { key: "colorMuted", label: "弱文字", fallback: "#aeb9cc" },
  { key: "colorAccent", label: "主强调", fallback: "#82b6ff" },
  { key: "colorAccent2", label: "副强调", fallback: "#f2a0c4" },
  { key: "colorLine", label: "边线", fallback: "#d8e2ff" },
  { key: "colorPanel", label: "设置/存档面板", fallback: "#0d121f" },
  { key: "colorPanelText", label: "面板文字", fallback: "#f6f8ff" },
  { key: "colorControl", label: "控件", fallback: "#192234" },
  { key: "colorControlHover", label: "控件悬停", fallback: "#24324d" },
  { key: "colorControlActive", label: "控件选中", fallback: "#82b6ff" },
  { key: "colorControlText", label: "控件文字", fallback: "#f6f8ff" },
  { key: "colorDialog", label: "对白框", fallback: "#060a14" },
  { key: "colorDialogText", label: "对白文字", fallback: "#f6f8ff" },
  { key: "colorSpeakerPlate", label: "人物名牌", fallback: "#192234" },
  { key: "colorSpeakerText", label: "名牌文字", fallback: "#cde1ff" },
  { key: "colorChoice", label: "选项背景", fallback: "#82b6ff" },
  { key: "colorChoiceText", label: "选项文字", fallback: "#07111f" },
  { key: "colorQuickMenu", label: "快捷菜单", fallback: "#0d121f" },
  { key: "colorFocus", label: "焦点环", fallback: "#82b6ff" },
  { key: "colorDanger", label: "危险", fallback: "#ff7d8a" },
  { key: "colorWarning", label: "警告", fallback: "#f3b45f" },
  { key: "colorSuccess", label: "通过", fallback: "#75d58c" },
];

const sliderColorTokenControls: Array<{ key: keyof UILayoutTokens; label: string; fallback: string }> = [
  { key: "colorSliderTrack", label: "轨道", fallback: "#214a55" },
  { key: "colorSliderActive", label: "进度", fallback: "#6edee4" },
  { key: "colorSliderThumb", label: "按钮", fallback: "#eaffff" },
];

const scopeOptions: Array<{ id: ThemeScope; label: string }> = [
  { id: "tokens", label: "全局主题" },
  { id: "slider", label: "滑杆配色" },
  { id: "dialog_panel", label: "对白框" },
  { id: "speaker_label", label: "人物名牌" },
  { id: "dialog_text", label: "对白正文" },
  { id: "choice_list", label: "选项列表" },
  { id: "quick_menu", label: "快捷菜单" },
  { id: "main_menu_continue_button", label: "继续游戏按钮" },
  { id: "main_menu_start_button", label: "开始/重新开始按钮" },
  { id: "main_menu_save_load_button", label: "存档/读档按钮" },
  { id: "main_menu_library_button", label: "卡带库按钮" },
  { id: "main_menu_gallery_button", label: "画廊按钮" },
  { id: "main_menu_settings_button", label: "设置按钮" },
  { id: "main_menu_about_button", label: "关于按钮" },
  { id: "menu_button", label: "菜单按钮" },
  { id: "settings_group", label: "设置组" },
  { id: "save_slot_grid", label: "存档格" },
  { id: "history_list", label: "历史列表" },
  { id: "gallery_grid", label: "画廊网格" },
  { id: "about_panel", label: "关于面板" },
];

const scopeSelectOptions: Array<RichSelectOption<ThemeScope>> = scopeOptions.map((item) => ({
  value: item.id,
  label: item.label,
}));

const fontStyleOptions: Array<RichSelectOption<"" | NonNullable<UILayoutComponentStyle["fontStyle"]>>> = [
  { value: "", label: "默认" },
  { value: "normal", label: "正常" },
  { value: "italic", label: "斜体" },
];

const shadowOptions: Array<RichSelectOption<"" | NonNullable<UILayoutComponentStyle["shadow"]>>> = [
  { value: "", label: "默认" },
  { value: "none", label: "无" },
  { value: "soft", label: "柔和" },
  { value: "strong", label: "强" },
];

const previewScreens: Array<{ id: PreviewScreen; label: string }> = [
  { id: "player", label: "对白页" },
  { id: "title", label: "标题页" },
  { id: "settings", label: "设置页" },
  { id: "save", label: "存档页" },
];

function firstComponentStyle(skin: UISkinLayout, componentType: UILayoutComponentType): UILayoutComponentStyle {
  for (const screen of skin.screens) {
    const component = screen.components.find((item) => item.component_type === componentType);
    if (component) return component.style ?? {};
  }
  return {};
}

function hasComponentType(skin: UISkinLayout, componentType: UILayoutComponentType): boolean {
  return skin.screens.some((screen) => screen.components.some((component) => component.component_type === componentType));
}

function mergeRuntimeThemeTokensOnly(skin: UISkinLayout, tokens: Partial<UILayoutTokens>): UISkinLayout {
  return {
    ...skin,
    tokens: {
      ...(skin.tokens ?? {}),
      ...tokens,
    },
  };
}

function componentTokenStyle(skin: UISkinLayout, componentType: UILayoutComponentType): UILayoutComponentStyle {
  return componentStylesFromThemeTokens(skin.tokens ?? {})[componentType] ?? {};
}

function selectedComponentStyle(skin: UISkinLayout, componentType: UILayoutComponentType): UILayoutComponentStyle {
  const style = firstComponentStyle(skin, componentType);
  if (Object.keys(style).length > 0 || hasComponentType(skin, componentType)) return style;
  return componentTokenStyle(skin, componentType);
}

function stylePatchToRuntimeTokens(componentType: UILayoutComponentType, patch: Partial<UILayoutComponentStyle>): Partial<UILayoutTokens> | undefined {
  if (componentType !== "menu_button") return undefined;
  const nextTokens: Partial<UILayoutTokens> = {};
  if ("backgroundColor" in patch) nextTokens.colorControl = patch.backgroundColor;
  if ("color" in patch) nextTokens.colorControlText = patch.color;
  if ("accentColor" in patch) {
    nextTokens.colorControlActive = patch.accentColor;
    nextTokens.colorSliderActive = patch.accentColor;
  }
  if ("borderColor" in patch) {
    nextTokens.colorLine = patch.borderColor;
    nextTokens.colorSliderTrack = patch.borderColor;
  }
  if ("backgroundColor" in patch) nextTokens.colorSliderThumb = patch.backgroundColor;
  if ("borderRadius" in patch) nextTokens.radius = patch.borderRadius;
  return Object.keys(nextTokens).length > 0 ? nextTokens : undefined;
}

function resetTokensForComponent(componentType: UILayoutComponentType): Partial<UILayoutTokens> | undefined {
  if (componentType !== "menu_button") return undefined;
  const defaults = getDefaultUISkinLayout().tokens;
  return {
    colorControl: defaults.colorControl,
    colorControlText: defaults.colorControlText,
    colorControlActive: defaults.colorControlActive,
    colorSliderTrack: defaults.colorSliderTrack,
    colorSliderActive: defaults.colorSliderActive,
    colorSliderThumb: defaults.colorSliderThumb,
    colorLine: defaults.colorLine,
    radius: defaults.radius,
  };
}

function updateComponentsByType(skin: UISkinLayout, componentType: UILayoutComponentType, patch: Partial<UILayoutComponentStyle>): UISkinLayout {
  let found = false;
  const screens = skin.screens.map((screen) => ({
    ...screen,
    components: screen.components.map((component) => {
      if (component.component_type !== componentType) return component;
      found = true;
      return { ...component, style: { ...(component.style ?? {}), ...patch } };
    }),
  }));
  if (found || componentType !== "dialog_text") return { ...skin, screens };

  return {
    ...skin,
    screens: screens.map((screen) => screen.screen_id === "player"
      ? {
          ...screen,
          components: [
            ...screen.components,
            {
              component_id: "dialog_text",
              component_type: "dialog_text",
              label: "Dialog Text",
              style: { ...patch },
            },
          ],
        }
      : screen),
  };
}

function resetComponentsByType(skin: UISkinLayout, componentType: UILayoutComponentType): UISkinLayout {
  const defaults = getDefaultUISkinLayout();
  const defaultStyle = firstComponentStyle(defaults, componentType);
  return {
    ...skin,
    screens: skin.screens.map((screen) => ({
      ...screen,
      components: screen.components.map((component) => component.component_type === componentType
        ? { ...component, style: Object.keys(defaultStyle).length > 0 ? { ...defaultStyle } : undefined }
        : component),
    })),
  };
}

function tokenValue(tokens: UILayoutTokens, key: keyof UILayoutTokens, fallback: string): string {
  const value = tokens[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function colorPickerValue(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function previewStyle(tokens: UILayoutTokens): CSSProperties {
  return {
    "--theme-preview-bg": tokens.colorBackground ?? "#060812",
    "--theme-preview-surface": tokens.colorSurface ?? "#0d121f",
    "--theme-preview-strong": tokens.colorSurfaceStrong ?? "#192234",
    "--theme-preview-ink": tokens.colorInk ?? "#f6f8ff",
    "--theme-preview-muted": tokens.colorMuted ?? "#aeb9cc",
    "--theme-preview-accent": tokens.colorAccent ?? "#82b6ff",
    "--theme-preview-accent-2": tokens.colorAccent2 ?? "#f2a0c4",
    "--theme-preview-line": tokens.colorLine ?? "#d8e2ff",
    "--theme-preview-panel": tokens.colorPanel ?? tokens.colorSurface ?? "#0d121f",
    "--theme-preview-panel-text": tokens.colorPanelText ?? tokens.colorInk ?? "#f6f8ff",
    "--theme-preview-control": tokens.colorControl ?? tokens.colorSurfaceStrong ?? "#192234",
    "--theme-preview-control-hover": tokens.colorControlHover ?? tokens.colorSurface ?? "#24324d",
    "--theme-preview-control-active": tokens.colorControlActive ?? tokens.colorAccent ?? "#82b6ff",
    "--theme-preview-control-text": tokens.colorControlText ?? tokens.colorInk ?? "#f6f8ff",
    "--theme-preview-slider-track": tokens.colorSliderTrack ?? "#214a55",
    "--theme-preview-slider-active": tokens.colorSliderActive ?? "#6edee4",
    "--theme-preview-slider-thumb": tokens.colorSliderThumb ?? "#eaffff",
    "--theme-preview-dialog": tokens.colorDialog ?? tokens.colorSurface ?? "#060a14",
    "--theme-preview-dialog-text": tokens.colorDialogText ?? tokens.colorInk ?? "#f6f8ff",
    "--theme-preview-speaker": tokens.colorSpeakerPlate ?? tokens.colorSurfaceStrong ?? "#192234",
    "--theme-preview-speaker-text": tokens.colorSpeakerText ?? tokens.colorAccent ?? "#cde1ff",
    "--theme-preview-choice": tokens.colorChoice ?? tokens.colorAccent ?? "#82b6ff",
    "--theme-preview-choice-text": tokens.colorChoiceText ?? "#ffffff",
    "--theme-preview-quick": tokens.colorQuickMenu ?? tokens.colorSurface ?? "#0d121f",
    "--theme-preview-focus": tokens.colorFocus ?? tokens.colorAccent ?? "#82b6ff",
    "--theme-preview-radius": `${tokens.radius ?? 10}px`,
  } as CSSProperties;
}

function ThemeMiniPreview({ skin, screen = "player", compact = false }: { skin: UISkinLayout; screen?: PreviewScreen; compact?: boolean }) {
  const tokens = skin.tokens ?? {};
  const choiceStyle = firstComponentStyle(skin, "choice_list");
  const style = {
    ...previewStyle(tokens),
    "--theme-preview-choice": choiceStyle.backgroundColor ?? tokens.colorChoice ?? tokens.colorAccent ?? "#82b6ff",
    "--theme-preview-choice-text": choiceStyle.color ?? tokens.colorChoiceText ?? "#07111f",
    "--theme-preview-choice-border": choiceStyle.borderColor ?? tokens.colorLine ?? "#d8e2ff",
    "--theme-preview-choice-accent": choiceStyle.accentColor ?? tokens.colorChoice ?? tokens.colorAccent ?? "#82b6ff",
    "--theme-preview-choice-radius": typeof choiceStyle.borderRadius === "number" ? `${choiceStyle.borderRadius}px` : "999px",
  } as CSSProperties;
  return (
    <div className={`runtime-theme-preview${compact ? " compact" : ""}`} style={style} aria-hidden={compact}>
      <div className="runtime-theme-preview-stage">
        {(screen === "title" || compact) && (
          <div className="runtime-theme-preview-title">
            <strong>AgentVN</strong>
            <span className="runtime-theme-preview-button">开始游戏</span>
            <span className="runtime-theme-preview-button">设置</span>
          </div>
        )}
        {(screen === "player" || compact) && (
          <>
            <div className="runtime-theme-preview-quick">
              <span />
              <span />
              <span />
            </div>
            <div className="runtime-theme-preview-dialog">
              <span className="runtime-theme-preview-speaker">角色名</span>
              <p>这里是主题预览对白。控件颜色、字体和名牌会随当前方案实时变化。</p>
            </div>
            <div className="runtime-theme-preview-choices">
              <span className="runtime-theme-preview-choice">继续前进</span>
              <span className="runtime-theme-preview-choice">查看线索</span>
            </div>
          </>
        )}
        {screen === "settings" && !compact && (
          <div className="runtime-theme-preview-settings">
            <strong>设置</strong>
            <label><span>全屏窗口化</span><i /></label>
            <label><span>文字速度</span><b /></label>
            <label><span>跳过未读</span><i className="checked" /></label>
          </div>
        )}
        {screen === "save" && !compact && (
          <div className="runtime-theme-preview-save">
            {["01", "02", "03", "04"].map((item) => (
              <article key={item}>
                <strong>存档 {item}</strong>
                <span>章节预览</span>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ColorControl({
  label,
  value,
  fallback,
  onChange,
  helpKey,
}: {
  label: string;
  value?: string;
  fallback: string;
  onChange: (value: string | undefined) => void;
  helpKey: string;
}) {
  return (
    <label className="runtime-theme-color-field">
      <span>{label}</span>
      <div>
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={colorPickerValue(value, fallback)}
          data-help-key={helpKey}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          aria-label={`${label} color value`}
          value={value ?? ""}
          placeholder={fallback}
          data-help-key={helpKey}
          onChange={(event) => onChange(event.target.value.trim() || undefined)}
        />
      </div>
    </label>
  );
}

function NumberControl({
  label,
  value,
  fallback,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value?: number;
  fallback: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number | undefined) => void;
}) {
  const current = numberValue(value, fallback);
  return (
    <label className="runtime-theme-number-field">
      <span>{label}</span>
      <div>
        <RangeControl min={min} max={max} step={step} value={current} helpKey="theme.customNumber" ariaLabel={`${label} slider`} onChange={(nextValue) => onChange(nextValue)} />
        <input type="number" min={min} max={max} step={step} value={current} data-help-key="theme.customNumber" onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />
      </div>
    </label>
  );
}

export function RuntimeThemeDesigner() {
  const savedSkin = useProjectStore((state) => state.settings.runtimeUILayout);
  const setRuntimeUILayout = useProjectStore((state) => state.setRuntimeUILayout);
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const [draft, setDraft] = useState<UISkinLayout>(() => cloneUISkinLayout(savedSkin));
  const [selectedPresetId, setSelectedPresetId] = useState(defaultRuntimeThemePresetId);
  const [selectedScope, setSelectedScope] = useState<ThemeScope>("tokens");
  const [previewScreen, setPreviewScreen] = useState<PreviewScreen>("player");
  const [showDetails, setShowDetails] = useState(false);
  const [hoveredPresetId, setHoveredPresetId] = useState<string>();
  const [validationState, setValidationState] = useState<UISkinValidationState>({
    ready: false,
    schemaValidation: pendingUISkinValidation,
    healthValidation: pendingUISkinValidation,
  });

  useEffect(() => {
    setDraft(cloneUISkinLayout(savedSkin));
  }, [savedSkin]);

  const assetPaths = useMemo(() => assetManifest.map((asset) => asset.metadata.path).filter((path): path is string => Boolean(path)), [assetManifest]);
  const assetIds = useMemo(() => assetManifest.map((asset) => asset.asset_id), [assetManifest]);
  const deferredDraft = useDeferredValue(draft);
  const deferredAssetPaths = useDeferredValue(assetPaths);
  const deferredAssetIds = useDeferredValue(assetIds);
  const schemaValidation = validationState.schemaValidation;
  const healthValidation = validationState.healthValidation;
  const validationPending = !validationState.ready;
  const allIssues = validationPending ? [] : [...schemaValidation.errors, ...schemaValidation.warnings, ...healthValidation.errors, ...healthValidation.warnings];
  const schemaBlockingCount = schemaValidation.errors.length;
  const layoutBlockingCount = healthValidation.errors.length;
  const blockingCount = schemaBlockingCount + layoutBlockingCount;
  const warningCount = schemaValidation.warnings.length + healthValidation.warnings.length;
  const isDirty = JSON.stringify(savedSkin) !== JSON.stringify(draft);
  const selectedStyle = selectedScope === "tokens" || selectedScope === "slider" ? undefined : selectedComponentStyle(draft, selectedScope);
  const selectedScopeUsesRuntimeTokens = selectedScope !== "tokens" && selectedScope !== "slider" && Boolean(stylePatchToRuntimeTokens(selectedScope, { backgroundColor: selectedStyle?.backgroundColor }));
  const canSaveTheme = validationPending || schemaBlockingCount === 0;

  useEffect(() => {
    setValidationState((current) => current.ready ? { ...current, ready: false } : current);
    return scheduleIdleTask(() => {
      setValidationState({ ready: true, ...runSkinValidation(deferredDraft, deferredAssetPaths, deferredAssetIds) });
    });
  }, [deferredAssetIds, deferredAssetPaths, deferredDraft]);

  function applyPreset(preset: RuntimeThemePreset) {
    setSelectedPresetId(preset.preset_id);
    setDraft((current) => applyRuntimeThemePreset(current, preset));
  }

  function updateToken(key: keyof UILayoutTokens, value: string | number | undefined) {
    setDraft((current) => applyRuntimeThemeTokens(current, { [key]: value }));
  }

  function updateStyle(patch: Partial<UILayoutComponentStyle>) {
    if (selectedScope === "tokens" || selectedScope === "slider") return;
    setDraft((current) => {
      const tokenPatch = stylePatchToRuntimeTokens(selectedScope, patch);
      if (tokenPatch) {
        const withTokens = mergeRuntimeThemeTokensOnly(current, tokenPatch);
        return hasComponentType(withTokens, selectedScope) ? updateComponentsByType(withTokens, selectedScope, patch) : withTokens;
      }
      return updateComponentsByType(current, selectedScope, patch);
    });
  }

  function resetScope() {
    if (selectedScope === "tokens") {
      setDraft((current) => applyRuntimeThemeTokens(current, { ...getDefaultUISkinLayout().tokens }));
      return;
    }
    if (selectedScope === "slider") {
      setDraft((current) => applyRuntimeThemeTokens(current, {
        colorSliderTrack: undefined,
        colorSliderActive: undefined,
        colorSliderThumb: undefined,
      }));
      return;
    }
    const tokenReset = resetTokensForComponent(selectedScope);
    if (tokenReset) {
      setDraft((current) => {
        const withTokens = mergeRuntimeThemeTokensOnly(current, tokenReset);
        return hasComponentType(withTokens, selectedScope) ? resetComponentsByType(withTokens, selectedScope) : withTokens;
      });
      return;
    }
    setDraft((current) => resetComponentsByType(current, selectedScope));
  }

  function restoreDefaultTheme() {
    setSelectedPresetId(defaultRuntimeThemePresetId);
    setDraft(getDefaultUISkinLayout());
  }

  function saveTheme() {
    setShowDetails(true);
    const nextValidation = runSkinValidation(draft, assetPaths, assetIds);
    setValidationState({ ready: true, ...nextValidation });
    if (!nextValidation.schemaValidation.ok) return;
    setRuntimeUILayout(draft);
  }

  return (
    <section className="runtime-theme-designer">
      <header className="runtime-theme-header">
        <div>
          <span className="panel-kicker">工具/设置 &gt; 客户端主题</span>
          <h3>客户端主题</h3>
          <p>{isDirty ? "主题有未保存修改，保存后会写入导出的 ui/layout.json；玩家客户端只读取这里导出的配色。" : "当前主题已保存。"}</p>
        </div>
        <div className="row-actions">
          <button type="button" className={previewScreen === "player" ? "is-active" : ""} data-help-key="theme.previewScreen" onClick={() => setPreviewScreen("player")}><Monitor size={16} />对白</button>
          <button type="button" className={previewScreen === "settings" ? "is-active" : ""} data-help-key="theme.previewScreen" onClick={() => setPreviewScreen("settings")}><Smartphone size={16} />设置</button>
          <button type="button" data-help-key="theme.restoreDefault" onClick={restoreDefaultTheme}><RotateCcw size={16} />恢复默认</button>
          <button type="button" data-help-key="theme.save" disabled={!canSaveTheme} onClick={saveTheme}><Save size={16} />保存主题</button>
        </div>
      </header>

      <div className="runtime-theme-grid">
        <aside className="runtime-theme-presets" aria-label="主题预设">
          <header>
            <Palette size={17} />
            <strong>预设</strong>
            <span>{runtimeThemePresets.length} 套</span>
          </header>
          <div className="runtime-theme-preset-list">
            {runtimeThemePresets.map((preset) => {
              const previewSkin = hoveredPresetId === preset.preset_id ? applyRuntimeThemePreset(draft, preset) : undefined;
              return (
                <button
                  type="button"
                  key={preset.preset_id}
                  className={selectedPresetId === preset.preset_id ? "is-active" : ""}
                  data-help-key="theme.preset"
                  onPointerEnter={() => setHoveredPresetId(preset.preset_id)}
                  onPointerLeave={() => setHoveredPresetId((current) => current === preset.preset_id ? undefined : current)}
                  onFocus={() => setHoveredPresetId(preset.preset_id)}
                  onBlur={() => setHoveredPresetId((current) => current === preset.preset_id ? undefined : current)}
                  onClick={() => applyPreset(preset)}
                >
                  <span className="runtime-theme-swatches" aria-hidden="true">
                    <i style={{ background: preset.tokens.colorBackground }} />
                    <i style={{ background: preset.tokens.colorSurface }} />
                    <i style={{ background: preset.tokens.colorAccent }} />
                    <i style={{ background: preset.tokens.colorAccent2 }} />
                  </span>
                  <span>
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </span>
                  {previewSkin && <span className="runtime-theme-hover-preview" role="presentation">
                    <ThemeMiniPreview skin={previewSkin} compact />
                  </span>}
                </button>
              );
            })}
          </div>
        </aside>

        <main className="runtime-theme-preview-panel">
          <div className="runtime-theme-preview-toolbar">
            {previewScreens.map((screen) => (
              <button key={screen.id} type="button" className={previewScreen === screen.id ? "is-active" : ""} data-help-key="theme.previewScreen" onClick={() => setPreviewScreen(screen.id)}>
                {screen.label}
              </button>
            ))}
          </div>
          <ThemeMiniPreview skin={draft} screen={previewScreen} />
        </main>

        <aside className="runtime-theme-inspector">
          <header>
            <Type size={17} />
            <div>
              <strong>自定义</strong>
              <small>选择全局主题或具体控件，调整玩家客户端的背景、文字、控件和边框配色。</small>
            </div>
          </header>

          <label className="runtime-theme-scope">
            <span>作用控件</span>
            <RichSelect
              value={selectedScope}
              options={scopeSelectOptions}
              helpKey="theme.scope"
              onChange={setSelectedScope}
            />
          </label>

          {selectedScope === "tokens" ? (
            <>
              <details className="runtime-theme-fieldset" open>
                <summary>基础与控件颜色</summary>
                <div className="runtime-theme-color-grid">
                  {baseColorTokenControls.map((control) => (
                    <ColorControl
                      key={control.key}
                      label={control.label}
                      value={draft.tokens?.[control.key] as string | undefined}
                      fallback={control.fallback}
                      helpKey="theme.colorToken"
                      onChange={(value) => updateToken(control.key, value)}
                    />
                  ))}
                </div>
              </details>
              <details className="runtime-theme-fieldset" open>
                <summary>全局形态</summary>
                <NumberControl label="圆角" value={draft.tokens.radius} fallback={10} min={0} max={48} onChange={(value) => updateToken("radius", value)} />
                <NumberControl label="动效比例" value={draft.tokens.motionScale} fallback={1} min={0} max={2} step={0.05} onChange={(value) => updateToken("motionScale", value)} />
                <NumberControl label="字体比例" value={draft.tokens.fontScale} fallback={1} min={0.75} max={1.45} step={0.05} onChange={(value) => updateToken("fontScale", value)} />
              </details>
            </>
          ) : selectedScope === "slider" ? (
            <details className="runtime-theme-fieldset" open>
              <summary>控件颜色</summary>
              <div className="runtime-theme-color-grid">
                {sliderColorTokenControls.map((control) => (
                  <ColorControl
                    key={control.key}
                    label={control.label}
                    value={draft.tokens?.[control.key] as string | undefined}
                    fallback={control.fallback}
                    helpKey="theme.sliderColorToken"
                    onChange={(value) => updateToken(control.key, value)}
                  />
                ))}
              </div>
            </details>
          ) : (
            <>
              <details className="runtime-theme-fieldset" open>
                <summary>控件颜色</summary>
                <ColorControl label={selectedScope === "choice_list" ? "选项背景" : "背景色"} value={selectedStyle?.backgroundColor} fallback={selectedScope === "choice_list" ? tokenValue(draft.tokens, "colorChoice", "#82b6ff") : tokenValue(draft.tokens, "colorPanel", "#0d121f")} helpKey="theme.componentColor" onChange={(value) => updateStyle({ backgroundColor: value })} />
                <ColorControl label={selectedScope === "choice_list" ? "选项文字" : "文字色"} value={selectedStyle?.color} fallback={selectedScope === "choice_list" ? tokenValue(draft.tokens, "colorChoiceText", "#07111f") : tokenValue(draft.tokens, "colorInk", "#f6f8ff")} helpKey="theme.componentColor" onChange={(value) => updateStyle({ color: value })} />
                <ColorControl label={selectedScope === "choice_list" ? "悬停高亮" : "强调色"} value={selectedStyle?.accentColor} fallback={selectedScope === "choice_list" ? tokenValue(draft.tokens, "colorChoice", "#82b6ff") : tokenValue(draft.tokens, "colorAccent", "#82b6ff")} helpKey="theme.componentColor" onChange={(value) => updateStyle({ accentColor: value })} />
                <ColorControl label={selectedScope === "choice_list" ? "选项边框" : "边框色"} value={selectedStyle?.borderColor} fallback={tokenValue(draft.tokens, "colorLine", "#d8e2ff")} helpKey="theme.componentColor" onChange={(value) => updateStyle({ borderColor: value })} />
              </details>
              <details className="runtime-theme-fieldset" open>
                <summary>字体与形态</summary>
                {!selectedScopeUsesRuntimeTokens && (
                  <>
                    <NumberControl label="字号" value={selectedStyle?.fontSize} fallback={16} min={10} max={44} onChange={(value) => updateStyle({ fontSize: value })} />
                    <NumberControl label="字重" value={selectedStyle?.fontWeight} fallback={600} min={300} max={900} step={50} onChange={(value) => updateStyle({ fontWeight: value })} />
                    <label className="runtime-theme-scope">
                      <span>字体样式</span>
                      <RichSelect
                        value={selectedStyle?.fontStyle ?? ""}
                        options={fontStyleOptions}
                        helpKey="theme.fontStyle"
                        onChange={(nextStyle) => updateStyle({ fontStyle: nextStyle ? nextStyle as UILayoutComponentStyle["fontStyle"] : undefined })}
                      />
                    </label>
                  </>
                )}
                <NumberControl label="圆角" value={selectedStyle?.borderRadius} fallback={numberValue(draft.tokens.radius, 10)} min={0} max={64} onChange={(value) => updateStyle({ borderRadius: value })} />
                {!selectedScopeUsesRuntimeTokens && (
                  <>
                    <NumberControl label="内边距" value={selectedStyle?.padding} fallback={12} min={0} max={48} onChange={(value) => updateStyle({ padding: value })} />
                    <NumberControl label="间距" value={selectedStyle?.gap} fallback={8} min={0} max={32} onChange={(value) => updateStyle({ gap: value })} />
                    <label className="runtime-theme-scope">
                      <span>阴影</span>
                      <RichSelect
                        value={selectedStyle?.shadow ?? ""}
                        options={shadowOptions}
                        helpKey="theme.shadow"
                        onChange={(nextShadow) => updateStyle({ shadow: nextShadow ? nextShadow as UILayoutComponentStyle["shadow"] : undefined })}
                      />
                    </label>
                  </>
                )}
              </details>
            </>
          )}

          <div className="runtime-theme-inspector-actions">
            <button type="button" data-help-key="theme.resetScope" onClick={resetScope}><RotateCcw size={16} />重置当前控件</button>
          </div>
        </aside>
      </div>

      <section className={`runtime-theme-status${schemaBlockingCount === 0 ? " ok" : " is-error"}${layoutBlockingCount > 0 ? " has-layout-errors" : ""}`}>
        <button type="button" data-help-key="theme.validation" onClick={() => setShowDetails((current) => !current)}>
          <CheckCircle2 size={16} />
          主题体检：{validationPending
            ? "检测中"
            : schemaBlockingCount > 0
              ? `${schemaBlockingCount} 个结构错误`
              : layoutBlockingCount > 0
                ? `主题可保存，布局页还有 ${layoutBlockingCount} 个需修复问题`
                : warningCount > 0
                  ? `${warningCount} 个警告`
                  : "通过"}
        </button>
        {showDetails && (
          allIssues.length === 0 ? (
            <p>主题体检通过，保存后会随客户端布局一起导出。</p>
          ) : (
            <ul>
              {allIssues.map((item, index) => (
                <li key={`${item.code}_${index}`} className={item.severity === "error" ? "is-error" : "is-warning"}>{item.severity.toUpperCase()}: {item.message}</li>
              ))}
            </ul>
          )
        )}
      </section>
    </section>
  );
}

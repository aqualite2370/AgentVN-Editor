import { useEffect, useMemo, useState } from "react";
import { RenpyTitleView } from "../../../../GameCli_framework/src/components/shell/RenpyTitleView";
import { fontFamilyForAsset } from "../../../../GameCli_framework/src/uiSkin/uiSkinRuntime";
import { RENPY_GUI_DEFAULTS, RENPY_GUI_LIMITS, RENPY_MENU_FRAME_PROPERTIES, RENPY_TEMPLATE_VERSION, resolveRenpySaveGrid, type RenpyGUIStyle, type RenpyNavigationPage } from "../../../../shared/cartridge/renpyGui";
import type { UILayoutComponentStyle, UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { isBuiltinTitleButton, hasUILayoutOpacityLayers, resolveUILayoutBackgroundOpacity, speakerContainerDisplayLabel, supportsUILayoutOpacityLayers } from "../../../../shared/cartridge/uiSkin";
import type { BackgroundFit } from "../../../../shared/cartridge/types";
import "./renpy-title-editor.css";
import { RenpyRuntimePreview } from "./RenpyRuntimePreview";
import { RenpyPreviewStage } from "./RenpyPreviewStage";
import { RenpyGuiImportWorkbench } from "./RenpyGuiImportWorkbench";
import { RenpyButtonRoleEditor } from "./RenpyButtonRoleEditor";
import { CustomComponentLibraryPanel } from "./CustomComponentLibraryPanel";
import { addPersonalComponentToProject } from "../../renpy/customComponentProject";
import { restoreRuntimeLayoutPage } from "../../utils/runtimeLayoutRestore";
import type { PersonalComponentRecord } from "../../renpy/personalComponentLibrary";
import type { AssetRef } from "../../types/assets";
import { resolveUILayoutImagePreview } from "../../utils/uiLayoutAssetReference";
import { RichSelect } from "../common/RichSelect";
import { inspectFontCoverage } from "../../renpy/fontCoverageClient";
import type { FontCoverageResult } from "../../renpy/fontCoverage";
import { backendClient } from "../../api/backendClient";
import { RenpyControlAppearanceEditor } from "./RenpyControlAppearanceEditor";
import { ControlPresentationEditor } from "./ControlPresentationEditor";
import type { ControlPresentationSource } from "../../../../shared/cartridge/controlPresentation";
import { useProjectStore } from "../../store/projectStore";
import { recordLayoutHelpSelection } from "../../assistant/layoutHelpContext";
import { RenpyTitleTextEditor } from "./RenpyTitleTextEditor";
import { RenpySettingHelp } from "./RenpySettingHelp";
import { fitGameViewport, resolveGameViewport } from "../../../../shared/cartridge/gameViewport";

const pageLabels: Record<RenpyNavigationPage, string> = {
  title: "标题主页", preferences: "选项", save_load: "存档/读档", history: "历史", about: "关于", help: "帮助", gallery: "画廊",
};
const navigationProperties = [
  ["fontSize", "字号"], ["spacing", "间距"], ["x", "左边距"],
] as const;
const saveGridProperties = [
  ["saveColumns", "存档列数"], ["saveGap", "存档间距"],
] as const;
const regionStyleProperties = [
  { key: "backgroundColor", label: "页面背景色", kind: "color", fallback: "#18202c" },
  { key: "color", label: "页面文字色", kind: "color", fallback: "#f6f8ff" },
  { key: "borderColor", label: "页面边框色", kind: "color", fallback: "#ffffff" },
  { key: "borderWidth", label: "页面边框宽度", kind: "number", fallback: "0", min: 0, max: 24 },
  { key: "borderRadius", label: "页面圆角", kind: "number", fallback: "0", min: 0, max: 64 },
  { key: "backgroundOpacity", label: "页面背景不透明度", kind: "number", fallback: "1", min: 0, max: 1, step: 0.05 },
  { key: "contentOpacity", label: "页面内容不透明度", kind: "number", fallback: "1", min: 0, max: 1, step: 0.05 },
  { key: "fontSize", label: "页面字号", kind: "number", fallback: "18", min: 8, max: 96 },
  { key: "padding", label: "页面内边距", kind: "number", fallback: "0", min: 0, max: 96 },
  { key: "backdropBlur", label: "页面背景模糊", kind: "number", fallback: "0", min: 0, max: 48 },
] as const;
type RegionStyleKey = typeof regionStyleProperties[number]["key"];
const buttonRoleManagedComponentTypes = new Set([
  "choice_option",
  "quick_button",
  "main_menu_continue_button",
  "main_menu_start_button",
  "main_menu_save_load_button",
  "main_menu_gallery_button",
  "main_menu_settings_button",
  "main_menu_about_button",
  "main_menu_custom_button",
]);
const regionLabels: Record<string, string> = {
  main_menu_hero: "标题信息",
  main_menu_continue_button: "继续游戏按钮",
  main_menu_start_button: "开始游戏按钮",
  main_menu_save_load_button: "存档按钮",
  main_menu_gallery_button: "画廊按钮",
  main_menu_settings_button: "选项按钮",
  main_menu_about_button: "关于按钮",
  main_menu_exit_button: "退出按钮",
  main_menu_custom_button_container: "自定义按钮区域",
  main_menu_custom_button: "自定义标题按钮",
  dialog_panel: "对话框",
  speaker_label: "姓名容器",
  dialog_text: "对白正文",
  continue_indicator: "继续提示",
  choice_list: "分支选项区域",
  quick_menu: "快捷栏",
  game_menu_nav: "游戏菜单导航",
  save_slot_grid: "存档网格",
  settings_group: "设置区域",
  history_list: "历史列表",
  gallery_grid: "画廊网格",
  about_panel: "关于面板",
  help_panel: "帮助面板",
  custom_component: "自定义组件",
};

export function RenpyTitleEditor({ draft, previewDraft = draft, title, fontCoverageText, page, backgroundUrl, backgroundFit, backgroundDimming,
  previewMode, onPreviewMode, onChange, onAssets, onPage, onOtherPages, onConfirmation, assets, onApplyGuiImport }: {
  draft: UISkinLayout;
  previewDraft?: UISkinLayout;
  title: string;
  fontCoverageText: string;
  page: RenpyNavigationPage;
  backgroundUrl?: string;
  backgroundFit?: BackgroundFit;
  backgroundDimming?: number;
  previewMode: "desktop" | "mobile";
  onPreviewMode: (mode: "desktop" | "mobile") => void;
  onChange: (layout: UISkinLayout) => void;
  onAssets?: (assets: AssetRef[]) => void;
  onPage: (page: RenpyNavigationPage) => void;
  onOtherPages: () => void;
  onConfirmation?: () => void;
  assets: AssetRef[];
  onApplyGuiImport: (nextLayout: UISkinLayout, nextAssets: AssetRef[]) => void;
}) {
  const [status, setStatus] = useState("");
  const [resetPending, setResetPending] = useState(false);
  const [titleRuntimePreview, setTitleRuntimePreview] = useState(false);
  const design = resolveGameViewport(previewDraft.gameViewport);
  const previewSize = previewMode === "mobile" ? { width: 915, height: 412 } : design;
  const previewFrame = fitGameViewport(previewSize, design);
  const gridComponent = draft.screens.find(screen => screen.screen_id === "save_load")?.components
    .find(component => component.component_type === "save_slot_grid");
  const gridBaseline = { saveColumns: gridComponent?.style?.columns, saveGap: gridComponent?.style?.gap };
  const inheritedGrid = resolveRenpySaveGrid({ shared: draft.renpy?.shared }, gridBaseline);
  const pageGrid = resolveRenpySaveGrid(draft.renpy, gridBaseline);
  const update = (scope: "shared" | RenpyNavigationPage, key: keyof RenpyGUIStyle, value?: number) => {
    const next = structuredClone(draft);
    next.renpy ??= {};
    next.renpy[scope] ??= {};
    if (value === undefined) delete next.renpy[scope]![key];
    else next.renpy[scope]![key] = value;
    onChange(next);
  };
  const updateInterfaceFont = (assetId: string) => {
    const next = structuredClone(draft);
    next.tokens ??= {};
    if (assetId) next.tokens.fontAssetId = assetId;
    else delete next.tokens.fontAssetId;
    onChange(next);
  };
  const field = (scope: "shared" | RenpyNavigationPage, key: keyof RenpyGUIStyle, label: string) => (
    <label key={`${scope}-${key}`}>{label}<input type="number" aria-label={label}
      min={RENPY_GUI_LIMITS[key][0]} max={RENPY_GUI_LIMITS[key][1]}
      step={1}
      value={key === "saveColumns" || key === "saveGap"
        ? (scope === "shared" ? inheritedGrid : pageGrid)[key]
        : draft.renpy?.[scope]?.[key] ?? draft.renpy?.shared?.[key] ?? RENPY_GUI_DEFAULTS[key]}
      onChange={(e) => {
        if (e.currentTarget.value === "") return;
        const n = e.currentTarget.valueAsNumber;
        if (Number.isFinite(n) && n >= RENPY_GUI_LIMITS[key][0] && n <= RENPY_GUI_LIMITS[key][1]
          && (key !== "saveColumns" || Number.isInteger(n)))
          update(scope, key, n);
      }} /></label>
  );
  const pageLabel = page === "title" ? "标题页" : pageLabels[page];
  const helpPanel = draft.screens.find((screen) => screen.screen_id === "help")?.components
    .find((component) => component.component_type === "help_panel");
  const titleHero = draft.screens.find((screen) => screen.screen_id === "title")?.components
    .find((component) => component.component_id === "title_hero");
  const titleHeroImage = resolveUILayoutImagePreview(titleHero?.style?.backgroundImage, assets).source;
  const titleHasOpacityLayers = hasUILayoutOpacityLayers(titleHero?.style);
  const titleBackgroundOpacity = titleHasOpacityLayers
    ? titleHero?.style?.backgroundOpacity
      ?? (titleHero?.style?.backgroundColor ? resolveUILayoutBackgroundOpacity("main_menu_hero", titleHero.style) : titleHero?.style?.opacity ?? 1)
    : undefined;
  const pageComponents = draft.screens.find((screen) => screen.screen_id === page)?.components ?? [];
  const regionComponents = pageComponents.filter((component) => component.rect);
  const [selectedRegionId, setSelectedRegionId] = useState("");
  const selectedRegion = regionComponents.find((component) => component.component_id === selectedRegionId)
    ?? regionComponents[0];
  const projectId = useProjectStore(state => state.projectId);
  useEffect(() => {
    recordLayoutHelpSelection(projectId, {
      layoutType: "renpy", screenId: page, componentId: selectedRegion?.component_id,
      advanced: Boolean(draft.advancedPresentationEnabled),
    });
  }, [projectId, page, selectedRegion?.component_id, draft.advancedPresentationEnabled]);
  const selectedRegionUsesButtonRole = selectedRegion
    ? buttonRoleManagedComponentTypes.has(selectedRegion.component_type)
    : false;
  const projectComponents = pageComponents.filter((component) => component.component_type === "custom_component");
  const updateRegionRect = (
    field: "x" | "y" | "width" | "height",
    value: number,
  ) => {
    if (!selectedRegion || !Number.isFinite(value)) return;
    const next = structuredClone(draft);
    const component = next.screens.find((screen) => screen.screen_id === page)?.components
      .find((item) => item.component_id === selectedRegion.component_id);
    if (!component?.rect || component.locked) return;
    const dimension = field === "width" || field === "height";
    const bounded = Math.max(dimension ? 2 : 0, Math.min(100, value));
    const rect = { ...component.rect, [field]: bounded };
    rect.x = Math.min(rect.x, 100 - rect.width);
    rect.y = Math.min(rect.y, 100 - rect.height);
    component.rect = rect;
    onChange(next);
  };
  const updateRegionStyle = (
    key: RegionStyleKey,
    value?: string | number,
  ) => {
    if (!selectedRegion) return;
    const next = structuredClone(draft);
    const component = next.screens.find((screen) => screen.screen_id === page)?.components
      .find((item) => item.component_id === selectedRegion.component_id);
    if (!component || component.locked) return;
    const style = { ...component.style };
    if (value === undefined) delete style[key];
    else if (key === "backgroundColor" || key === "color" || key === "borderColor") {
      if (typeof value !== "string") return;
      style[key] = value;
    } else {
      if (typeof value !== "number") return;
      style[key] = value;
    }
    if (Object.keys(style).length) component.style = style;
    else delete component.style;
    onChange(next);
  };
  const patchRegionStyle = (patch: Partial<UILayoutComponentStyle>, importedAsset?: AssetRef) => {
    if (!selectedRegion || selectedRegion.locked) return;
    const next = structuredClone(draft);
    const component = next.screens.find(screen => screen.screen_id === page)?.components
      .find(item => item.component_id === selectedRegion.component_id);
    if (!component) return;
    // Unlike AgentVN's title buttons, this type inherits GUI navigation.
    // Only explicitly authored properties may opt out of that inheritance.
    const inherited = isBuiltinTitleButton(component) && component.titleButtonStyleSource !== "layout";
    component.style = Object.fromEntries(Object.entries({ ...(inherited ? {} : component.style), ...patch })
      .filter(([, value]) => value !== undefined));
    if (isBuiltinTitleButton(component)) component.titleButtonStyleSource = "layout";
    if (!Object.keys(component.style).length) delete component.style;
    if (importedAsset) onApplyGuiImport(next, [importedAsset, ...assets]);
    else onChange(next);
  };
  const updatePresentation = (source?: ControlPresentationSource) => {
    if (!selectedRegion || selectedRegion.locked) return;
    const next = structuredClone(draft);
    const component = next.screens.find(screen => screen.screen_id === page)?.components
      .find(item => item.component_id === selectedRegion.component_id);
    if (!component) return;
    if (source) component.presentation = source;
    else delete component.presentation;
    onChange(next);
  };
  const patchRegionStateStyle = (state: "hover" | "selected" | "disabled", patch: Partial<UILayoutComponentStyle>) => {
    if (!selectedRegion || selectedRegion.locked) return;
    const next = structuredClone(draft);
    const component = next.screens.find(screen => screen.screen_id === page)?.components
      .find(item => item.component_id === selectedRegion.component_id);
    if (!component) return;
    const stateStyle = Object.fromEntries(Object.entries({ ...component.stateStyles?.[state], ...patch })
      .filter(([, value]) => value !== undefined));
    component.stateStyles = { ...component.stateStyles, [state]: stateStyle };
    if (!Object.keys(stateStyle).length) delete component.stateStyles[state];
    if (!Object.keys(component.stateStyles).length) delete component.stateStyles;
    onChange(next);
  };
  const applyPersonalComponent = (record: PersonalComponentRecord) => {
    if (projectComponents.length >= 12) throw new Error("当前页面最多放置 12 个自定义组件。");
    const index = projectComponents.length;
    const rect = {
      x: 8 + (index % 2) * 46,
      y: 14 + Math.floor(index / 2) * 24,
      width: 38,
      height: 18,
    };
    const next = addPersonalComponentToProject(draft, page, record, {
      componentId: `custom_component_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`,
      rect,
    }, assets);
    onAssets?.(next.assets);
    onChange(next.layout);
  };
  const updateProjectComponentRect = (
    componentId: string,
    field: "x" | "y" | "width" | "height",
    value: number,
  ) => {
    if (!Number.isFinite(value)) return;
    const next = structuredClone(draft);
    const component = next.screens.find((screen) => screen.screen_id === page)?.components
      .find((item) => item.component_id === componentId);
    if (!component?.rect) return;
    const dimension = field === "width" || field === "height";
    const bounded = Math.max(dimension ? 2 : 0, Math.min(100, value));
    const rect = { ...component.rect, [field]: bounded };
    if (rect.x + rect.width > 100) rect.x = Math.max(0, 100 - rect.width);
    if (rect.y + rect.height > 100) rect.y = Math.max(0, 100 - rect.height);
    component.rect = rect;
    onChange(next);
  };
  const fontAsset = assets.find((asset) => asset.asset_id === draft.tokens.fontAssetId
    && asset.asset_type === "font");
  const rawFontSource = fontAsset
    ? resolveUILayoutImagePreview(`asset:${fontAsset.asset_id}`, assets).source : undefined;
  const fontSource = rawFontSource ? backendClient.resolveProjectAssetUrl(rawFontSource) : undefined;
  const buttonAssetUrls = useMemo(() => Object.fromEntries(assets.flatMap((asset) => {
    const url = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
    return url ? [[asset.asset_id, backendClient.resolveProjectAssetUrl(url)]] : [];
  })), [assets]);
  const [fontLoadError, setFontLoadError] = useState("");
  const coverageText = fontCoverageText;
  const [fontCoverage, setFontCoverage] = useState<
    | { status: "system" | "loading" | "error"; message?: string }
    | { status: "complete" | "incomplete"; result: FontCoverageResult }
  >({ status: "system" });
  useEffect(() => {
    if (!fontAsset) {
      setFontLoadError("");
      setFontCoverage({ status: "system" });
      return;
    }
    if (!fontSource) {
      const message = "已选择自定义字体，但没有可读取的字体文件来源。";
      setFontLoadError(message);
      setFontCoverage({ status: "error", message });
      return;
    }
    const family = `AgentVNFont_${fontAsset.asset_id.replace(/[^a-z0-9_-]/gi, "_")}`;
    const face = new FontFace(family, `url(${JSON.stringify(fontSource)})`);
    let cancelled = false;
    let registered = false;
    const controller = new AbortController();
    setFontLoadError("");
    setFontCoverage({ status: "loading" });
    void Promise.all([
      face.load(),
      inspectFontCoverage(fontSource, coverageText, controller.signal),
    ]).then(([loaded, result]) => {
      if (cancelled) return;
      document.fonts.add(loaded);
      registered = true;
      setFontCoverage({
        status: result.missingCharacters > 0 ? "incomplete" : "complete",
        result,
      });
    }).catch((error: unknown) => {
      if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
      controller.abort();
      const message = error instanceof Error ? error.message : String(error);
      setFontLoadError(message);
      setFontCoverage({ status: "error", message });
    });
    return () => {
      cancelled = true;
      controller.abort();
      if (registered) document.fonts.delete(face);
    };
  }, [fontAsset?.asset_id, fontSource, coverageText]);
  const updateHelpPanelStyle = (key: "color" | "backgroundColor", value?: string) => {
    if (!helpPanel) return;
    const next = structuredClone(draft);
    const panel = next.screens.find((screen) => screen.screen_id === "help")?.components
      .find((component) => component.component_type === "help_panel");
    if (!panel) return;
    panel.style = { ...panel.style };
    if (value === undefined) delete panel.style[key];
    else panel.style[key] = value;
    onChange(next);
  };
  return <div className="runtime-layout-grid renpy-title-editor"
    data-testid={page === "title" ? "renpy-title-editor" : "renpy-menu-editor"} data-editor-page={page}>
    <aside className="runtime-layout-sidebar renpy-editor-fields">
      <h4>Ren’Py · 页面与共享样式</h4>
      <nav className="renpy-editor-page-list" aria-label="布局页面">
        {(Object.keys(pageLabels) as RenpyNavigationPage[]).map((id) => <button key={id} type="button"
          aria-current={page === id ? "page" : undefined}
          onClick={() => { setResetPending(false); onPage(id); }}>{pageLabels[id]}</button>)}
      </nav>
      <button type="button" data-testid="renpy-player-layout-entry" onClick={onOtherPages}>剧情与快捷栏布局</button>
      {onConfirmation && <button type="button" data-testid="renpy-confirmation-layout-entry" onClick={onConfirmation}>确认提示</button>}
      <RenpyGuiImportWorkbench layout={draft} existingAssets={assets} onApply={onApplyGuiImport} />
      <details className="renpy-personal-component-library">
        <summary>个人组件库</summary>
        <p>选择组件，将独立副本添加至{pageLabel}。</p>
        <CustomComponentLibraryPanel onAddToProject={applyPersonalComponent} />
      </details>
      <details className="renpy-project-components">
        <summary>当前页面组件（{projectComponents.length}）</summary>
        {projectComponents.length === 0
          ? <p>从个人组件库添加组件后，可在这里微调位置与尺寸。</p>
          : projectComponents.map((component) => <fieldset key={component.component_id}>
            <legend>{component.label}</legend>
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field}>{field}
                <input type="number" min={field === "x" || field === "y" ? 0 : 2} max={100}
                  value={component.rect?.[field] ?? 0}
                  onChange={(event) => updateProjectComponentRect(component.component_id, field, Number(event.currentTarget.value))} />
              </label>
            ))}
          </fieldset>)}
        <small>工程内是独立副本；修改或删除个人库原件不会改变这里的组件。</small>
      </details>
      <details className="renpy-shared-typography">
        <summary>共享字体与导航</summary>
      <label>全局界面字体
        <RichSelect ariaLabel="Ren'Py（进阶）全局界面字体" value={draft.tokens.fontAssetId ?? ""}
          onChange={updateInterfaceFont} options={[
            { value: "", label: "主题默认 / 系统字体回退" },
            ...assets.filter((asset) => asset.asset_type === "font").map((asset) => ({
              value: asset.asset_id,
              label: asset.metadata.display_name || asset.metadata.filename || asset.asset_id,
            })),
          ]} />
      </label>
      </details>
      <div className="renpy-font-coverage" data-testid="renpy-font-coverage-report"
        data-font-coverage={fontCoverage.status}
        data-font-source-kind={!fontAsset ? "missing-asset"
          : !fontSource ? "unavailable"
          : fontSource.startsWith("data:") ? "data"
          : fontSource.startsWith("blob:") ? "blob"
          : "url"}
        role="status" aria-live="polite">
        {fontCoverage.status === "system" && "未指定自定义字体；游戏客户端将使用目标设备的系统字体，设备字库差异无法在此预检。"}
        {fontCoverage.status === "loading" && "正在检查项目字符覆盖…"}
        {fontCoverage.status === "error" && <>
          <strong>无法确认字体覆盖</strong>
          <span>{fontCoverage.message}</span>
          <span>客户端仍会使用自定义字体后的系统字体栈回退缺失字形。</span>
        </>}
        {(fontCoverage.status === "complete" || fontCoverage.status === "incomplete") && <>
          <strong>{fontCoverage.status === "complete" ? "项目字符覆盖完整" : "项目字符存在缺字"}</strong>
          <span>
            覆盖 {fontCoverage.result.coveredCharacters}/{fontCoverage.result.totalCharacters} 个不重复字符。
            {fontCoverage.result.missingCharacters > 0
              ? ` 缺少 ${fontCoverage.result.missingCharacters} 个：${fontCoverage.result.missingSamples
                .map(({ character }) => character).join(" ")}${fontCoverage.result.missingCharacters > fontCoverage.result.missingSamples.length ? " …" : ""}`
              : ""}
          </span>
          {fontCoverage.result.missingCharacters > 0 && (
            <span>Runtime 会为缺失字形继续回退到系统字体。预览中可检查实际字形效果。</span>
          )}
        </>}
      </div>
      <details><summary>共享导航排列</summary>
        <p>按结构调整位置与间距；此处不提供任意拖拽。</p>
        {navigationProperties.map(([key, label]) => field("shared", key, `共享导航${label}`))}
      </details>
      {page !== "title" && <details className="renpy-menu-frame-fields" data-testid="renpy-menu-frame-shared">
        <summary>共享菜单框架</summary>
        <p>{design.width}×{design.height} 逻辑画面；标题、内容和返回统一缩放，页面可单独覆盖。</p>
        {RENPY_MENU_FRAME_PROPERTIES.map(([key, label]) => field("shared", key, `共享菜单${label}`))}
      </details>}
      <details className="renpy-shared-save-grid">
      <summary>共享存档网格</summary>
      {saveGridProperties.map(([key]) => field("shared", key,
        key === "saveColumns" ? "共享存档网格列数" : "共享存档网格间距"))}
      </details>
      <RenpySettingHelp label="布局编辑帮助">
        <p>选择预览中的控件，在右栏编辑。保存布局后写入当前工程。</p>
        <p>模板 {RENPY_TEMPLATE_VERSION} · 当前画面 {design.aspectRatio}，适配视觉与资源，不执行模板脚本。</p>
        <p>字体覆盖检查在本机进行；系统字体随设备变化，无法在此完整预检。</p>
      </RenpySettingHelp>
    </aside>
    <div className="runtime-layout-center">
      <div className="renpy-editor-preview-toolbar">
        <div role="group" aria-label={`${pageLabel}预览模式`}>
          <button type="button" data-testid="renpy-title-static-preview-toggle"
            aria-pressed={!titleRuntimePreview} onClick={() => setTitleRuntimePreview(false)}>
            布局编辑
          </button>
          <button type="button" data-testid="renpy-title-runtime-preview-toggle"
            aria-pressed={titleRuntimePreview} onClick={() => setTitleRuntimePreview(true)}>
            实际 Runtime
          </button>
        </div>
        <button type="button" aria-pressed={previewMode === "desktop"} onClick={() => onPreviewMode("desktop")}>桌面预览</button>
        <button type="button" aria-pressed={previewMode === "mobile"} onClick={() => onPreviewMode("mobile")}>移动预览</button>
        <output>{previewSize.width} × {previewSize.height} · {design.aspectRatio}</output>
      </div>
      {page === "title" && !titleRuntimePreview ? <><RenpyPreviewStage className="renpy-editor-preview"
        width={previewSize.width} height={previewSize.height}>
        <div className="renpy-editor-title-game-frame" data-game-aspect-ratio={design.aspectRatio}
          style={{ position: "absolute", left: previewFrame.x, top: previewFrame.y,
            width: previewFrame.width, height: previewFrame.height }}>
        <RenpyTitleView skin={previewDraft} title={title} version="布局预览"
          onSelectControl={setSelectedRegionId}
          contentOpacity={titleHero?.style?.contentOpacity}
          logicalViewport={previewFrame}
          backgroundFit={backgroundFit} backgroundDimming={backgroundUrl ? backgroundDimming : 0}
          fontFamily={fontFamilyForAsset(draft.tokens.fontAssetId)}
          buttonAssetUrls={buttonAssetUrls}
          background={<>
            {backgroundUrl && <img src={backgroundUrl} alt="" />}
            {(titleHeroImage || (titleHasOpacityLayers && titleHero?.style?.backgroundColor)) && <div data-testid="renpy-imported-title-background" aria-hidden="true"
              style={{ position: "absolute", inset: 0,
                opacity: titleBackgroundOpacity,
                backgroundColor: titleHasOpacityLayers ? titleHero?.style?.backgroundColor : undefined,
                backgroundImage: titleHeroImage ? `url("${titleHeroImage}")` : undefined,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: titleHero?.style?.backgroundFit === "stretch" ? "100% 100%" : titleHero?.style?.backgroundFit ?? "cover",
                pointerEvents: "none" }} />}
          </>}
          actions={["开始游戏", "存档", "选项", "关于", "帮助", "退出"].map((label, index) => ({
            id: `renpy-preview-${index}`, componentId: ["title_start_button", "title_save_load_button", "title_settings_button", "title_about_button",
              "title_help_button", "title_exit_button"][index],
            label, onClick: () => setStatus(`预览：${label}（不改变游戏进度）`),
          }))} />
        </div>
      </RenpyPreviewStage>
      <p role="status" className="renpy-preview-status">
        {fontLoadError ? `导入字体无法加载：${fontLoadError}` : status || "使用与实际游戏相同的标题渲染组件"}
      </p></>
        : <RenpyRuntimePreview draft={previewDraft} page={page} mobile={previewMode === "mobile"} onPage={onPage}
            onSelectControl={titleRuntimePreview ? undefined : setSelectedRegionId} fitToStage />}
    </div>
    <aside className="runtime-layout-inspector renpy-editor-fields">
      <h4>{pageLabel} · 当前控件</h4>
      <section className="renpy-property renpy-region-editor" data-testid="renpy-page-region-editor"
        aria-label="页面区域结构">
        <h4>{pageLabel} · 页面区域</h4>
        {regionComponents.length > 0 ? <>
          <div className="renpy-region-list" role="group" aria-label={`${pageLabel}页面区域`}>
            {regionComponents.map((component) => (
              <button key={component.component_id} type="button"
                aria-pressed={component.component_id === selectedRegion?.component_id}
                data-component-id={component.component_id}
                onClick={() => setSelectedRegionId(component.component_id)}>
                {component.component_type === "speaker_label" ? speakerContainerDisplayLabel(component)
                  : component.label || regionLabels[component.component_type] || component.component_id}
              </button>
            ))}
          </div>
          {page === "title" && selectedRegion?.component_type === "main_menu_hero" &&
            <RenpyTitleTextEditor draft={draft} disabled={selectedRegion.locked} onChange={onChange} />}
          {page === "title" && selectedRegion && (isBuiltinTitleButton(selectedRegion)
            || ["menu_button", "main_menu_exit_button", "main_menu_custom_button"].includes(selectedRegion.component_type)) &&
            <section className="renpy-property" aria-label="菜单文字">
              <label>菜单按钮文字
                <input type="text" aria-label="菜单按钮文字" maxLength={160}
                  disabled={selectedRegion.locked} value={selectedRegion.label ?? ""}
                  onChange={event => {
                    const next = structuredClone(draft);
                    const control = next.screens.find(screen => screen.screen_id === "title")?.components
                      .find(component => component.component_id === selectedRegion.component_id);
                    if (!control || control.locked) return;
                    control.label = event.currentTarget.value;
                    onChange(next);
                  }} />
              </label>
              <small className="renpy-field-hint">留空使用默认文案，按钮操作保持不变。</small>
            </section>}
          {selectedRegion?.rect && <details className="renpy-region-geometry">
            <summary>位置与尺寸</summary><div className="renpy-region-fields">
            {([
              ["x", "区域 X"],
              ["y", "区域 Y"],
              ["width", "区域宽度"],
              ["height", "区域高度"],
            ] as const).map(([fieldName, label]) => (
              <label key={fieldName}>{label}
                <input type="number" min={fieldName === "x" || fieldName === "y" ? 0 : 2}
                  max={100} step={0.5} disabled={selectedRegion.locked}
                  aria-label={label} value={selectedRegion.rect![fieldName]}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(value)) updateRegionRect(fieldName, value);
                  }} />
              </label>
            ))}
          </div><small>位置与尺寸按页面百分比保存；导航、网格的排列优先使用结构设置。</small></details>}
          {selectedRegion && <RenpyControlAppearanceEditor key={`${page}:${selectedRegion.component_id}`}
            component={isBuiltinTitleButton(selectedRegion) && selectedRegion.titleButtonStyleSource !== "layout"
              ? { ...selectedRegion, style: undefined } : selectedRegion}
            assets={assets} advancedEnabled={draft.advancedPresentationEnabled}
            onStyle={patchRegionStyle} onStateStyle={patchRegionStateStyle}
            onImport={(asset, patch) => patchRegionStyle(patch, asset)} />}
          {selectedRegion && draft.advancedPresentationEnabled && <ControlPresentationEditor
            component={selectedRegion} onChange={updatePresentation} />}
          {selectedRegion && selectedRegionUsesButtonRole && <output className="renpy-region-style-source"
            data-testid="renpy-region-style-managed-by-role">未覆盖项继承共享按钮角色</output>}
          {selectedRegion && !selectedRegionUsesButtonRole && <section className="renpy-region-style" data-testid="renpy-page-style-editor"
            aria-label="页面区域样式">
            <h4>{selectedRegion.label || regionLabels[selectedRegion.component_type] || selectedRegion.component_id} · 样式</h4>
            {regionStyleProperties.filter(property =>
              ["backgroundOpacity", "contentOpacity", "backdropBlur"].includes(property.key)).map((property) => {
              if ((property.key === "backgroundOpacity" || property.key === "contentOpacity")
                && !supportsUILayoutOpacityLayers(selectedRegion.component_type)) return null;
              const value = selectedRegion.style?.[property.key];
              const inheritedValue = property.key === "backgroundColor"
                ? draft.tokens.colorSurface ?? property.fallback
                : property.key === "color"
                  ? draft.tokens.colorInk ?? property.fallback
                  : property.key === "borderColor"
                    ? draft.tokens.colorLine ?? property.fallback
                    : property.key === "backgroundOpacity" && selectedRegion.style?.backgroundColor
                      ? resolveUILayoutBackgroundOpacity(selectedRegion.component_type, selectedRegion.style)
                    : property.key === "contentOpacity" && selectedRegion.component_type !== "main_menu_hero"
                      ? selectedRegion.style?.opacity ?? 1
                    : property.fallback;
              const inputValue = value ?? inheritedValue;
              return <div className="renpy-region-style-property" key={property.key}
                data-testid={`renpy-page-style-property-${property.key}`}>
                <label>{property.label}
                  <input
                    type={property.kind}
                    aria-label={property.label}
                    disabled={selectedRegion.locked}
                    min={property.kind === "number" ? property.min : undefined}
                    max={property.kind === "number" ? property.max : undefined}
                    step={property.kind === "number"
                      ? ("step" in property ? property.step : 1)
                      : undefined}
                    value={inputValue}
                    onChange={(event) => {
                      if (property.kind === "color") updateRegionStyle(property.key, event.currentTarget.value);
                      else {
                        const number = event.currentTarget.valueAsNumber;
                        if (Number.isFinite(number)) updateRegionStyle(property.key, number);
                      }
                    }}
                  />
                </label>
                <output data-testid={`renpy-page-style-${property.key}-source`}>
                  {value === undefined ? "主题继承" : "覆盖"}
                </output>
                {value !== undefined && <button type="button" disabled={selectedRegion.locked}
                  onClick={() => updateRegionStyle(property.key)}>
                  恢复主题继承
                </button>}
              </div>;
            })}
          </section>}
        </> : <p>当前页面没有可编辑的内建区域。</p>}
      </section>
      <details className="renpy-page-navigation-fields"><summary>本页导航与继承</summary>
      {navigationProperties.map(([key, label]) => {
        const overridden = draft.renpy?.[page]?.[key] !== undefined;
        return <div key={key} className="renpy-property">
          <div>{label}来源：<output data-testid={key === "fontSize" ? "renpy-font-source" : `renpy-${key}-source`}>
            {overridden ? "覆盖" : "继承"}</output></div>
          {overridden ? <>
            {field(page, key, `${pageLabel}导航${label}`)}
            <button type="button" onClick={() => update(page, key)}>{key === "fontSize" ? "恢复继承" : `恢复${label}继承`}</button>
          </> : <button type="button" onClick={() => update(page, key,
            draft.renpy?.shared?.[key] ?? RENPY_GUI_DEFAULTS[key])}>覆盖{pageLabel}{label}</button>}
        </div>;
      })}</details>
      {page !== "title" && <details className="renpy-menu-frame-fields" data-testid="renpy-menu-frame-page">
        <summary>{pageLabel} · 菜单框架</summary>
        {RENPY_MENU_FRAME_PROPERTIES.map(([key, label]) => {
          const overridden = draft.renpy?.[page]?.[key] !== undefined;
          return <div key={key} className="renpy-property">
            <div>{label}来源：<output data-testid={`renpy-frame-${key}-source`}>
              {overridden ? "覆盖" : "继承"}</output></div>
            {overridden ? <>
              {field(page, key, `${pageLabel}菜单${label}`)}
              <button type="button" onClick={() => update(page, key)}>{`恢复${label}继承`}</button>
            </> : <>
              <output aria-label={`${label}继承值`}>{draft.renpy?.shared?.[key] ?? RENPY_GUI_DEFAULTS[key]}</output>
              <button type="button" onClick={() => update(page, key,
                draft.renpy?.shared?.[key] ?? RENPY_GUI_DEFAULTS[key])}>{`覆盖${pageLabel}${label}`}</button>
            </>}
          </div>;
        })}
      </details>}
      {page === "save_load" && <section className="renpy-property" aria-label="存档网格结构">
        <h4>存档网格结构</h4>
        <p>只调整存档卡片排列；列数和间距在运行页同步预览。</p>
        {saveGridProperties.map(([key, label]) => {
          const overridden = draft.renpy?.[page]?.[key] !== undefined;
          const sourceId = key === "saveColumns" ? "renpy-save-grid-columns-source" : "renpy-save-grid-gap-source";
          const overrideName = key === "saveColumns" ? "覆盖存档列数" : "覆盖存档间距";
          const inputName = key === "saveColumns" ? "存档网格列数" : "存档网格间距";
          const restoreName = key === "saveColumns" ? "恢复存档列数继承" : "恢复存档间距继承";
          return <div key={key} className="renpy-property">
            <div>{label}来源：<output data-testid={sourceId}>{overridden ? "覆盖" : "继承"}</output></div>
            {!overridden && <output aria-label={`${label}继承值`}>{inheritedGrid[key]}</output>}
            {overridden ? <>
              {field(page, key, inputName)}
              <button type="button" onClick={() => update(page, key)}>{restoreName}</button>
            </> : <button type="button" onClick={() => update(page, key,
              inheritedGrid[key])}>{overrideName}</button>}
          </div>;
        })}
      </section>}
      <details><summary>按钮角色与状态 · 批量样式</summary>
        <RenpyButtonRoleEditor draft={draft} page={page} onChange={onChange} />
      </details>
      <button type="button" onClick={() => setResetPending(true)}>重置当前页布局</button>
      {page === "help" && helpPanel && <section className="renpy-property">
        <h4>帮助内容样式</h4>
        {(["color", "backgroundColor"] as const).map((key) => {
          const label = key === "color" ? "文字颜色" : "面板颜色";
          const value = helpPanel.style?.[key];
          return <div key={key}>
            <div>{label}来源：<output data-testid={`renpy-help-${key}-source`}>{value ? "覆盖" : "主题继承"}</output></div>
            <label>{label}<input aria-label={`帮助${label}`} type="color"
              value={typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : key === "color" ? "#ffffff" : "#111111"}
              onChange={(event) => updateHelpPanelStyle(key, event.currentTarget.value)} /></label>
            {value && <button type="button" onClick={() => updateHelpPanelStyle(key)}>恢复主题继承</button>}
          </div>;
        })}
      </section>}
      {resetPending && <div role="group" aria-label={`确认重置${pageLabel}`}>
        <p>恢复{pageLabel}内建区域的位置与尺寸，并清除此页的导航{page !== "title" ? "、菜单框架与按钮角色" : "与按钮角色"}{page === "help" ? "及内容颜色" : page === "save_load" ? "及网格结构" : ""}覆盖；保留自定义组件、共享样式、素材、其他页面与另一布局。</p>
        <button type="button" onClick={() => {
          const next = structuredClone(draft);
          if (next.renpy) delete next.renpy[page];
          if (page === "help") {
            const panel = next.screens.find((screen) => screen.screen_id === "help")?.components
              .find((component) => component.component_type === "help_panel");
            if (panel?.style) {
              delete panel.style.color;
              delete panel.style.backgroundColor;
            }
          }
          onChange(restoreRuntimeLayoutPage(next, page)); setResetPending(false);
        }}>确认重置</button>
        <button type="button" onClick={() => setResetPending(false)}>取消</button>
      </div>}
    </aside>
  </div>;
}

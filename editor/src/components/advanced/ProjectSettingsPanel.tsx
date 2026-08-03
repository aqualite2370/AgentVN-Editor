import { useMemo, useRef, useState } from "react";
import { CircleHelp, Image, Type, X, ZoomIn } from "lucide-react";
import {
  getDefaultUISkinLayout,
  type UILayoutComponentStyle,
  type UISkinLayout,
} from "../../../../shared/cartridge/uiSkin";
import { useProjectStore } from "../../store/projectStore";
import { useEditorPreferencesStore } from "../../store/editorPreferencesStore";
import type { AssetRef } from "../../types/assets";
import type { EditorCanvasBackgroundImage } from "../../types/project";
import { RangeControl } from "../common/RangeControl";
import { RichSelect } from "../common/RichSelect";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { RuntimeVisualAssetsPanel } from "./RuntimeVisualAssetsPanel";
import { requestAdvancedTools } from "./advancedToolsBridge";

const editorCanvasBackgroundMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const maxEditorCanvasBackgroundEdge = 2560;
const maxEditorCanvasBackgroundOriginalBytes = 4 * 1024 * 1024;

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("无法读取图片文件。"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图片文件。"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解析这张图片，请换用 PNG、JPG、WebP 或 SVG。"));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法压缩背景图。"));
    }, mimeType, quality);
  });
}

async function fileToEditorCanvasBackgroundImage(file: File): Promise<EditorCanvasBackgroundImage> {
  const mimeType = file.type.toLowerCase();
  if (!editorCanvasBackgroundMimeTypes.has(mimeType)) {
    throw new Error("仅支持 PNG、JPG、WebP 或 SVG 图片。");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  if (mimeType === "image/svg+xml") {
    return {
      dataUrl: originalDataUrl,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      updatedAt: new Date().toISOString(),
    };
  }

  const image = await loadImage(originalDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const needsResize = Math.max(sourceWidth, sourceHeight) > maxEditorCanvasBackgroundEdge;
  const canKeepOriginal = !needsResize && file.size <= maxEditorCanvasBackgroundOriginalBytes;
  if (canKeepOriginal) {
    return {
      dataUrl: originalDataUrl,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      width: sourceWidth,
      height: sourceHeight,
      updatedAt: new Date().toISOString(),
    };
  }

  const scale = needsResize ? maxEditorCanvasBackgroundEdge / Math.max(sourceWidth, sourceHeight) : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建图片压缩画布。");
  context.drawImage(image, 0, 0, width, height);
  const outputMimeType = "image/webp";
  const compressedBlob = await canvasToBlob(canvas, outputMimeType, 0.86).catch(() => {
    // error-log-ignore: 浏览器不支持首选图片格式时按设计改用 JPEG。
    return canvasToBlob(canvas, "image/jpeg", 0.86);
  });
  return {
    dataUrl: await readFileAsDataUrl(compressedBlob),
    fileName: file.name,
    mimeType: compressedBlob.type || outputMimeType,
    sizeBytes: compressedBlob.size,
    width,
    height,
    updatedAt: new Date().toISOString(),
  };
}

function fontFaceName(assetId: string): string {
  return `AgentVNEditorFont_${assetId.replace(/[^a-z0-9_-]/gi, "_")}`;
}

function fontPreviewSource(asset?: AssetRef): string | undefined {
  const source = asset?.metadata.data_url ?? asset?.metadata.blob_url ?? asset?.metadata.url;
  return source?.startsWith("data:") || source?.startsWith("blob:") ? source : undefined;
}

const titleHeroFontWeightOptions = [
  { value: "", label: "默认" },
  { value: "300", label: "细体 300" },
  { value: "400", label: "常规 400" },
  { value: "500", label: "中等 500" },
  { value: "600", label: "半粗体 600" },
  { value: "700", label: "粗体 700" },
  { value: "760", label: "展示体 760" },
  { value: "900", label: "特粗体 900" },
];

const titleHeroFontStyleOptions: Array<{ value: "" | NonNullable<UILayoutComponentStyle["fontStyle"]>; label: string }> = [
  { value: "", label: "默认" },
  { value: "normal", label: "常规" },
  { value: "italic", label: "斜体" },
];

const titleHeroTextAlignOptions: Array<{ value: "" | NonNullable<UILayoutComponentStyle["textAlign"]>; label: string }> = [
  { value: "", label: "默认" },
  { value: "left", label: "左对齐" },
  { value: "center", label: "居中" },
  { value: "right", label: "右对齐" },
];

const defaultAboutFields = [
  { label: "作者", value: "" },
  { label: "卡带版本", value: "" },
  { label: "运行模式", value: "" },
  { label: "容器版本", value: "" },
  { label: "卡带 ID", value: "" },
];

function cleanStyle(style: Partial<UILayoutComponentStyle>): UILayoutComponentStyle {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined && value !== "")) as UILayoutComponentStyle;
}

function getTitleHeroStyle(skin?: UISkinLayout): UILayoutComponentStyle {
  return skin?.screens
    .find((screen) => screen.screen_id === "title")
    ?.components.find((component) => component.component_type === "main_menu_hero")
    ?.style ?? {};
}

function updateTitleHeroStyleInSkin(skin: UISkinLayout | undefined, patch: Partial<UILayoutComponentStyle>): UISkinLayout {
  const base = skin ?? getDefaultUISkinLayout();
  return {
    ...base,
    screens: base.screens.map((screen) => screen.screen_id !== "title" ? screen : {
      ...screen,
      components: screen.components.map((component) => component.component_type !== "main_menu_hero" ? component : {
        ...component,
        style: cleanStyle({ ...(component.style ?? {}), ...patch }),
      }),
    }),
  };
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function ProjectSettingsPanel() {
  const [editorBackgroundError, setEditorBackgroundError] = useState<string | undefined>();
  const editorBackgroundInputRef = useRef<HTMLInputElement>(null);
  const title = useProjectStore((state) => state.title);
  const author = useProjectStore((state) => state.author);
  const settings = useProjectStore((state) => state.settings);
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const setMetadata = useProjectStore((state) => state.setMetadata);
  const setPackageAppearance = useProjectStore((state) => state.setPackageAppearance);
  const setEditorAppearance = useProjectStore((state) => state.setEditorAppearance);
  const setRuntimeUILayout = useProjectStore((state) => state.setRuntimeUILayout);
  const setSpeakerFocus = useProjectStore((state) => state.setSpeakerFocus);
  const hoverHelpEnabled = useEditorPreferencesStore((state) => state.hoverHelpEnabled);
  const setHoverHelpEnabled = useEditorPreferencesStore((state) => state.setHoverHelpEnabled);
  const packageAppearance = settings.packageAppearance ?? {};
  const aboutFields = packageAppearance.about?.fields ?? defaultAboutFields;
  const editorAppearance = settings.editorAppearance ?? {};
  const runtimeUILayout = settings.runtimeUILayout;
  const speakerFocus = settings.speakerFocus;
  const fontAssets = useMemo(() => assetManifest.filter((asset) => asset.asset_type === "font"), [assetManifest]);
  const defaultFontAssetId = runtimeUILayout?.tokens?.fontAssetId ?? "";
  const selectedFontAsset = fontAssets.find((asset) => asset.asset_id === defaultFontAssetId);
  const selectedFontSource = fontPreviewSource(selectedFontAsset);
  const selectedFontFamily = selectedFontAsset ? `"${fontFaceName(selectedFontAsset.asset_id)}", Inter, "Segoe UI", system-ui, sans-serif` : undefined;
  const titleHeroStyle = getTitleHeroStyle(runtimeUILayout);
  const titleHeroFontAssetId = titleHeroStyle.fontAssetId ?? "";
  const titleHeroFontAsset = fontAssets.find((asset) => asset.asset_id === titleHeroFontAssetId);
  const titleHeroFontSource = fontPreviewSource(titleHeroFontAsset);
  const titleHeroFontFamily = titleHeroFontAsset ? `"${fontFaceName(titleHeroFontAsset.asset_id)}", Inter, "Segoe UI", system-ui, sans-serif` : undefined;

  function updatePackageAppearance(partial: Partial<typeof packageAppearance>) {
    setPackageAppearance({ ...packageAppearance, ...partial });
  }

  function updateAboutCopy(partial: NonNullable<typeof packageAppearance.about>) {
    updatePackageAppearance({ about: { ...(packageAppearance.about ?? {}), ...partial } });
  }

  function updateAboutField(index: number, field: { label?: string; value?: string }) {
    const fields = [...aboutFields];
    fields[index] = { ...fields[index], ...field };
    updateAboutCopy({ fields });
  }

  function addAboutField() {
    updateAboutCopy({ fields: [...aboutFields, { label: "", value: "" }] });
  }

  function removeAboutField(index: number) {
    updateAboutCopy({ fields: aboutFields.filter((_, fieldIndex) => fieldIndex !== index) });
  }

  function updateEditorAppearance(partial: Partial<typeof editorAppearance>) {
    setEditorAppearance({ ...editorAppearance, ...partial });
  }

  async function handleEditorCanvasBackgroundFile(file: File | undefined) {
    if (!file) return;
    setEditorBackgroundError(undefined);
    try {
      const canvasBackgroundImage = await fileToEditorCanvasBackgroundImage(file);
      updateEditorAppearance({ canvasBackgroundImage });
    } catch (error) {
      reportFrontendError("editor.project-settings", error, { operation: "set-canvas-background", fileName: file.name });
      setEditorBackgroundError(error instanceof Error ? error.message : "无法设置画布背景图。");
    } finally {
      if (editorBackgroundInputRef.current) editorBackgroundInputRef.current.value = "";
    }
  }

  function updateDefaultRuntimeFont(fontAssetId: string) {
    const base = runtimeUILayout ?? getDefaultUISkinLayout();
    const tokens = { ...(base.tokens ?? {}) };
    if (fontAssetId) tokens.fontAssetId = fontAssetId;
    else delete tokens.fontAssetId;
    setRuntimeUILayout({ ...base, tokens });
  }

  function updateTitleHeroStyle(patch: Partial<UILayoutComponentStyle>) {
    setRuntimeUILayout(updateTitleHeroStyleInSkin(runtimeUILayout, patch));
  }

  return (
    <section className="advanced-card project-settings-panel">
      <h3>项目设置</h3>
      <p>项目元数据用于识别工程；玩家端字体、首页、设置页图片会写入导出的卡带和独立包。</p>

      <div className="form-grid">
        <label>
          项目名称
          <input
            value={title}
            data-help-key="settings.projectTitle"
            aria-label="项目名称"
            onChange={(event) => setMetadata({ title: event.target.value })}
          />
        </label>
        <label>
          作者
          <input
            value={author}
            data-help-key="settings.author"
            aria-label="项目作者"
            onChange={(event) => setMetadata({ author: event.target.value })}
          />
        </label>
      </div>

      <section className="package-appearance-setting editor-hover-help-setting">
        <header>
          <div>
            <strong><CircleHelp size={16} /> 鼠标悬停提示</strong>
            <p>控制鼠标停在按钮和控件上时显示的说明小浮窗。部分工作区原本已禁用提示，开启此选项也不会改变这些局部规则。</p>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={hoverHelpEnabled}
              aria-label="启用鼠标悬停提示"
              data-tooltip="开启后，鼠标停在支持说明的按钮和控件上会显示提示小浮窗；关闭后不再显示。"
              onChange={(event) => setHoverHelpEnabled(event.target.checked)}
            />
            启用
          </label>
        </header>
      </section>

      <section className="editor-appearance-setting package-appearance-setting">
        <header>
          <div>
            <strong><Image size={16} /> 编辑器画布背景</strong>
            <p>只影响作者编辑项目时的画布工作区，会随 .vnproj 保存；导出的 .vncart 和玩家端 GameCLI 背景不会读取这里。</p>
          </div>
          <button type="button" data-help-key="settings.editorAppearance.clear" onClick={() => {
            setEditorAppearance({});
            setEditorBackgroundError(undefined);
          }}>
            <X size={16} />
            清空
          </button>
        </header>
        <div className="editor-canvas-background-controls">
          <div className="editor-canvas-background-picker" data-help-key="settings.editorAppearance.canvasBackground">
            <input
              ref={editorBackgroundInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              aria-label="选择编辑器画布背景图"
              onChange={(event) => void handleEditorCanvasBackgroundFile(event.target.files?.[0])}
            />
            <button type="button" data-help-key="settings.editorAppearance.canvasBackground.pick" onClick={() => editorBackgroundInputRef.current?.click()}>
              <Image size={16} />
              {editorAppearance.canvasBackgroundImage ? "更换图片" : "选择图片"}
            </button>
            {editorAppearance.canvasBackgroundImage ? (
              <div className="editor-canvas-background-preview">
                <img src={editorAppearance.canvasBackgroundImage.dataUrl ?? editorAppearance.canvasBackgroundImage.url} alt="" />
                <div>
                  <strong>{editorAppearance.canvasBackgroundImage.fileName}</strong>
                  <span>
                    {editorAppearance.canvasBackgroundImage.width && editorAppearance.canvasBackgroundImage.height
                      ? `${editorAppearance.canvasBackgroundImage.width}×${editorAppearance.canvasBackgroundImage.height} · `
                      : ""}
                    {Math.max(1, Math.round(editorAppearance.canvasBackgroundImage.sizeBytes / 1024))} KB
                  </span>
                </div>
              </div>
            ) : (
              <p>单独选择一张作者端画布背景图，不会加入素材库或导出到玩家端。</p>
            )}
            {editorBackgroundError && <p className="inline-status warning">{editorBackgroundError}</p>}
          </div>
          <label>
            填充方式
            <RichSelect
              value={editorAppearance.canvasBackgroundFit ?? "cover"}
              options={[
                { value: "cover", label: "铺满裁切" },
                { value: "contain", label: "完整显示" },
                { value: "tile", label: "平铺纹理" },
              ]}
              helpKey="settings.editorAppearance.canvasBackgroundFit"
              onChange={(canvasBackgroundFit) => updateEditorAppearance({ canvasBackgroundFit })}
            />
          </label>
          <label className="editor-canvas-opacity-row">
            背景透明度
            <RangeControl
              min={0}
              max={0.72}
              step={0.01}
              value={editorAppearance.canvasBackgroundOpacity ?? 0.38}
              ariaLabel="编辑器画布背景透明度"
              helpKey="settings.editorAppearance.canvasBackgroundOpacity"
              onChange={(value) => updateEditorAppearance({ canvasBackgroundOpacity: value })}
            />
            <output>{Math.round((editorAppearance.canvasBackgroundOpacity ?? 0.38) * 100)}%</output>
          </label>
        </div>
      </section>

      <section className="runtime-font-setting package-appearance-setting">
        <header>
          <div>
            <strong><Type size={16} /> 玩家端默认字体</strong>
            <p>导入字体后可以设为玩家端全局字体，GameCli 菜单、按钮和默认对白/旁白都会继承；单条对白仍可在场景事件里覆写。</p>
          </div>
          <button
            type="button"
            data-help-key="settings.importFont"
            onClick={() =>
              requestAdvancedTools({
                tab: "library",
                title: "导入字体",
                message: "在素材库点击“导入字体”上传 .ttf、.otf、.woff 或 .woff2 后，回到项目设置选择默认字体。",
              })
            }
          >
            <Type size={16} />
            去素材库
          </button>
        </header>
        <div className="runtime-font-grid">
          <label>
            默认字体
            <RichSelect
              value={defaultFontAssetId}
              options={[
                { value: "", label: "系统默认字体" },
                ...fontAssets.map((asset) => ({
                  value: asset.asset_id,
                  label: asset.metadata.display_name ?? asset.metadata.filename ?? asset.asset_id,
                })),
              ]}
              helpKey="settings.runtimeFont"
              onChange={updateDefaultRuntimeFont}
            />
          </label>
          <div className="runtime-font-preview" style={selectedFontFamily ? { fontFamily: selectedFontFamily } : undefined}>
            {selectedFontSource && selectedFontAsset && (
              <style>{`@font-face{font-family:"${fontFaceName(selectedFontAsset.asset_id)}";src:url("${selectedFontSource}");font-display:swap;}`}</style>
            )}
            <strong>AgentVN 字体预览</strong>
            <span>视觉小说对白 Aa 123</span>
          </div>
        </div>
        {fontAssets.length === 0 && <p className="inline-status">素材库里还没有字体。先导入字体文件，再选择全局默认字体。</p>}
      </section>

      <section className="runtime-title-style-setting package-appearance-setting">
        <header>
          <div>
            <strong><Type size={16} /> 主页面标题区文字</strong>
            <p>控制 GameCLI 主菜单左上标题区的字体、颜色、字号、字重、斜体和对齐方式；保存后会写入客户端布局并随卡带导出。</p>
          </div>
          <button
            type="button"
            data-help-key="settings.titleHero.reset"
            onClick={() => updateTitleHeroStyle({
              fontAssetId: undefined,
              color: undefined,
              fontSize: undefined,
              fontWeight: undefined,
              fontStyle: undefined,
              textAlign: undefined,
            })}
          >
            <X size={16} />
            重置
          </button>
        </header>
        <div className="runtime-visual-grid">
          <label>
            标题区字体
            <RichSelect
              value={titleHeroFontAssetId}
              options={[
                { value: "", label: "跟随全局字体" },
                ...fontAssets.map((asset) => ({
                  value: asset.asset_id,
                  label: asset.metadata.display_name ?? asset.metadata.filename ?? asset.asset_id,
                })),
              ]}
              helpKey="settings.titleHeroFont"
              onChange={(fontAssetId) => updateTitleHeroStyle({ fontAssetId: fontAssetId || undefined })}
            />
          </label>
          <label>
            文字颜色
            <div className="runtime-layout-color-row">
              <input
                type="color"
                data-help-key="settings.titleHero.colorPicker"
                aria-label="主菜单标题文字颜色选择器"
                value={isHexColor(titleHeroStyle.color) ? titleHeroStyle.color : "#f6f8ff"}
                onChange={(event) => updateTitleHeroStyle({ color: event.target.value })}
              />
              <input
                data-help-key="settings.titleHero.colorValue"
                aria-label="主菜单标题文字颜色值"
                value={titleHeroStyle.color ?? ""}
                placeholder="#f6f8ff"
                onChange={(event) => updateTitleHeroStyle({ color: event.target.value || undefined })}
              />
            </div>
          </label>
          <label className="editor-canvas-opacity-row">
            字号
            <RangeControl
              min={10}
              max={40}
              step={1}
              value={titleHeroStyle.fontSize ?? 22}
              ariaLabel="主菜单标题字号"
              helpKey="settings.titleHeroFontSize"
              onChange={(fontSize) => updateTitleHeroStyle({ fontSize })}
            />
            <output>{titleHeroStyle.fontSize ?? 22}px</output>
          </label>
          <label>
            字重
            <RichSelect
              value={titleHeroStyle.fontWeight ? String(titleHeroStyle.fontWeight) : ""}
              options={titleHeroFontWeightOptions}
              helpKey="settings.titleHeroFontWeight"
              onChange={(fontWeight) => updateTitleHeroStyle({ fontWeight: fontWeight ? Number(fontWeight) : undefined })}
            />
          </label>
          <label>
            样式
            <RichSelect
              value={titleHeroStyle.fontStyle ?? ""}
              options={titleHeroFontStyleOptions}
              helpKey="settings.titleHeroFontStyle"
              onChange={(fontStyle) => updateTitleHeroStyle({ fontStyle: fontStyle ? fontStyle as UILayoutComponentStyle["fontStyle"] : undefined })}
            />
          </label>
          <label>
            对齐
            <RichSelect
              value={titleHeroStyle.textAlign ?? ""}
              options={titleHeroTextAlignOptions}
              helpKey="settings.titleHeroTextAlign"
              onChange={(textAlign) => updateTitleHeroStyle({ textAlign: textAlign ? textAlign as UILayoutComponentStyle["textAlign"] : undefined })}
            />
          </label>
          <div className="runtime-font-preview" style={titleHeroFontFamily ? { fontFamily: titleHeroFontFamily } : undefined}>
            {titleHeroFontSource && titleHeroFontAsset && (
              <style>{`@font-face{font-family:"${fontFaceName(titleHeroFontAsset.asset_id)}";src:url("${titleHeroFontSource}");font-display:swap;}`}</style>
            )}
            <strong style={{
              color: titleHeroStyle.color,
              fontSize: titleHeroStyle.fontSize,
              fontWeight: titleHeroStyle.fontWeight,
              fontStyle: titleHeroStyle.fontStyle,
              textAlign: titleHeroStyle.textAlign,
            }}>{title || "GameCLI 玩家端"}</strong>
            <span>主菜单标题区 Aa 123</span>
          </div>
        </div>
      </section>

      <section className="package-appearance-setting speaker-focus-setting">
        <header>
          <div>
            <strong><ZoomIn size={16} /> 角色发言聚焦</strong>
            <p>角色发言时轻微放大其可见立绘；旁白和未显示立绘的角色不会触发聚焦。</p>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={speakerFocus.enabled}
              data-help-key="settings.speakerFocus.enabled"
              onChange={(event) => setSpeakerFocus({ ...speakerFocus, enabled: event.target.checked })}
            />
            启用
          </label>
        </header>
        <div className="form-grid">
          <label>
            聚焦倍率
            <RangeControl
              min={1}
              max={1.15}
              step={0.01}
              value={speakerFocus.scale}
              ariaLabel="角色发言聚焦倍率"
              helpKey="settings.speakerFocus.scale"
              onChange={(scale) => setSpeakerFocus({ ...speakerFocus, scale })}
            />
            <output>{speakerFocus.scale.toFixed(2)}×</output>
          </label>
          <label>
            过渡时间
            <RangeControl
              min={80}
              max={1000}
              step={20}
              value={speakerFocus.duration_ms}
              ariaLabel="角色发言聚焦过渡时间"
              helpKey="settings.speakerFocus.duration"
              onChange={(duration_ms) => setSpeakerFocus({ ...speakerFocus, duration_ms })}
            />
            <output>{speakerFocus.duration_ms} ms</output>
          </label>
        </div>
      </section>

      <RuntimeVisualAssetsPanel
        appearance={packageAppearance}
        onChange={updatePackageAppearance}
        onClear={() => setPackageAppearance(packageAppearance.about ? { about: packageAppearance.about } : {})}
        helpPrefix="settings.runtimeVisual"
      />

      <section className="package-appearance-setting runtime-about-copy-setting">
        <header>
          <div>
            <strong><Type size={16} /> 关于面板文案</strong>
            <p>这里填写的文字会写入 manifest.shell.about。未填写的项目会继续使用 GameCLI 默认模板。</p>
          </div>
          <button type="button" data-help-key="settings.about.clear" onClick={() => updatePackageAppearance({ about: undefined })}>
            <X size={16} />
            清空
          </button>
        </header>
        <div className="runtime-about-copy-grid">
          <label>
            面板标题
            <input value={packageAppearance.about?.title ?? ""} data-help-key="settings.about.title" onChange={(event) => updateAboutCopy({ title: event.target.value })} />
          </label>
          <label>
            顶部小标题
            <input value={packageAppearance.about?.kicker ?? ""} data-help-key="settings.about.kicker" onChange={(event) => updateAboutCopy({ kicker: event.target.value })} />
          </label>
          <label>
            主标题
            <input value={packageAppearance.about?.heading ?? ""} data-help-key="settings.about.heading" onChange={(event) => updateAboutCopy({ heading: event.target.value })} />
          </label>
          <label>
            简介
            <textarea value={packageAppearance.about?.description ?? ""} data-help-key="settings.about.description" onChange={(event) => updateAboutCopy({ description: event.target.value })} />
          </label>
          <label>
            底部说明
            <textarea value={packageAppearance.about?.note ?? ""} data-help-key="settings.about.note" onChange={(event) => updateAboutCopy({ note: event.target.value })} />
          </label>
        </div>
        <div className="runtime-about-field-editor">
          <header>
            <strong>字段列表</strong>
            <button type="button" data-help-key="settings.about.addField" onClick={addAboutField}>添加字段</button>
          </header>
          {aboutFields.length === 0 && <p className="runtime-about-fields-empty">暂无字段</p>}
          {aboutFields.map((field, index) => (
            <div key={index} className="runtime-about-field-row">
              <input aria-label={`关于字段 ${index + 1} 标签`} value={field.label ?? ""} placeholder="标签" data-help-key="settings.about.fieldLabel" onChange={(event) => updateAboutField(index, { label: event.target.value })} />
              <input aria-label={`关于字段 ${index + 1} 内容`} value={field.value ?? ""} placeholder="内容" data-help-key="settings.about.fieldValue" onChange={(event) => updateAboutField(index, { value: event.target.value })} />
              <button type="button" data-help-key="settings.about.removeField" onClick={() => removeAboutField(index)}>移除</button>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

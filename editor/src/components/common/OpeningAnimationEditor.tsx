import { useMemo, useState, type ChangeEvent } from "react";
import type { LoadingAnimationConfig } from "../../../../shared/cartridge/types";
import type { AssetRef, AssetType } from "../../types/assets";
import { AssetPicker } from "./AssetPicker";
import { buildProjectAssetPath, sanitizeAssetId } from "../../utils/projectAssets";
import { useProjectStore } from "../../store/projectStore";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { GlassSelectionGroup } from "./GlassSelectionGroup";
import { resolveOpeningPresentation } from "../../../../shared/cartridge/openingPresentation";
import { RichSelect } from "./RichSelect";

interface OpeningAnimationEditorProps {
  animation?: LoadingAnimationConfig;
  assets: AssetRef[];
  onChange: (animation: LoadingAnimationConfig) => void;
  helpKey: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("读取文件失败"));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function uniqueAssetId(base: string, usedIds: Set<string>): string {
  const normalized = sanitizeAssetId(base);
  if (!usedIds.has(normalized)) return normalized;
  let index = 2;
  while (usedIds.has(`${normalized}_${index}`)) index += 1;
  return `${normalized}_${index}`;
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
}

function importedAsset(file: File, dataUrl: string, assetType: Extract<AssetType, "ui" | "video">, assetId: string): AssetRef {
  return {
    asset_id: assetId,
    asset_type: assetType,
    metadata: {
      filename: file.name,
      mime_type: file.type || (assetType === "video" ? "video/mp4" : "image/png"),
      size_bytes: file.size,
      source: "imported",
      data_url: dataUrl,
      blob_url: dataUrl,
      project_path: buildProjectAssetPath(assetType, assetId, file.name),
      created_at: new Date().toISOString(),
      tags: ["loading_animation"],
    },
  };
}

export function OpeningAnimationEditor({ animation = { kind: "default" }, assets, onChange, helpKey }: OpeningAnimationEditorProps) {
  const setAssetManifest = useProjectStore((state) => state.setAssetManifest);
  const [selectedFrame, setSelectedFrame] = useState("");
  const [error, setError] = useState<string>();
  const videoAsset = animation.kind === "video" ? assets.find((asset) => asset.asset_id === animation.video_asset_id) : undefined;
  const imageAssets = useMemo(
    () => animation.kind === "image_sequence" ? animation.image_asset_ids.map((id) => assets.find((asset) => asset.asset_id === id)) : [],
    [animation, assets],
  );
  const imageSource = (asset?: AssetRef) => asset?.metadata.data_url ?? asset?.metadata.blob_url ?? asset?.metadata.url;
  const presentation = resolveOpeningPresentation(animation.presentation);
  const updatePresentation = (patch: Partial<typeof presentation>) => {
    if (animation.kind === "default") return;
    onChange({ ...animation, presentation: { ...presentation, ...patch } });
  };

  function setMode(kind: LoadingAnimationConfig["kind"]) {
    setError(undefined);
    if (kind === "default") onChange({ kind });
    else if (kind === "video") onChange({
      kind,
      video_asset_id: animation.kind === "video" ? animation.video_asset_id : "",
      ...(animation.presentation ? { presentation: animation.presentation } : {}),
    });
    else onChange({
      kind,
      image_asset_ids: animation.kind === "image_sequence" ? animation.image_asset_ids : [],
      frame_duration_ms: animation.kind === "image_sequence" ? animation.frame_duration_ms ?? 1000 : 1000,
      ...(animation.presentation ? { presentation: animation.presentation } : {}),
    });
  }

  async function importVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isVideoFile(file)) { setError("请选择视频文件作为开屏动画。"); return; }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const used = new Set(assets.map((asset) => asset.asset_id));
      const asset = importedAsset(file, dataUrl, "video", uniqueAssetId(`loading_video_${fileStem(file.name)}`, used));
      setAssetManifest([asset, ...assets.filter((item) => item.asset_id !== asset.asset_id)]);
      onChange({ kind: "video", video_asset_id: asset.asset_id,
        ...(animation.presentation ? { presentation: animation.presentation } : {}) });
    } catch (cause) {
      reportFrontendError("editor.loading-animation", cause, { operation: "import-video", fileName: file.name });
      setError(cause instanceof Error ? cause.message : "导入视频失败");
    }
  }

  async function importImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) { setError("请选择图片文件作为开屏动画帧。"); return; }
    try {
      const used = new Set(assets.map((asset) => asset.asset_id));
      const imported: AssetRef[] = [];
      for (const [index, file] of imageFiles.entries()) {
        const asset = importedAsset(file, await readFileAsDataUrl(file), "ui", uniqueAssetId(`loading_image_${index + 1}_${fileStem(file.name)}`, used));
        used.add(asset.asset_id);
        imported.push(asset);
      }
      const importedIds = new Set(imported.map((asset) => asset.asset_id));
      setAssetManifest([...imported, ...assets.filter((asset) => !importedIds.has(asset.asset_id))]);
      onChange({
        kind: "image_sequence",
        image_asset_ids: [...(animation.kind === "image_sequence" ? animation.image_asset_ids : []), ...imported.map((asset) => asset.asset_id)],
        frame_duration_ms: animation.kind === "image_sequence" ? animation.frame_duration_ms ?? 1000 : 1000,
        ...(animation.presentation ? { presentation: animation.presentation } : {}),
      });
    } catch (cause) {
      reportFrontendError("editor.loading-animation", cause, { operation: "import-images", fileCount: files.length });
      setError(cause instanceof Error ? cause.message : "导入图片失败");
    }
  }

  const imageIds = animation.kind === "image_sequence" ? animation.image_asset_ids : [];
  return (
    <section className="loading-animation-panel" data-help-key={helpKey}>
      <header><div><strong>用户开屏动画</strong><span>线条加载完成后播放一轮，再进入主菜单。</span></div></header>
      <GlassSelectionGroup className="loading-animation-mode" role="group" ariaLabel="开屏动画类型" selectedKey={animation.kind}>
        {(["default", "video", "image_sequence"] as const).map((kind) => (
          <button key={kind} type="button" className={animation.kind === kind ? "is-active" : ""} data-glass-selected={animation.kind === kind} aria-pressed={animation.kind === kind} data-help-key={`${helpKey}.${kind}`} onClick={() => setMode(kind)}>
            {kind === "default" ? "默认线条" : kind === "video" ? "视频" : "多图序列"}
          </button>
        ))}
      </GlassSelectionGroup>
      {animation.kind !== "default" && (
        <fieldset className="loading-animation-presentation">
          <legend>片头容器</legend>
          <label>容器<RichSelect ariaLabel="片头容器" value={presentation.mode}
            options={[{ value: "fullscreen", label: "全屏" }, { value: "centered", label: "居中尺寸" }]}
            onChange={mode => updatePresentation({ mode })} /></label>
          <label>画面适配<RichSelect ariaLabel="片头画面适配" value={presentation.fit}
            options={[{ value: "contain", label: "完整显示" }, { value: "cover", label: "裁切铺满" }, { value: "stretch", label: "拉伸" }]}
            onChange={fit => updatePresentation({ fit })} /></label>
          {presentation.mode === "centered" && <>
            <label>宽度（%）<input aria-label="片头容器宽度（百分比）" type="number" min={20} max={100} step={1}
              value={presentation.width_percent} onChange={event => updatePresentation({ width_percent: Math.min(100, Math.max(20, Number(event.target.value) || 20)) })} /></label>
            <label>高度（%）<input aria-label="片头容器高度（百分比）" type="number" min={20} max={100} step={1}
              value={presentation.height_percent} onChange={event => updatePresentation({ height_percent: Math.min(100, Math.max(20, Number(event.target.value) || 20)) })} /></label>
          </>}
        </fieldset>
      )}
      {animation.kind === "video" && (
        <div className="loading-animation-editor-row">
          <AssetPicker label="开屏视频素材" field="loading_animation.video_asset_id" value={animation.video_asset_id} allowedTypes={["video"]} helpKey={`${helpKey}.videoAsset`} onChange={(assetId) => onChange({ ...animation, video_asset_id: assetId })} />
          <label className="loading-animation-import" data-help-key={`${helpKey}.videoImport`}><input data-help-key="editor.control" type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.ogv" hidden onChange={(event) => void importVideo(event)} />导入视频</label>
          {!videoAsset && animation.video_asset_id && <p className="inline-status warning">视频素材缺失，请重新选择。</p>}
        </div>
      )}
      {animation.kind === "image_sequence" && (
        <div className="loading-animation-editor-row">
          <div className="opening-audio-picker-row">
            <AssetPicker label="添加图片帧" field="loading_animation.image_asset_id" value={selectedFrame} allowedTypes={["ui", "background", "portrait", "sprite"]} helpKey={`${helpKey}.imageAsset`} onChange={(assetId) => setSelectedFrame(assetId)} />
            <button data-help-key="editor.control" type="button" disabled={!selectedFrame} onClick={() => { onChange({ ...animation, image_asset_ids: [...imageIds, selectedFrame], frame_duration_ms: animation.frame_duration_ms ?? 1000 }); setSelectedFrame(""); }}>添加为帧</button>
          </div>
          <label className="loading-animation-import"><input data-help-key="editor.control" type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg" multiple hidden onChange={(event) => void importImages(event)} />导入图片</label>
          <label className="loading-animation-duration">切换时间（毫秒）<input data-help-key="editor.control" type="number" min={100} step={100} value={animation.frame_duration_ms ?? 1000} onChange={(event) => onChange({ ...animation, frame_duration_ms: Math.max(100, Math.round(Number(event.target.value) || 1000)) })} /></label>
          <div className="loading-animation-frame-list">
            {imageIds.length === 0 ? <p>尚未添加图片帧。</p> : imageIds.map((assetId, index) => {
              const asset = imageAssets[index];
              return <article key={`${assetId}_${index}`} className="loading-animation-frame">{imageSource(asset) ? <img src={imageSource(asset)} alt="" /> : <span>{index + 1}</span>}<div><strong>{asset?.metadata.display_name ?? asset?.metadata.filename ?? assetId}</strong>{!asset && <small className="opening-audio-missing">素材缺失</small>}</div><button data-help-key="editor.control" type="button" onClick={() => onChange({ ...animation, image_asset_ids: imageIds.filter((_, itemIndex) => itemIndex !== index) })}>移除</button></article>;
            })}
          </div>
        </div>
      )}
      {error && <p className="inline-status warning">{error}</p>}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FolderOpen, Save, X } from "lucide-react";
import { saveGeneratedAssetCandidate } from "../../../asset-generation/saving";
import type { GeneratedAssetCandidate } from "../../../asset-generation/session";
import type { AssetStudioOpenContext, ImageGenerationRecipeV1 } from "../../../asset-studio/types";
import type { GeneratedAssetRecord } from "../../../providers/types";
import { useProjectStore } from "../../../store/projectStore";
import { putImportedAssetsInFolder } from "../../../utils/assetLibraryInteractions";
import { assetStudioAssetTypePresets } from "../../../asset-studio/defaults";
import { requestAdvancedTools } from "../advancedToolsBridge";
import { RichSelect } from "../../common/RichSelect";

interface AssetStudioSaveDialogProps {
  candidates: GeneratedAssetCandidate[];
  recipe: ImageGenerationRecipeV1;
  jobId?: string;
  onSaveAsset: (asset: GeneratedAssetRecord) => void;
  openContext?: AssetStudioOpenContext & { onApplyAsset?: (asset: GeneratedAssetRecord) => void };
  onClose: () => void;
}

export function AssetStudioSaveDialog({
  candidates,
  recipe,
  jobId,
  onSaveAsset,
  openContext,
  onClose,
}: AssetStudioSaveDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const assetLibrary = useProjectStore((state) => state.settings.assetLibrary);
  const setAssetLibrary = useProjectStore((state) => state.setAssetLibrary);
  const [displayName, setDisplayName] = useState(`${assetStudioAssetTypePresets[recipe.assetType].label}_${new Date().toLocaleDateString().replace(/\//g, "-")}`);
  const [assetType, setAssetType] = useState<"background" | "sprite" | "portrait" | "ui" | "other">(
    recipe.assetType === "cg" ? "background" : recipe.assetType
  );
  const [folderId, setFolderId] = useState(openContext?.targetFolderId ?? "");
  const [license, setLicense] = useState("请在发布前确认模型提供商授权与商用许可。");
  const [outputMimeType, setOutputMimeType] = useState<"image/png" | "image/jpeg" | "image/webp">("image/png");
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  async function saveAll(openLibrary = false, applyToTarget = false) {
    if (candidates.length === 0) return;
    setSaving(true);
    setError("");
    setSavedCount(0);
    try {
      const usedAssetIds = new Set(assetManifest.map((asset) => asset.asset_id));
      const savedAssets: GeneratedAssetRecord[] = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const record = await saveGeneratedAssetCandidate(candidate, {
          assetType,
          usedAssetIds,
          displayName: candidates.length > 1 ? `${displayName}_${index + 1}` : displayName,
          licenseNote: license,
          outputMimeType,
          generation: {
            version: 1,
            operation: recipe.operation,
            provider_id: recipe.provider?.providerId,
            model: recipe.provider?.model,
            prompt: recipe.prompt,
            negative_prompt: recipe.negativePrompt || undefined,
            style_preset: recipe.stylePreset || undefined,
            aspect_ratio: recipe.aspectRatio,
            width: recipe.width,
            height: recipe.height,
            seed: candidate.seed ?? recipe.seed,
            source_job_id: jobId,
            local_steps: [
              ...(candidate.providerId === "local_edit" ? ["local_edit"] : []),
              ...(candidate.mime_type !== outputMimeType ? [`format_conversion:${outputMimeType}`] : []),
            ],
          },
        });
        usedAssetIds.add(record.asset_id);
        savedAssets.push(record);
        onSaveAsset(record);
        setSavedCount(index + 1);
      }
      if (folderId) {
        const latestLibrary = useProjectStore.getState().settings.assetLibrary;
        setAssetLibrary(putImportedAssetsInFolder(
          latestLibrary,
          savedAssets.map((asset) => ({ assetId: asset.asset_id, folderId }))
        ));
      }
      if (applyToTarget && savedAssets[0] && openContext?.onApplyAsset) {
        openContext.onApplyAsset(savedAssets[0]);
      }
      onClose();
      if (openLibrary) {
        requestAdvancedTools({
          tab: "library",
          title: `已保存 ${savedAssets.length} 张素材`,
          message: "生成来源已脱敏写入素材元数据，可继续整理文件夹和标签。",
        });
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="asset-studio-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div
        className="asset-studio-save-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-studio-save-title"
      >
        <header>
          <div>
            <span className="asset-studio-eyebrow">素材入库</span>
            <h2 id="asset-studio-save-title">保存 {candidates.length} 张生成结果</h2>
          </div>
          <button type="button" className="asset-studio-icon-button" data-help-key="asset.saveGeneratedCancel" aria-label="关闭保存对话框" disabled={saving} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="asset-studio-save-layout">
          <section className="asset-studio-save-preview" aria-label="待保存候选图">
            {candidates.slice(0, 6).map((candidate, index) => (
              <img key={candidate.image_id} src={candidate.blob_url} alt={`待保存候选图 ${index + 1}`} />
            ))}
            {candidates.length > 6 && <span>另有 {candidates.length - 6} 张</span>}
          </section>
          <section className="asset-studio-save-form">
            <label className="asset-studio-field">
              <span>{candidates.length > 1 ? "批量名称前缀" : "显示名称"}</span>
              <input ref={firstFieldRef} data-help-key="asset.displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <div className="asset-studio-inline-fields">
              <label className="asset-studio-field">
                <span>素材类型</span>
                <RichSelect value={assetType} helpKey="asset.saveType" options={[
                  { value: "background", label: "背景" },
                  { value: "sprite", label: "立绘" },
                  { value: "portrait", label: "头像" },
                  { value: "ui", label: "UI 素材" },
                  { value: "other", label: "其他" },
                ]} onChange={setAssetType} />
              </label>
              <label className="asset-studio-field">
                <span>素材库文件夹</span>
                <RichSelect value={folderId} helpKey="asset.saveFolder" options={[
                  { value: "", label: "素材库根目录" },
                  ...assetLibrary.folders.map((folder) => ({ value: folder.folder_id, label: folder.name })),
                ]} onChange={setFolderId} />
              </label>
            </div>
            <label className="asset-studio-field">
              <span>文件格式</span>
              <RichSelect value={outputMimeType} helpKey="asset.saveFormat" options={[
                { value: "image/png", label: "PNG（保留透明）" },
                { value: "image/webp", label: "WebP（体积较小）" },
                { value: "image/jpeg", label: "JPEG（不支持透明）" },
              ]} onChange={setOutputMimeType} />
            </label>
            <label className="asset-studio-field">
              <span>授权说明</span>
              <textarea data-help-key="asset.license" value={license} onChange={(event) => setLicense(event.target.value)} />
            </label>
            <div className="asset-studio-save-provenance">
              <FolderOpen size={18} aria-hidden="true" />
              <div>
                <strong>{recipe.provider?.displayName || "未知模型"} · {recipe.width} × {recipe.height}</strong>
                <span>将保存脱敏配方摘要；参考图、蒙版和 API Key 不写入工程包。</span>
              </div>
            </div>
            {error && <p className="asset-studio-field-error" role="alert">{error}</p>}
          </section>
        </div>

        <footer>
          <span aria-live="polite">
            {saving ? `正在保存 ${savedCount + 1}/${candidates.length}` : "保存后可在素材库中继续整理与应用"}
          </span>
          <div>
            <button type="button" className="asset-studio-ghost-button" data-help-key="asset.saveGeneratedCancel" disabled={saving} onClick={onClose}>取消</button>
            <button type="button" className="asset-studio-secondary-button" data-help-key="asset.saveAndOpenLibrary" disabled={saving || !displayName.trim()} onClick={() => void saveAll(true)}>
              <FolderOpen size={16} aria-hidden="true" />
              保存并打开素材库
            </button>
            {openContext?.onApplyAsset && (
              <button type="button" className="asset-studio-secondary-button" data-help-key="asset.saveAndApply" disabled={saving || !displayName.trim()} onClick={() => void saveAll(false, true)}>
                <CheckCircle2 size={16} aria-hidden="true" />
                保存并应用到当前槽位
              </button>
            )}
            <button type="button" className="asset-studio-primary-button" data-help-key="asset.saveGenerated" disabled={saving || !displayName.trim()} onClick={() => void saveAll(false)}>
              {saving ? <CheckCircle2 size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {saving ? "正在保存" : `保存 ${candidates.length} 张`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

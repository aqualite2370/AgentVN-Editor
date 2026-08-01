import { useState } from "react";
import { saveGeneratedAssetCandidate } from "../../asset-generation/saving";
import type { GeneratedAssetCandidate } from "../../asset-generation/session";
import type { GeneratedAssetRecord } from "../../providers/types";
import { useProjectStore } from "../../store/projectStore";
import { assetTypeOptions } from "../../utils/localizedOptions";
import { RichSelect } from "../common/RichSelect";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const generatedImageAssetTypeOptions = assetTypeOptions.filter(
  (option) => option.value === "background" || option.value === "sprite" || option.value === "portrait" || option.value === "ui" || option.value === "other",
);

export function SaveGeneratedAssetDialog({
  candidate,
  assetType = "background",
  onSave,
  onCancel,
}: {
  candidate: GeneratedAssetCandidate;
  assetType?: GeneratedAssetRecord["asset_type"];
  onSave: (record: GeneratedAssetRecord) => void;
  onCancel?: () => void;
}) {
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const [selectedAssetType, setSelectedAssetType] = useState<GeneratedAssetRecord["asset_type"]>(
    generatedImageAssetTypeOptions.some((option) => option.value === assetType) ? assetType : "background",
  );
  const [displayName, setDisplayName] = useState(candidate.image_id);
  const [license, setLicense] = useState("请在发布前确认模型供应商授权与商用许可。");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const record = await saveGeneratedAssetCandidate(candidate, {
        assetType: selectedAssetType,
        usedAssetIds: new Set(assetManifest.map((asset) => asset.asset_id)),
        displayName,
        licenseNote: license,
      });
      onSave(record);
    } catch (err) {
      reportFrontendError("editor.asset-save", err, { operation: "save-generated-asset" });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="advanced-card">
      <h3>保存生成素材</h3>
      <img src={candidate.blob_url} alt={candidate.image_id} className="asset-preview-image" />
      <p className="inline-status">保存前会统一转成可导出的 data_url，并写入 provider/model/prompt 元数据。</p>
      <label>
        素材类型
        <RichSelect value={selectedAssetType} options={generatedImageAssetTypeOptions} helpKey="asset.assetType" onChange={(nextAssetType) => setSelectedAssetType(nextAssetType as GeneratedAssetRecord["asset_type"])} />
      </label>
      <label>显示名称<input value={displayName} data-help-key="asset.displayName" onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>授权备注<textarea value={license} data-help-key="asset.license" onChange={(event) => setLicense(event.target.value)} /></label>
      {error && <p className="inline-error">{error}</p>}
      <div className="row-actions">
        <button type="button" data-help-key="asset.saveGenerated" disabled={saving || !candidate.canSave} onClick={save}>{saving ? "保存中..." : "保存"}</button>
        {onCancel && <button type="button" data-help-key="asset.saveGeneratedCancel" disabled={saving} onClick={onCancel}>关闭</button>}
      </div>
    </section>
  );
}

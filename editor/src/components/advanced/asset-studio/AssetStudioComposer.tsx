import { nanoid } from "nanoid";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Check,
  ChevronDown,
  ImagePlus,
  Layers3,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import type { PromptRewriteResult, ProviderConfig, ReferenceImage } from "../../../providers/types";
import {
  applyAspectRatio,
  assetStudioAspectRatios,
  assetStudioAssetTypePresets,
} from "../../../asset-studio/defaults";
import type {
  AssetStudioAssetType,
  AssetStudioValidationIssue,
  ImageGenerationRecipeV1,
} from "../../../asset-studio/types";
import { stylePresetOptions } from "../../../utils/localizedOptions";
import type { AssetStudioProjectSettings } from "../../../types/project";
import { RichSelect } from "../../common/RichSelect";

interface AssetStudioComposerProps {
  recipe: ImageGenerationRecipeV1;
  providers: ProviderConfig[];
  issues: AssetStudioValidationIssue[];
  rewriteResult?: PromptRewriteResult;
  rewriteStream: string;
  rewriting: boolean;
  canUndoRewrite: boolean;
  onPatch: (patch: Partial<ImageGenerationRecipeV1>) => void;
  onReplace: (recipe: ImageGenerationRecipeV1) => void;
  onProviderChange: (providerId: string) => void;
  onRewrite: () => void;
  onApplyRewrite: (includeNegative?: boolean) => void;
  onUndoRewrite: () => void;
  customPresets: AssetStudioProjectSettings["customPresets"];
  onSaveCustomPreset: (name: string) => void;
}

const referenceRoleOptions: Array<{ value: NonNullable<ReferenceImage["role"]>; label: string }> = [
  { value: "character", label: "角色一致性" },
  { value: "composition", label: "构图参考" },
  { value: "style", label: "风格参考" },
  { value: "color", label: "色彩参考" },
];

function objectUrlReference(file: File, role: ReferenceImage["role"] = "composition"): ReferenceImage {
  return {
    image_id: `ref_${nanoid(8)}`,
    source: "upload",
    blob_url: URL.createObjectURL(file),
    note: file.name,
    weight: 0.7,
    role,
  };
}

export function AssetStudioComposer({
  recipe,
  providers,
  issues,
  rewriteResult,
  rewriteStream,
  rewriting,
  canUndoRewrite,
  onPatch,
  onReplace,
  onProviderChange,
  onRewrite,
  onApplyRewrite,
  onUndoRewrite,
  customPresets,
  onSaveCustomPreset,
}: AssetStudioComposerProps) {
  const selectedProvider = providers.find((provider) => provider.provider_id === recipe.provider?.providerId);
  const fieldIssues = new Map(issues.map((issue) => [issue.path, issue]));
  const needsSource = recipe.operation !== "text_to_image";
  const features = recipe.provider?.features;
  const referenceRoles = referenceRoleOptions.filter((option) => features?.supports_reference_roles.includes(option.value));
  const canUseReferences = referenceRoles.length > 0;
  const [customPresetName, setCustomPresetName] = useState("");
  const [selectedCustomPresetId, setSelectedCustomPresetId] = useState("");

  function setAssetType(assetType: AssetStudioAssetType) {
    const preset = assetStudioAssetTypePresets[assetType];
    onPatch({
      assetType,
      aspectRatio: preset.aspectRatio,
      width: preset.width,
      height: preset.height,
    });
  }

  function updateReference(imageId: string, patch: Partial<ReferenceImage>) {
    onPatch({
      references: recipe.references.map((image) => image.image_id === imageId ? { ...image, ...patch } : image),
    });
  }

  function removeReference(imageId: string) {
    const target = recipe.references.find((image) => image.image_id === imageId);
    if (target?.blob_url.startsWith("blob:")) URL.revokeObjectURL(target.blob_url);
    onPatch({ references: recipe.references.filter((image) => image.image_id !== imageId) });
  }

  function moveReference(imageId: string, direction: -1 | 1) {
    const index = recipe.references.findIndex((image) => image.image_id === imageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= recipe.references.length) return;
    const next = [...recipe.references];
    [next[index], next[target]] = [next[target], next[index]];
    onPatch({ references: next });
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    onPatch({ references: [...recipe.references, ...files.map((file) => objectUrlReference(file))] });
  }

  function setSourceFile(file?: File) {
    if (!file) return;
    if (recipe.sourceImage?.blob_url.startsWith("blob:")) URL.revokeObjectURL(recipe.sourceImage.blob_url);
    onPatch({ sourceImage: { ...objectUrlReference(file, "source"), role: "source" } });
  }

  return (
    <aside
      className="asset-studio-composer"
      aria-label="生成设置"
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (files.length > 0 && canUseReferences) {
          event.preventDefault();
          addFiles(files);
        }
      }}
    >
      <section className="asset-studio-section asset-studio-prompt-section">
        <div className="asset-studio-section-heading">
          <div>
            <span className="asset-studio-eyebrow">创作描述</span>
            <h2>告诉模型要制作什么</h2>
          </div>
          <button
            type="button"
            className="asset-studio-icon-button"
            data-help-key="asset.rewrite"
            aria-label="优化提示词"
            disabled={rewriting || !recipe.prompt.trim()}
            onClick={onRewrite}
          >
            <Sparkles size={17} aria-hidden="true" />
          </button>
        </div>
        <label className="asset-studio-field">
          <span>正向提示词</span>
          <textarea
            value={recipe.prompt}
            data-help-key="asset.prompt"
            aria-invalid={fieldIssues.has("prompt")}
            onChange={(event) => onPatch({ prompt: event.target.value })}
          />
        </label>
        {fieldIssues.get("prompt") && <p className="asset-studio-field-error">{fieldIssues.get("prompt")?.message}</p>}
        <div className="asset-studio-prompt-actions">
          <button type="button" className="asset-studio-secondary-button" data-help-key="asset.rewrite" disabled={rewriting || !recipe.prompt.trim()} onClick={onRewrite}>
            <Sparkles size={15} aria-hidden="true" />
            {rewriting ? "正在优化" : "优化提示词"}
          </button>
          <button type="button" className="asset-studio-ghost-button" data-help-key="asset.undoRewrite" disabled={!canUndoRewrite} onClick={onUndoRewrite}>
            <Undo2 size={15} aria-hidden="true" />
            撤销
          </button>
        </div>
        {(rewriteStream || rewriteResult) && (
          <div className="asset-studio-rewrite-result" aria-live="polite">
            <div>
              <strong>{rewriting ? "优化进行中" : "优化建议"}</strong>
              <span>AI 建议 · 应用前不会覆盖你的原文</span>
            </div>
            <p>{rewriteResult?.optimized_prompt || rewriteStream}</p>
            {rewriteResult?.negative_prompt && <small>反向建议：{rewriteResult.negative_prompt}</small>}
            {rewriteResult && (
              <button type="button" className="asset-studio-secondary-button" data-help-key="asset.useRewrite" onClick={() => onApplyRewrite(false)}>
                <Check size={15} aria-hidden="true" />
                仅应用正向提示词
              </button>
            )}
            {rewriteResult?.negative_prompt && (
              <button type="button" className="asset-studio-ghost-button" data-help-key="asset.useRewriteWithNegative" onClick={() => onApplyRewrite(true)}>
                <Check size={15} aria-hidden="true" />
                同时应用反向提示词
              </button>
            )}
          </div>
        )}
      </section>

      <section className="asset-studio-section">
        <div className="asset-studio-section-heading">
          <div>
            <span className="asset-studio-eyebrow">用途预设</span>
            <h2>匹配视觉小说素材规格</h2>
          </div>
        </div>
        <div className="asset-studio-choice-grid asset-studio-type-grid">
          {(Object.entries(assetStudioAssetTypePresets) as Array<[AssetStudioAssetType, typeof assetStudioAssetTypePresets[AssetStudioAssetType]]>).map(([value, preset]) => (
            <button
              type="button"
              key={value}
              data-help-key="asset.type"
              className={recipe.assetType === value ? "is-selected" : ""}
              aria-pressed={recipe.assetType === value}
              onClick={() => setAssetType(value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="asset-studio-hint">{assetStudioAssetTypePresets[recipe.assetType].promptHint}</p>
        <label className="asset-studio-field">
          <span>风格预设</span>
          <RichSelect
            value={recipe.stylePreset}
            options={stylePresetOptions}
            helpKey="asset.stylePreset"
            onChange={(stylePreset) => onPatch({ stylePreset })}
          />
        </label>
        {customPresets.length > 0 && (
          <label className="asset-studio-field">
            <span>我的配方预设</span>
            <RichSelect
              value={selectedCustomPresetId}
              placeholder="选择已保存预设"
              helpKey="asset.customPreset"
              options={customPresets.map((preset) => ({ value: preset.presetId, label: preset.name }))}
              onChange={(presetId) => {
                setSelectedCustomPresetId(presetId);
                const preset = customPresets.find((item) => item.presetId === presetId);
                if (!preset) return;
                onPatch({
                  assetType: preset.assetType,
                  stylePreset: preset.stylePreset,
                  aspectRatio: preset.aspectRatio,
                  width: preset.width,
                  height: preset.height,
                  prompt: preset.promptTemplate || recipe.prompt,
                });
                window.requestAnimationFrame(() => setSelectedCustomPresetId(""));
              }}
            />
          </label>
        )}
        <div className="asset-studio-custom-preset">
          <input
            data-help-key="asset.customPresetName"
            value={customPresetName}
            aria-label="自定义预设名称"
            placeholder="为当前配方命名"
            onChange={(event) => setCustomPresetName(event.target.value)}
          />
          <button
            type="button"
            className="asset-studio-ghost-button"
            data-help-key="asset.saveCustomPreset"
            disabled={!customPresetName.trim()}
            onClick={() => {
              onSaveCustomPreset(customPresetName.trim());
              setCustomPresetName("");
            }}
          >
            <BookmarkPlus size={15} aria-hidden="true" />
            保存为预设
          </button>
        </div>
      </section>

      <section className="asset-studio-section">
        <div className="asset-studio-section-heading">
          <div>
            <span className="asset-studio-eyebrow">画幅与批次</span>
            <h2>选择输出构图</h2>
          </div>
        </div>
        <div className="asset-studio-ratio-grid">
          {assetStudioAspectRatios.map((ratio) => (
            <button
              type="button"
              key={ratio.value}
              data-help-key="asset.aspectRatio"
              className={recipe.aspectRatio === ratio.value ? "is-selected" : ""}
              aria-pressed={recipe.aspectRatio === ratio.value}
              onClick={() => onReplace(applyAspectRatio(recipe, ratio.value))}
            >
              <span className="asset-studio-ratio-shape" style={{ aspectRatio: ratio.value.replace(":", " / ") }} />
              <strong>{ratio.value}</strong>
              <small>{ratio.label}</small>
            </button>
          ))}
          <button
            type="button"
            data-help-key="asset.aspectRatio"
            className={recipe.aspectRatio === "custom" ? "is-selected" : ""}
            aria-pressed={recipe.aspectRatio === "custom"}
            onClick={() => onPatch({ aspectRatio: "custom" })}
          >
            <span className="asset-studio-ratio-shape is-custom" />
            <strong>自定义</strong>
            <small>{recipe.width}×{recipe.height}</small>
          </button>
        </div>
        <label className="asset-studio-field">
          <span>本批生成数量</span>
          <input
            data-help-key="asset.count"
            type="range"
            min={1}
            max={8}
            value={recipe.count}
            aria-label={`生成 ${recipe.count} 张`}
            onChange={(event) => onPatch({ count: Number(event.target.value) })}
          />
          <output>{recipe.count} 张</output>
        </label>
      </section>

      {needsSource && (
        <section className="asset-studio-section">
          <div className="asset-studio-section-heading">
            <div>
              <span className="asset-studio-eyebrow">来源图片</span>
              <h2>选择要继续加工的画面</h2>
            </div>
          </div>
          {recipe.sourceImage ? (
            <div className="asset-studio-source-card">
              <img src={recipe.sourceImage.blob_url} alt={recipe.sourceImage.note || "来源图片"} />
              <div>
                <strong>{recipe.sourceImage.note || "来源图片"}</strong>
                <button type="button" className="asset-studio-ghost-button" data-help-key="asset.removeSource" onClick={() => onPatch({ sourceImage: undefined })}>
                  <X size={14} aria-hidden="true" />
                  移除
                </button>
              </div>
            </div>
          ) : (
            <label className="asset-studio-dropzone">
              <Upload size={20} aria-hidden="true" />
              <strong>选择来源图片</strong>
              <span>图生图、重绘、扩图、变体和放大均从这里开始</span>
              <input type="file" accept="image/*" onChange={(event) => setSourceFile(event.target.files?.[0])} />
            </label>
          )}
          {fieldIssues.get("sourceImage") && <p className="asset-studio-field-error">{fieldIssues.get("sourceImage")?.message}</p>}
        </section>
      )}

      <section className="asset-studio-section">
        <details className="asset-studio-disclosure" open={recipe.references.length > 0}>
          <summary>
            <span><Layers3 size={16} aria-hidden="true" />参考图</span>
            <span>{recipe.references.length} 张 <ChevronDown size={15} aria-hidden="true" /></span>
          </summary>
          <div className="asset-studio-disclosure-body">
            <label className={`asset-studio-dropzone is-compact${canUseReferences ? "" : " is-disabled"}`}>
              <ImagePlus size={18} aria-hidden="true" />
              <strong>{canUseReferences ? "添加参考图" : "当前模型不支持参考图"}</strong>
              <span>{canUseReferences ? "支持多选、粘贴图片" : "切换支持角色、构图、风格或色彩参考的模型后可用"}</span>
              <input disabled={!canUseReferences} type="file" accept="image/*" multiple onChange={(event) => addFiles(Array.from(event.target.files ?? []))} />
            </label>
            {recipe.references.map((image) => (
              <article className="asset-studio-reference-card" key={image.image_id}>
                <img src={image.blob_url} alt={image.note || "参考图"} />
                <div>
                  <RichSelect
                    helpKey="asset.referenceRole"
                    ariaLabel={`${image.note || "参考图"}的用途`}
                    value={image.role ?? "composition"}
                    options={referenceRoleOptions.map((option) => ({
                      ...option,
                      label: `${option.label}${features?.supports_reference_roles.includes(option.value) ? "" : "（模型不支持）"}`,
                      disabled: !features?.supports_reference_roles.includes(option.value),
                    }))}
                    onChange={(role) => updateReference(image.image_id, { role })}
                  />
                  <input
                    data-help-key="asset.referenceNote"
                    type="text"
                    aria-label={`${image.note || "参考图"}的备注`}
                    value={image.note}
                    placeholder="参考图备注"
                    onChange={(event) => updateReference(image.image_id, { note: event.target.value })}
                  />
                  <label>
                    <span>权重 {image.weight.toFixed(1)}</span>
                    <input
                      data-help-key="asset.referenceWeight"
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={image.weight}
                      onChange={(event) => updateReference(image.image_id, { weight: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <div className="asset-studio-reference-actions">
                  <button type="button" data-help-key="asset.referenceMoveUp" aria-label="上移参考图" disabled={recipe.references[0]?.image_id === image.image_id} onClick={() => moveReference(image.image_id, -1)}>
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button type="button" data-help-key="asset.referenceMoveDown" aria-label="下移参考图" disabled={recipe.references[recipe.references.length - 1]?.image_id === image.image_id} onClick={() => moveReference(image.image_id, 1)}>
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button type="button" data-help-key="asset.removeReference" aria-label={`移除${image.note || "参考图"}`} onClick={() => removeReference(image.image_id)}>
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
            {fieldIssues.get("references") && <p className="asset-studio-field-error">{fieldIssues.get("references")?.message}</p>}
          </div>
        </details>
      </section>

      <section className="asset-studio-section">
        <details className="asset-studio-disclosure">
          <summary>
            <span><SlidersHorizontal size={16} aria-hidden="true" />高级设置</span>
            <span>{selectedProvider?.display_name ?? "未选择模型"} <ChevronDown size={15} aria-hidden="true" /></span>
          </summary>
          <div className="asset-studio-disclosure-body">
            <label className="asset-studio-field">
              <span>图像模型</span>
              <RichSelect
                value={recipe.provider?.providerId ?? ""}
                placeholder="请选择模型"
                helpKey="asset.provider"
                options={providers.map((provider) => ({
                  value: provider.provider_id,
                  label: `${provider.connection_name} / ${provider.display_name}`,
                }))}
                onChange={onProviderChange}
              />
            </label>
            {fieldIssues.get("provider") && <p className="asset-studio-field-error">{fieldIssues.get("provider")?.message}</p>}
            <label className="asset-studio-field">
              <span>反向提示词</span>
              <textarea
                data-help-key="asset.negativePrompt"
                className="is-compact"
                value={recipe.negativePrompt}
                disabled={!features?.supports_negative_prompt}
                aria-invalid={fieldIssues.has("negativePrompt")}
                placeholder={features?.supports_negative_prompt ? "输入需要避免的元素" : "当前模型不支持反向提示词"}
                onChange={(event) => onPatch({ negativePrompt: event.target.value })}
              />
            </label>
            {fieldIssues.get("negativePrompt") && <p className="asset-studio-field-error">{fieldIssues.get("negativePrompt")?.message}</p>}
            <label className="asset-studio-field">
              <span>项目上下文</span>
              <textarea
                data-help-key="asset.projectContext"
                className="is-compact"
                value={recipe.projectContext}
                placeholder="可补充场景、角色或用途信息"
                onChange={(event) => onPatch({ projectContext: event.target.value })}
              />
            </label>
            <div className="asset-studio-inline-fields">
              <label className="asset-studio-field">
                <span>宽度</span>
                <input data-help-key="asset.width" type="number" min={64} max={4096} value={recipe.width} onChange={(event) => onPatch({ width: Number(event.target.value), aspectRatio: "custom" })} />
              </label>
              <label className="asset-studio-field">
                <span>高度</span>
                <input data-help-key="asset.height" type="number" min={64} max={4096} value={recipe.height} onChange={(event) => onPatch({ height: Number(event.target.value), aspectRatio: "custom" })} />
              </label>
            </div>
            {features?.dimension_mode === "aspect_ratio" && (
              <p className="asset-studio-hint">该模型按画幅比例生成，精确宽高仅作为编辑器期望值，实际结果可能不同。</p>
            )}
            <label className="asset-studio-field">
              <span>种子（留空为随机）</span>
              <input
                data-help-key="asset.seed"
                type="number"
                value={recipe.seed ?? ""}
                disabled={!features?.supports_seed}
                placeholder={features?.supports_seed ? "随机" : "当前模型不支持固定种子"}
                aria-invalid={fieldIssues.has("seed")}
                onChange={(event) => onPatch({ seed: event.target.value ? Number(event.target.value) : undefined })}
              />
            </label>
            {fieldIssues.get("seed") && <p className="asset-studio-field-error">{fieldIssues.get("seed")?.message}</p>}
            <label className="asset-studio-field">
              <span>安全级别</span>
              <RichSelect
                value={recipe.safetyLevel}
                helpKey="asset.safetyLevel"
                options={[
                  { value: "strict", label: "严格" },
                  { value: "standard", label: "标准" },
                  { value: "low", label: "宽松" },
                ]}
                onChange={(safetyLevel) => onPatch({ safetyLevel })}
              />
            </label>
            {["image_to_image", "inpaint", "outpaint"].includes(recipe.operation) && (
              <label className="asset-studio-field">
                <span>重绘强度 {recipe.strength.toFixed(2)}</span>
                <input data-help-key="asset.strength" type="range" min={0.1} max={1} step={0.05} value={recipe.strength} onChange={(event) => onPatch({ strength: Number(event.target.value) })} />
              </label>
            )}
            {recipe.operation === "upscale" && (
              <label className="asset-studio-field">
                <span>放大倍数</span>
                <RichSelect
                  value={String(recipe.upscaleFactor)}
                  helpKey="asset.upscaleFactor"
                  options={[
                    { value: "2", label: "2×" },
                    { value: "4", label: "4×" },
                  ]}
                  onChange={(upscaleFactor) => onPatch({ upscaleFactor: Number(upscaleFactor) as 2 | 4 })}
                />
              </label>
            )}
            {recipe.operation === "outpaint" && (
              <fieldset className="asset-studio-outpaint-fields">
                <legend>扩图边界（像素）</legend>
                {(["top", "right", "bottom", "left"] as const).map((side) => (
                  <label key={side}>
                    <span>{{ top: "上", right: "右", bottom: "下", left: "左" }[side]}</span>
                    <input
                      data-help-key="asset.outpaintInset"
                      type="number"
                      min={0}
                      max={2048}
                      step={64}
                      value={recipe.outpaintInsets[side]}
                      onChange={(event) => onPatch({
                        outpaintInsets: { ...recipe.outpaintInsets, [side]: Number(event.target.value) },
                      })}
                    />
                  </label>
                ))}
              </fieldset>
            )}
            {features?.limitation_notes.length ? (
              <ul className="asset-studio-limitations" aria-label="当前模型限制">
                {features.limitation_notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            ) : null}
          </div>
        </details>
      </section>
    </aside>
  );
}

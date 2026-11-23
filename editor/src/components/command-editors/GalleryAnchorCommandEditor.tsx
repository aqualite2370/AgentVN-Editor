import type { GalleryAnchorCommand } from "../../types/commands";
import { AssetPicker } from "../common/AssetPicker";
import { useState } from "react";
import { RichSelect } from "../common/RichSelect";
import { useProjectStore } from "../../store/projectStore";
import { resolveRuntimeUILayoutSettings } from "../../../../shared/cartridge/uiLayoutProfiles";
import { GalleryPresentationSettings } from "../advanced/GalleryPresentationSettings";

export function GalleryAnchorCommandEditor({
  command,
  onChange,
}: {
  command: GalleryAnchorCommand;
  onChange: (command: GalleryAnchorCommand) => void;
}) {
  const settings = useProjectStore(state => state.settings);
  const assets = useProjectStore(state => state.assetManifest);
  const projectId = useProjectStore(state => state.projectId);
  const layout = resolveRuntimeUILayoutSettings(settings).runtimeUILayout;
  const [confirmation, setConfirmation] = useState<string>();
  const image = assets.find(asset => asset.asset_id === command.asset_id);
  const width = image?.metadata.width, height = image?.metadata.height;
  const confirmationKey = JSON.stringify([projectId, layout.layout_type, command.anchor_id, command.asset_id, width, height]);
  const validSize = Number.isInteger(width) && Number.isInteger(height)
    && width! >= 64 && height! >= 64 && width! <= 8192 && height! <= 8192;
  return (
    <div className="form-grid">
      <label>
        锚点名称
        <input
          value={command.title}
          aria-label="画廊锚点名称"
          data-help-key="command.galleryAnchor.title"
          placeholder="例如：雨夜告白"
          onChange={(event) => onChange({ ...command, title: event.target.value })}
        />
      </label>
      <label>
        锚点 ID
        <input data-help-key="editor.control" value={command.anchor_id} aria-label="画廊锚点 ID" readOnly />
        <small>用于保存唯一回看位置，修改名称不会改变。</small>
      </label>
      <p className="workbench-note gallery-anchor-guidance">
        此锚点会解锁所属场景节点；玩家从画廊进入时会从该场景的第一条事件开始回放。
        建议把一段完整的 CG/回放内容拆成独立场景。
      </p>
      <AssetPicker
        label="画廊展示素材"
        field="asset_id"
        value={command.asset_id}
        allowedTypes={["background", "sprite", "portrait", "ui"]}
        helpKey="command.galleryAnchor.assetId"
        emptyLabel="请选择画廊展示素材"
        onChange={(asset_id) => onChange({ ...command, asset_id })}
      />
      <label>
        图片显示方式
        <RichSelect ariaLabel="画廊图片显示方式" value={command.image_fit ?? "contain"}
          options={[{ value: "contain", label: "完整显示 · 保留全部画面" },
            { value: "cover", label: "铺满容器 · 裁切边缘" },
            { value: "fullscreen", label: "铺满全屏 · 控件浮在图片上" }]}
          onChange={image_fit => onChange({ ...command, image_fit })} />
      </label>
      <button type="button" disabled={!validSize}
        onClick={() => setConfirmation(confirmationKey)}>用此图片比例设置全部画廊容器</button>
      {confirmation === confirmationKey && <section role="group" aria-label="确认统一画廊比例">
        <p>将当前布局全部画廊容器改为 {width} × {height}。其他比例的图片可能被裁切。</p>
        <button type="button" onClick={() => {
          // Current synchronous owner only; no delayed image decode or store
          // capture can write these settings into a newly opened project.
          if (validSize && width && height && useProjectStore.getState().projectId === projectId)
            useProjectStore.getState().setRuntimeUILayout({
            ...layout, galleryPresentation: { width, height },
          });
          setConfirmation(undefined);
        }}>确认应用到全部</button>
        <button type="button" onClick={() => setConfirmation(undefined)}>取消</button>
      </section>}
      <details className="runtime-layout-fieldset"><summary>全部画廊容器比例与尺寸</summary>
        <GalleryPresentationSettings draft={layout}
          onChange={next => useProjectStore.getState().setRuntimeUILayout(next)} />
      </details>
      <label>
        画廊描述
        <textarea
          value={command.description ?? ""}
          aria-label="画廊锚点描述"
          data-help-key="command.galleryAnchor.description"
          placeholder="可选，显示在画廊条目中"
          onChange={(event) => onChange({ ...command, description: event.target.value || null })}
        />
      </label>
    </div>
  );
}

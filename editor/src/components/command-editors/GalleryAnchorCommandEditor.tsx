import type { GalleryAnchorCommand } from "../../types/commands";
import { AssetPicker } from "../common/AssetPicker";

export function GalleryAnchorCommandEditor({
  command,
  onChange,
}: {
  command: GalleryAnchorCommand;
  onChange: (command: GalleryAnchorCommand) => void;
}) {
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

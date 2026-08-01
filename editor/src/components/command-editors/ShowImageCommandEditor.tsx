import type { ShowImageCommand } from "../../types/commands";
import { backgroundFitOptions } from "../../utils/localizedOptions";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function ShowImageCommandEditor({
  command,
  onChange,
}: {
  command: ShowImageCommand;
  onChange: (command: ShowImageCommand) => void;
}) {
  return (
    <div className="form-grid">
      <AssetPicker
        label="展示图片素材"
        field="image_id"
        value={command.image_id}
        allowedTypes={["background", "sprite", "portrait", "ui"]}
        helpKey="command.showImage.imageId"
        emptyLabel="暂无可用图片素材"
        onChange={(imageId) => onChange({ ...command, image_id: imageId })}
      />
      <label>
        显示名称
        <input
          value={command.image_display_name ?? ""}
          data-help-key="command.showImage.displayName"
          placeholder="例如：沾血的钥匙"
          onChange={(event) => onChange({ ...command, image_display_name: event.target.value || null })}
        />
      </label>
      <label>
        图片显示模式
        <RichSelect
          ariaLabel="展示图片显示模式"
          value={command.image_fit ?? "contain"}
          options={backgroundFitOptions}
          helpKey="command.showImage.fit"
          variant="compact"
          onChange={(imageFit) => onChange({ ...command, image_fit: imageFit })}
        />
      </label>
      <label>
        图片说明
        <textarea
          value={command.caption ?? ""}
          data-help-key="command.showImage.caption"
          placeholder="可选，显示在图片下方"
          onChange={(event) => onChange({ ...command, caption: event.target.value || null })}
        />
      </label>
      <label>
        无障碍描述
        <input
          value={command.alt ?? ""}
          data-help-key="command.showImage.alt"
          placeholder="描述图片中的关键内容"
          onChange={(event) => onChange({ ...command, alt: event.target.value || null })}
        />
      </label>
      <label>
        背景暗度
        <input
          type="number"
          min="0"
          max="0.9"
          step="0.05"
          value={command.backdrop_opacity ?? 0.62}
          data-help-key="command.showImage.backdropOpacity"
          onChange={(event) => onChange({ ...command, backdrop_opacity: clamp(Number(event.target.value), 0, 0.9) })}
        />
      </label>
      <label>
        背景模糊（px）
        <input
          type="number"
          min="0"
          max="24"
          step="1"
          value={command.backdrop_blur_px ?? 12}
          data-help-key="command.showImage.backdropBlur"
          onChange={(event) => onChange({ ...command, backdrop_blur_px: clamp(Number(event.target.value), 0, 24) })}
        />
      </label>
    </div>
  );
}

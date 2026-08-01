import type { BackgroundCommand } from "../../types/commands";
import { backgroundFitOptions, transitionOptions } from "../../utils/localizedOptions";
import { AssetPicker } from "../common/AssetPicker";
import { FieldHelp } from "../common/FieldHelp";
import { LocalizedValueSelect } from "../common/LocalizedValueSelect";
import { RichSelect } from "../common/RichSelect";
import { VisualTransitionControls } from "./VisualTransitionControls";

export function BackgroundCommandEditor({
  command,
  onChange,
}: {
  command: BackgroundCommand;
  onChange: (command: BackgroundCommand) => void;
}) {
  return (
    <div className="form-grid background-command-editor">
      <AssetPicker
        label="背景素材"
        field="background_id"
        value={command.background_id}
        allowedTypes={["background"]}
        helpKey="command.background.backgroundId"
        onChange={(assetId) => onChange({ ...command, background_id: assetId })}
      />
      <label>
        背景显示模式 <FieldHelp field="background_fit" />
        <RichSelect
          ariaLabel="背景显示模式"
          value={command.background_fit ?? "stretch"}
          options={backgroundFitOptions}
          helpKey="command.background.backgroundFit"
          variant="compact"
          onChange={(backgroundFit) => onChange({ ...command, background_fit: backgroundFit })}
        />
      </label>

      <VisualTransitionControls
        value={command.transition_config}
        legacyValue={command.transition}
        targetLabel="背景切换"
        onChange={(transition_config) => onChange({ ...command, transition_config })}
      />

      <details className="background-legacy-transition">
        <summary>
          <span>旧版过场字段兼容</span>
          <small>仅用于旧项目和自定义过场代码，精细设置优先生效</small>
        </summary>
        <div className="background-legacy-transition-fields">
          <label>
            旧版过场动画 <FieldHelp field="transition" />
            <LocalizedValueSelect
              value={command.transition ?? ""}
              options={transitionOptions}
              emptyLabel="不指定"
              helpKey="command.background.transition"
              customPlaceholder="填写自定义过场代码"
              onChange={(transition) => onChange({ ...command, transition: transition || null })}
            />
          </label>
          <label>
            旧版过场动画代称 <FieldHelp field="transition_display_name" />
            <input
              value={command.transition_display_name ?? ""}
              placeholder="例如：淡入过场、推镜过场"
              onChange={(event) => onChange({ ...command, transition_display_name: event.target.value || null })}
            />
          </label>
        </div>
      </details>
    </div>
  );
}

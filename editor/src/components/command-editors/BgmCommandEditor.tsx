import type { BgmAction, BgmCommand } from "../../types/commands";
import { bgmActionOptions } from "../../utils/localizedOptions";
import { FieldHelp } from "../common/FieldHelp";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";

export function BgmCommandEditor({ command, onChange }: { command: BgmCommand; onChange: (command: BgmCommand) => void }) {
  return (
    <div className="form-grid">
      <AssetPicker
        label="背景音乐素材"
        field="bgm_id"
        value={command.bgm_id ?? ""}
        allowedTypes={["bgm"]}
        helpKey="command.bgm.bgmId"
        onChange={(assetId) => onChange({ ...command, bgm_id: assetId || null })}
      />
      <label>播放动作 <FieldHelp field="action" /><RichSelect value={command.action} options={bgmActionOptions} helpKey="command.bgm.action" onChange={(nextAction) => onChange({ ...command, action: nextAction as BgmAction })} /></label>
      <label>音量 <FieldHelp field="volume" /><input type="number" min="0" max="1" step="0.1" value={command.volume ?? 1} data-help-key="command.bgm.volume" onChange={(e) => onChange({ ...command, volume: Number(e.target.value) })} /></label>
      <label>淡入淡出毫秒 <FieldHelp field="fade_ms" /><input type="number" value={command.fade_ms ?? 0} data-help-key="command.bgm.fadeMs" onChange={(e) => onChange({ ...command, fade_ms: Number(e.target.value) })} /></label>
    </div>
  );
}

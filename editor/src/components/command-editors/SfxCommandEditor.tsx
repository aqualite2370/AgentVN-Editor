import { NumberInput } from "../common/NumberInput";
import type { SfxCommand } from "../../types/commands";
import { FieldHelp } from "../common/FieldHelp";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";

export function SfxCommandEditor({ command, onChange }: { command: SfxCommand; onChange: (command: SfxCommand) => void }) {
  const stopping = command.action === "stop";
  const fading = (command.fade_ms ?? 0) > 0;
  return (
    <div className="form-grid">
      <label>播放动作
        <RichSelect ariaLabel="音效播放动作" value={stopping ? "stop" : "play"}
          options={[{ value: "play", label: "播放" }, { value: "stop", label: "停止" }]}
          onChange={(action) => onChange({ ...command, action: action as "play" | "stop" })} />
      </label>
      <AssetPicker
        label={stopping ? "停止目标" : "音效素材"}
        emptyLabel={stopping ? "全部音效" : "选择音效"}
        placeholder={stopping ? "全部音效" : "尚未选择素材"}
        field="sfx_id"
        value={command.sfx_id}
        allowedTypes={["sfx"]}
        helpKey="command.sfx.sfxId"
        onChange={(assetId) => onChange({ ...command, sfx_id: assetId })}
      />
      {!stopping && <label>音量 <FieldHelp field="volume" /><NumberInput type="number" min="0" max="1" step="0.1" value={command.volume ?? 1} data-help-key="command.sfx.volume" onChange={(e) => onChange({ ...command, volume: Number(e.target.value) })} /></label>}
      {stopping && <label>停止效果
        <RichSelect ariaLabel="音效停止效果" value={fading ? "fade" : "instant"}
          options={[{ value: "instant", label: "立即停止" }, { value: "fade", label: "淡出" }]}
          onChange={(effect) => onChange({ ...command, fade_ms: effect === "fade" ? (command.fade_ms || 500) : 0 })} />
      </label>}
      {stopping && fading && <label>淡出时长（毫秒）
        <NumberInput type="number" min="0" max="60000" step="100" value={command.fade_ms ?? 500}
          onChange={(e) => onChange({ ...command, fade_ms: Math.round(Math.max(0, Math.min(60000, Number(e.target.value)))) })} />
      </label>}
    </div>
  );
}

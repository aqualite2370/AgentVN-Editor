import type { BgmAction, BgmCommand } from "../../types/commands";
import { bgmActionOptions } from "../../utils/localizedOptions";
import { FieldHelp } from "../common/FieldHelp";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";
import { DEFAULT_BGM_FADE_MS, normalizeBgmCommandFields } from "../../../../shared/cartridge/bgmTransition";

export function BgmCommandEditor({ command, onChange }: { command: BgmCommand; onChange: (command: BgmCommand) => void }) {
  const normalized = normalizeBgmCommandFields(command);
  const effect = normalized.fade_ms > 0 ? "fade" : "instant";
  const effectOptions = normalized.action === "play"
    ? [
        { value: "fade", label: "淡入" },
        { value: "instant", label: "立即播放" },
      ]
    : [
        { value: "fade", label: "淡出" },
        { value: "instant", label: "立即停止" },
      ];

  return (
    <div className="form-grid">
      {normalized.action === "play" && (
        <AssetPicker
          label="背景音乐素材"
          field="bgm_id"
          value={command.bgm_id ?? ""}
          allowedTypes={["bgm"]}
          helpKey="command.bgm.bgmId"
          onChange={(assetId) => onChange({ ...command, bgm_id: assetId || null })}
        />
      )}
      <label>
        播放动作 <FieldHelp field="action" />
        <RichSelect
          value={normalized.action}
          options={bgmActionOptions}
          helpKey="command.bgm.action"
          onChange={(nextAction) => onChange({ ...command, action: nextAction as BgmAction, fade_ms: normalized.fade_ms })}
        />
      </label>
      {normalized.action === "play" && (
        <label>
          音量 <FieldHelp field="volume" />
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={command.volume ?? 1}
            data-help-key="command.bgm.volume"
            onChange={(e) => onChange({ ...command, volume: Number(e.target.value) })}
          />
        </label>
      )}
      <label>
        {normalized.action === "play" ? "播放效果" : "停止效果"} <FieldHelp field="fade_ms" />
        <RichSelect
          value={effect}
          options={effectOptions}
          helpKey="command.bgm.fadeMs"
          onChange={(nextEffect) => onChange({
            ...command,
            action: normalized.action,
            fade_ms: nextEffect === "fade" ? (normalized.fade_ms || DEFAULT_BGM_FADE_MS) : 0,
          })}
        />
      </label>
      {effect === "fade" && (
        <label>
          {normalized.action === "play" ? "淡入时长（毫秒）" : "淡出时长（毫秒）"} <FieldHelp field="fade_ms" />
          <input
            type="number"
            min="0"
            step="100"
            value={normalized.fade_ms}
            data-help-key="command.bgm.fadeMs"
            onChange={(e) => onChange({
              ...command,
              action: normalized.action,
              fade_ms: Math.max(0, Number(e.target.value)),
            })}
          />
        </label>
      )}
    </div>
  );
}

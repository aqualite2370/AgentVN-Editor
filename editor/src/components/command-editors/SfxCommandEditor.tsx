import type { SfxCommand } from "../../types/commands";
import { FieldHelp } from "../common/FieldHelp";
import { AssetPicker } from "../common/AssetPicker";

export function SfxCommandEditor({ command, onChange }: { command: SfxCommand; onChange: (command: SfxCommand) => void }) {
  return (
    <div className="form-grid">
      <AssetPicker
        label="音效素材"
        field="sfx_id"
        value={command.sfx_id}
        allowedTypes={["sfx"]}
        helpKey="command.sfx.sfxId"
        onChange={(assetId) => onChange({ ...command, sfx_id: assetId })}
      />
      <label>音量 <FieldHelp field="volume" /><input type="number" min="0" max="1" step="0.1" value={command.volume ?? 1} data-help-key="command.sfx.volume" onChange={(e) => onChange({ ...command, volume: Number(e.target.value) })} /></label>
    </div>
  );
}

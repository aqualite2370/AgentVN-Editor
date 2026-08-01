import type { WaitCommand } from "../../types/commands";
import { FieldHelp } from "../common/FieldHelp";

export function WaitCommandEditor({ command, onChange }: { command: WaitCommand; onChange: (command: WaitCommand) => void }) {
  return <label>等待时间（毫秒） <FieldHelp field="duration_ms" /><input type="number" value={command.duration_ms} data-help-key="command.wait.durationMs" onChange={(e) => onChange({ ...command, duration_ms: Number(e.target.value) })} /></label>;
}

import type { RollbackControlCommand } from "../../types/commands";
import { RichSelect } from "../common/RichSelect";

const actions: Array<{ value: RollbackControlCommand["action"]; label: string }> = [
  { value: "checkpoint", label: "记录检查点" },
  { value: "block", label: "禁止回退越过此处" },
  { value: "fix", label: "锁定此前选择" },
  { value: "suspend", label: "暂停记录回退" },
  { value: "resume", label: "恢复记录回退" },
];

export function RollbackCommandEditor({
  command,
  onChange,
}: {
  command: RollbackControlCommand;
  onChange: (command: RollbackControlCommand) => void;
}) {
  return (
    <div className="command-form-grid">
      <label>
        回退控制
        <RichSelect
          value={command.action}
          ariaLabel="回退控制"
          options={actions}
          onChange={(action) => {
            onChange(action === "checkpoint"
              ? { type: "rollback", action, hard: true }
              : { type: "rollback", action });
          }}
        />
      </label>
      {command.action === "checkpoint" && (
        <label>
          <input data-help-key="editor.control"
            type="checkbox"
            checked={command.hard !== false}
            onChange={(event) => onChange({ ...command, hard: event.target.checked })}
          />
          允许玩家通过滚轮回退到此检查点
        </label>
      )}
      <p className="workbench-note">
        对白、旁白、选项和聚焦图片会自动记录检查点；这里只用于控制特殊剧情段落。
      </p>
    </div>
  );
}

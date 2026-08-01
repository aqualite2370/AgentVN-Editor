import type { StateOperation, StateUpdateCommand, StateValueType } from "../../types/commands";
import { stateOperationOptions } from "../../utils/localizedOptions";
import {
  allowedStateValueTypesForOperation,
  coerceStateValue,
  defaultStateValueForType,
  defaultStateValueTypeForOperation,
  inferStateValueType,
  normalizeStateUpdateCommand,
  stateValueToInput,
  stateValueTypeOptions,
} from "../../utils/stateValues";
import { FieldHelp } from "../common/FieldHelp";
import { RichSelect } from "../common/RichSelect";

export function StateUpdateCommandEditor({ command, onChange }: { command: StateUpdateCommand; onChange: (command: StateUpdateCommand) => void }) {
  const normalized = normalizeStateUpdateCommand(command);
  const valueType = inferStateValueType(normalized);
  const allowedValueTypes = allowedStateValueTypesForOperation(normalized.operation);
  const valueVisible = normalized.operation !== "toggle";

  function updateOperation(operation: StateOperation) {
    const nextValueType = defaultStateValueTypeForOperation(operation);
    onChange({
      ...normalized,
      operation,
      value_type: nextValueType,
      value: defaultStateValueForType(nextValueType),
    });
  }

  function updateValueType(nextValueType: StateValueType) {
    onChange({
      ...normalized,
      value_type: nextValueType,
      value: defaultStateValueForType(nextValueType),
    });
  }

  function updateValue(rawValue: string | boolean) {
    onChange({
      ...normalized,
      value_type: valueType,
      value: coerceStateValue(rawValue, valueType),
    });
  }

  return (
    <div className="form-grid state-update-editor">
      <label>
        变量名 <FieldHelp field="key" />
        <input value={normalized.key} data-help-key="command.state.key" onChange={(event) => onChange({ ...normalized, key: event.target.value })} />
      </label>
      <label>
        操作类型 <FieldHelp field="operation" />
        <RichSelect value={normalized.operation} options={stateOperationOptions} helpKey="command.state.operation" onChange={(nextOperation) => updateOperation(nextOperation as StateOperation)} />
      </label>
      {valueVisible && (
        <label>
          值类型 <FieldHelp field="value_type" />
          <RichSelect
            value={valueType}
            options={stateValueTypeOptions.filter((option) => allowedValueTypes.includes(option.value))}
            helpKey="command.state.valueType"
            onChange={(nextValueType) => updateValueType(nextValueType as StateValueType)}
          />
        </label>
      )}
      {valueVisible && valueType === "boolean" && (
        <label className="check-row">
          <input type="checkbox" checked={Boolean(normalized.value)} data-help-key="command.state.value" onChange={(event) => updateValue(event.target.checked)} />
          变量值 <FieldHelp field="value" />
        </label>
      )}
      {valueVisible && valueType !== "boolean" && (
        <label>
          变量值 <FieldHelp field="value" />
          <input
            type={valueType === "number" ? "number" : "text"}
            value={stateValueToInput(normalized.value)}
            placeholder={valueType === "list" ? "例如：flag_a, flag_b" : undefined}
            data-help-key="command.state.value"
            onChange={(event) => updateValue(event.target.value)}
          />
        </label>
      )}
      {!valueVisible && (
        <p className="field-note">开关切换会自动取反当前布尔值，不需要填写变量值。</p>
      )}
    </div>
  );
}

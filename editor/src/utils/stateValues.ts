import type { JsonValue, StateOperation, StateUpdateCommand, StateValueType } from "../types/commands";

export const stateValueTypeOptions: Array<{ value: StateValueType; label: string }> = [
  { value: "boolean", label: "布尔 / 开关" },
  { value: "number", label: "数字" },
  { value: "text", label: "文本" },
  { value: "list", label: "列表" },
];

export function defaultStateValueTypeForOperation(operation: StateOperation): StateValueType {
  if (operation === "add" || operation === "subtract") return "number";
  if (operation === "toggle") return "boolean";
  if (operation === "append" || operation === "remove") return "text";
  return "boolean";
}

export function allowedStateValueTypesForOperation(operation: StateOperation): StateValueType[] {
  if (operation === "add" || operation === "subtract") return ["number"];
  if (operation === "toggle") return ["boolean"];
  if (operation === "append" || operation === "remove") return ["boolean", "number", "text"];
  return ["boolean", "number", "text", "list"];
}

export function inferStateValueType(command: StateUpdateCommand): StateValueType {
  const allowed = allowedStateValueTypesForOperation(command.operation);
  if (command.value_type && allowed.includes(command.value_type)) return command.value_type;
  if (command.operation === "add" || command.operation === "subtract") return "number";
  if (command.operation === "toggle") return "boolean";
  if (Array.isArray(command.value) && allowed.includes("list")) return "list";
  if (typeof command.value === "number" && allowed.includes("number")) return "number";
  if (typeof command.value === "boolean" && allowed.includes("boolean")) return "boolean";
  if (allowed.includes("text")) return "text";
  return allowed[0] ?? "text";
}

export function defaultStateValueForType(valueType: StateValueType): JsonValue {
  if (valueType === "boolean") return true;
  if (valueType === "number") return 0;
  if (valueType === "list") return [];
  return "";
}

export function coerceStateValue(rawValue: string | boolean | JsonValue, valueType: StateValueType): JsonValue {
  if (valueType === "boolean") {
    if (typeof rawValue === "boolean") return rawValue;
    if (typeof rawValue === "number") return rawValue !== 0;
    return ["true", "1", "yes", "on"].includes(String(rawValue).trim().toLowerCase());
  }
  if (valueType === "number") {
    const numberValue = Number(rawValue);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
  if (valueType === "list") {
    if (Array.isArray(rawValue)) return rawValue;
    return String(rawValue)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return String(rawValue ?? "");
}

export function stateValueToInput(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value === undefined || value === null) return "";
  return String(value);
}

export function normalizeStateUpdateCommand(command: StateUpdateCommand): StateUpdateCommand {
  const valueType = inferStateValueType(command);
  return {
    ...command,
    value_type: valueType,
    value: command.operation === "toggle" ? true : coerceStateValue(command.value, valueType),
  };
}

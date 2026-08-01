import type { Condition, ConditionOperator, JsonValue, StateUpdateCommand } from "../types/commands";
import type { ConditionData, EditorNode } from "../types/nodes";

export type ConditionValueType = NonNullable<ConditionData["valueType"]>;

export const conditionValueTypeOptions: Array<{ value: ConditionValueType; label: string }> = [
  { value: "boolean", label: "布尔 / 开关" },
  { value: "number", label: "数字" },
  { value: "text", label: "文本" },
  { value: "list", label: "列表" },
];

export const conditionOperatorLabels: Record<ConditionOperator, string> = {
  equals: "等于",
  not_equals: "不等于",
  greater_than: "大于",
  less_than: "小于",
  greater_or_equal: "大于等于",
  less_or_equal: "小于等于",
  truthy: "为真",
  falsy: "为假",
  includes: "包含",
  not_includes: "不包含",
};

export const operatorsByValueType: Record<ConditionValueType, ConditionOperator[]> = {
  boolean: ["truthy", "falsy"],
  number: ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal"],
  text: ["equals", "not_equals"],
  list: ["includes", "not_includes"],
};

export function defaultConditionData(): ConditionData {
  return {
    expression: "flag_name",
    mode: "builder",
    key: "flag_name",
    operator: "truthy",
    valueType: "boolean",
    trueLabel: "满足条件",
    falseLabel: "不满足条件",
  };
}

export function isBuilderCondition(condition?: ConditionData): boolean {
  return condition?.mode === "builder" || Boolean(condition?.key && condition?.operator);
}

export function normalizeCondition(condition?: ConditionData): ConditionData {
  const fallback = defaultConditionData();
  if (!condition) return fallback;
  const mode = condition.mode ?? (condition.key && condition.operator ? "builder" : "advanced");
  return {
    ...fallback,
    ...condition,
    mode,
    key: condition.key ?? fallback.key,
    operator: condition.operator ?? fallback.operator,
    valueType: condition.valueType ?? fallback.valueType,
    trueLabel: condition.trueLabel || fallback.trueLabel,
    falseLabel: condition.falseLabel || fallback.falseLabel,
    expression: condition.expression ?? fallback.expression,
  };
}

export function parseConditionValue(rawValue: string | boolean, valueType: ConditionValueType): JsonValue {
  if (valueType === "boolean") return Boolean(rawValue);
  if (valueType === "number") {
    const numberValue = Number(rawValue);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
  if (valueType === "list") {
    return String(rawValue)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return String(rawValue);
}

function conditionValueToText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return String(value);
}

export function conditionToRuntimeCondition(condition: ConditionData): Condition {
  const normalized = normalizeCondition(condition);
  const operator = normalized.operator ?? "truthy";
  const runtimeCondition: Condition = {
    key: normalized.key || "flag_name",
    operator,
  };
  if (operator !== "truthy" && operator !== "falsy") {
    runtimeCondition.value = normalized.value ?? parseConditionValue("", normalized.valueType ?? "text");
  }
  return runtimeCondition;
}

function inferConditionValueType(condition: Condition): ConditionValueType {
  if (typeof condition.value === "number") return "number";
  if (typeof condition.value === "boolean") return "boolean";
  if (Array.isArray(condition.value)) return "list";
  return "text";
}

export function runtimeConditionToConditionData(condition?: string | Condition): ConditionData {
  const fallback = defaultConditionData();
  if (!condition) return fallback;
  if (typeof condition === "string") {
    return {
      ...fallback,
      mode: "advanced",
      expression: condition,
    };
  }
  const valueType = inferConditionValueType(condition);
  const builderCondition: ConditionData = {
    ...fallback,
    mode: "builder",
    key: condition.key,
    operator: condition.operator,
    value: condition.value,
    valueType,
  };
  return {
    ...builderCondition,
    expression: conditionToAdvancedExpression(builderCondition),
  };
}

export function invertRuntimeCondition(condition: Condition): Condition {
  const inverse: Record<ConditionOperator, ConditionOperator> = {
    equals: "not_equals",
    not_equals: "equals",
    greater_than: "less_or_equal",
    less_than: "greater_or_equal",
    greater_or_equal: "less_than",
    less_or_equal: "greater_than",
    truthy: "falsy",
    falsy: "truthy",
    includes: "not_includes",
    not_includes: "includes",
  };
  return { ...condition, operator: inverse[condition.operator] };
}

export function conditionToAdvancedExpression(condition: ConditionData): string {
  const runtimeCondition = conditionToRuntimeCondition(condition);
  if (runtimeCondition.operator === "truthy") return runtimeCondition.key;
  if (runtimeCondition.operator === "falsy") return `!(${runtimeCondition.key})`;
  const operatorMap: Partial<Record<ConditionOperator, string>> = {
    equals: "==",
    not_equals: "!=",
    greater_than: ">",
    less_than: "<",
    greater_or_equal: ">=",
    less_or_equal: "<=",
  };
  const operator = operatorMap[runtimeCondition.operator] ?? runtimeCondition.operator;
  const value = typeof runtimeCondition.value === "string" ? `"${runtimeCondition.value}"` : conditionValueToText(runtimeCondition.value);
  return `${runtimeCondition.key} ${operator} ${value}`.trim();
}

export function conditionToReadableText(condition?: ConditionData): string {
  const normalized = normalizeCondition(condition);
  if (!isBuilderCondition(normalized)) return normalized.expression || "未设置条件";
  const operator = normalized.operator ?? "truthy";
  const label = conditionOperatorLabels[operator] ?? operator;
  if (operator === "truthy" || operator === "falsy") return `如果 ${normalized.key || "变量"} ${label}`;
  return `如果 ${normalized.key || "变量"} ${label} ${conditionValueToText(normalized.value)}`;
}

function collectStateUpdatesFromCommands(commands: unknown[]): StateUpdateCommand[] {
  return commands.filter((command): command is StateUpdateCommand => {
    return Boolean(command && typeof command === "object" && (command as { type?: string }).type === "state_update");
  });
}

export function collectStateVariableKeys(nodes: EditorNode[]): string[] {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (node.data.stateUpdate?.key) keys.add(node.data.stateUpdate.key);
    if (node.data.scene?.commands) {
      for (const command of collectStateUpdatesFromCommands(node.data.scene.commands)) {
        if (command.key) keys.add(command.key);
      }
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

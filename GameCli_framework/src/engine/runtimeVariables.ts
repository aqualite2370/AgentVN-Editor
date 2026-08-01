import type { JsonValue, StateOperation, Condition, StateValueType } from "../types/commands";

export type RuntimeVariables = Record<string, JsonValue>;

function inferStateValueType(value: JsonValue): StateValueType {
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "text";
}

function coerceStateValue(value: JsonValue, valueType: StateValueType): JsonValue {
  switch (valueType) {
    case "boolean":
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
      return Boolean(value);
    case "number": {
      const next = Number(value ?? 0);
      return Number.isFinite(next) ? next : 0;
    }
    case "list":
      if (Array.isArray(value)) return value;
      if (value === null || value === undefined) return [];
      return [value];
    case "text":
    default:
      if (value === null || value === undefined) return "";
      return typeof value === "string" ? value : String(value);
  }
}

function stateValueForOperation(operation: StateOperation, value: JsonValue, valueType?: StateValueType): JsonValue {
  const inferredType = valueType ?? (operation === "add" || operation === "subtract" ? "number" : operation === "toggle" ? "boolean" : inferStateValueType(value));
  return coerceStateValue(value, inferredType);
}

function jsonValueEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function updateRuntimeVariable(
  variables: RuntimeVariables,
  key: string,
  operation: StateOperation,
  value: JsonValue,
  valueType?: StateValueType
): RuntimeVariables {
  const next = { ...variables };
  const current = next[key];
  const typedValue = stateValueForOperation(operation, value, valueType);
  switch (operation) {
    case "set":
      next[key] = typedValue;
      break;
    case "set_if_unset":
      if (!(key in next)) next[key] = typedValue;
      break;
    case "add":
      next[key] = Number(current ?? 0) + Number(typedValue ?? 0);
      break;
    case "subtract":
      next[key] = Number(current ?? 0) - Number(typedValue ?? 0);
      break;
    case "toggle":
      next[key] = !Boolean(current);
      break;
    case "append":
      next[key] = Array.isArray(current)
        ? Array.isArray(typedValue)
          ? [...current, ...typedValue]
          : [...current, typedValue]
        : Array.isArray(typedValue)
          ? typedValue
          : [typedValue];
      break;
    case "remove":
      next[key] = Array.isArray(current)
        ? Array.isArray(typedValue)
          ? current.filter((item) => !typedValue.some((value) => jsonValueEquals(item, value)))
          : current.filter((item) => !jsonValueEquals(item, typedValue))
        : current ?? null;
      break;
  }
  return next;
}

export function evaluateCondition(condition: string | Condition, variables: RuntimeVariables): boolean {
  if (typeof condition === "string") {
    if (!condition.trim()) return true;
    const negated = condition.trim().startsWith("!");
    const key = condition.replace(/[!()]/g, "").split("==")[0].trim();
    const value = Boolean(variables[key]);
    return negated ? !value : value;
  }
  const current = variables[condition.key];
  switch (condition.operator) {
    case "equals":
      return current === condition.value;
    case "not_equals":
      return current !== condition.value;
    case "greater_than":
      return Number(current) > Number(condition.value);
    case "less_than":
      return Number(current) < Number(condition.value);
    case "greater_or_equal":
      return Number(current) >= Number(condition.value);
    case "less_or_equal":
      return Number(current) <= Number(condition.value);
    case "truthy":
      return Boolean(current);
    case "falsy":
      return !Boolean(current);
    case "includes":
      return condition.value !== undefined && Array.isArray(current) && current.includes(condition.value);
    case "not_includes":
      return condition.value !== undefined && Array.isArray(current) && !current.includes(condition.value);
  }
}

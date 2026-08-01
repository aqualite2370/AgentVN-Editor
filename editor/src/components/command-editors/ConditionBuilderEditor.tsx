import type { ConditionOperator, JsonValue } from "../../types/commands";
import type { ConditionData } from "../../types/nodes";
import {
  conditionOperatorLabels,
  conditionToAdvancedExpression,
  conditionValueTypeOptions,
  normalizeCondition,
  operatorsByValueType,
  parseConditionValue,
  type ConditionValueType,
} from "../../utils/conditions";
import { FieldHelp } from "../common/FieldHelp";
import { RichSelect } from "../common/RichSelect";

function valueAsInput(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

export function ConditionBuilderEditor({
  condition,
  variableKeys,
  datalistId = "condition-variable-candidates",
  showExitLabels = true,
  copyVariant = "default",
  onChange,
}: {
  condition?: ConditionData;
  variableKeys: string[];
  datalistId?: string;
  showExitLabels?: boolean;
  copyVariant?: "default" | "beginner-loop";
  onChange: (condition: ConditionData) => void;
}) {
  const current = normalizeCondition(condition);
  const isBeginnerLoop = copyVariant === "beginner-loop";
  const valueType = current.valueType ?? "boolean";
  const operators = operatorsByValueType[valueType];
  const operator = operators.includes(current.operator as ConditionOperator) ? current.operator as ConditionOperator : operators[0];
  const valueVisible = operator !== "truthy" && operator !== "falsy";

  const update = (patch: Partial<ConditionData>) => {
    const next = normalizeCondition({ ...current, ...patch, mode: patch.mode ?? current.mode ?? "builder" });
    if (next.mode === "builder") {
      next.expression = conditionToAdvancedExpression(next);
    }
    onChange(next);
  };

  const updateValueType = (nextValueType: ConditionValueType) => {
    const nextOperator = operatorsByValueType[nextValueType][0];
    const nextValue = nextValueType === "boolean" ? undefined : parseConditionValue("", nextValueType);
    update({ valueType: nextValueType, operator: nextOperator, value: nextValue });
  };

  return (
    <div className="condition-builder">
      <section className="condition-builder-card">
        <div className="condition-builder-card-header">
          <strong>{isBeginnerLoop ? "把“什么时候再做一次”补完整" : "判断条件"}</strong>
          <span>
            {isBeginnerLoop
              ? "依次选择要检查的记录、比较方法和目标内容。满足这句话时，剧情会再重复一轮。"
              : "用表单生成运行时可校验的结构化条件。"}
          </span>
        </div>
        <div className="condition-builder-grid">
          <label>
            {isBeginnerLoop ? "要检查哪一项记录" : "变量"} <FieldHelp field="key" />
            <input
              value={current.key ?? ""}
              list={datalistId}
              placeholder={isBeginnerLoop ? "例如：search_count（搜索次数）" : "例如：lin_trust"}
              data-help-key="field.conditionKey"
              onChange={(event) => update({ key: event.target.value })}
            />
          </label>
          <datalist id={datalistId}>
            {variableKeys.map((key) => <option key={key} value={key} />)}
          </datalist>
          <label>
            {isBeginnerLoop ? "这项记录保存的内容" : "变量类型"}
            <RichSelect
              value={valueType}
              options={isBeginnerLoop
                ? [
                    { value: "boolean", label: "是 / 否（例如：是否找到钥匙）" },
                    { value: "number", label: "数字（例如：已经搜索几次）" },
                    { value: "text", label: "文字（例如：当前地点名称）" },
                    { value: "list", label: "一组内容（例如：已获得物品）" },
                  ]
                : conditionValueTypeOptions}
              helpKey="field.conditionValueType"
              onChange={(nextValueType) => updateValueType(nextValueType as ConditionValueType)}
            />
          </label>
          <label>
            {isBeginnerLoop ? "怎样才算满足" : "判断方式"}
            <RichSelect
              value={operator}
              options={operators.map((item) => ({ value: item, label: conditionOperatorLabels[item] }))}
              helpKey="field.conditionOperator"
              onChange={(nextOperator) => update({ operator: nextOperator as ConditionOperator })}
            />
          </label>
          {valueVisible && (
            <label>
              {isBeginnerLoop ? "要比较的目标内容" : "比较值"}
              <input
                type={valueType === "number" ? "number" : "text"}
                value={valueAsInput(current.value)}
                placeholder={valueType === "list"
                  ? (isBeginnerLoop ? "例如：钥匙" : "列表中需要包含的值")
                  : (isBeginnerLoop ? "例如：3" : "用于比较的值")}
                data-help-key="field.conditionValue"
                onChange={(event) => update({ value: parseConditionValue(event.target.value, valueType) })}
              />
            </label>
          )}
        </div>
      </section>

      {showExitLabels && (
        <section className="condition-builder-card">
          <div className="condition-builder-card-header">
            <strong>{isBeginnerLoop ? "给两条去向起个容易看懂的名字" : "出口设置"}</strong>
            <span>
              {isBeginnerLoop
                ? "名称会显示在节点下方，帮助你连线；修改名称不会改变剧情判断。"
                : "出口文案只影响编辑器显示，不改变 true/false 连线手柄。"}
            </span>
          </div>
          <div className="condition-builder-grid is-two-column">
            <label>
              {isBeginnerLoop ? "满足上面规则时（再做一次）" : "满足时出口文案"}
              <input value={current.trueLabel} data-help-key="field.trueLabel" onChange={(event) => update({ trueLabel: event.target.value })} />
            </label>
            <label>
              {isBeginnerLoop ? "不满足上面规则时（结束重复）" : "不满足时出口文案"}
              <input value={current.falseLabel} data-help-key="field.falseLabel" onChange={(event) => update({ falseLabel: event.target.value })} />
            </label>
          </div>
        </section>
      )}

      <details className="condition-advanced" open={current.mode === "advanced"}>
        <summary>{isBeginnerLoop ? "高级设置：自己编写判断规则（有编程经验时使用）" : "高级表达式"}</summary>
        <p>
          {isBeginnerLoop
            ? "常用重复流程不需要打开这里。只有旧工程或上方表单无法表达的特殊规则，才建议手动编写。"
            : "旧工程或特殊判断可以继续使用表达式；切换后导出会按字符串条件兼容处理。"}
        </p>
        <textarea value={current.expression ?? ""} data-help-key="field.conditionExpression" onChange={(event) => update({ mode: "advanced", expression: event.target.value })} />
        {current.mode !== "advanced" && (
          <button type="button" data-help-key="field.conditionExpression" onClick={() => update({ mode: "advanced" })}>
            {isBeginnerLoop ? "我了解风险，进入手动编写" : "切换为高级表达式"}
          </button>
        )}
        {current.mode === "advanced" && (
          <button type="button" data-help-key="field.conditionExpression" onClick={() => update({ mode: "builder" })}>
            {isBeginnerLoop ? "返回上方的分步设置" : "返回可视化构建器"}
          </button>
        )}
      </details>
    </div>
  );
}

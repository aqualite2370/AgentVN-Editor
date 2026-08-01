import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../../types/nodes";
import { conditionOperatorLabels } from "../../utils/conditions";

function conditionValueText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.join("、");
  return String(value);
}

export function LoopNode({ data, selected }: NodeProps<EditorNode>) {
  const loop = data.loop;
  const condition = loop?.continueCondition;
  const operatorLabel = condition ? conditionOperatorLabels[condition.operator] : "";
  const comparisonValue = conditionValueText(condition?.value);
  const conditionSummary = condition
    ? `${condition.key || "变量"} ${operatorLabel}${comparisonValue ? ` ${comparisonValue}` : ""}`
    : "";
  const stepText = loop
    ? `把“${loop.variableKey || "次数记录"}”${loop.step >= 0 ? "增加" : "减少"} ${Math.abs(loop.step)}`
    : "";

  return (
    <article className={`vn-node loop-node ${selected ? "is-selected" : ""}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <header>
        <span className="node-kicker">重复剧情</span>
        <strong>{data.label}</strong>
      </header>
      {loop ? (
        <div className="loop-node-summary">
          <span>每次回到这里：{stepText}</span>
          <strong>满足“{conditionSummary}”时再做一次</strong>
        </div>
      ) : (
        <p>{data.description}</p>
      )}
      <div className="loop-node-exit-labels" aria-hidden="true">
        <span>{loop?.loopLabel || "再做一次"}</span>
        <span>{loop?.exitLabel || "重复完成"}</span>
      </div>
      <Handle id="loop" className="loop-continue-handle" type="source" position={Position.Bottom} style={{ left: "35%" }} />
      <Handle id="exit" className="loop-exit-handle" type="source" position={Position.Bottom} style={{ left: "65%" }} />
    </article>
  );
}

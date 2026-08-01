import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../../types/nodes";
import { conditionToReadableText } from "../../utils/conditions";

export function ConditionNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <article className={`vn-node condition-node ${selected ? "is-selected" : ""}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <header>
        <span className="node-kicker">条件</span>
        <strong>{data.label}</strong>
      </header>
      <p>{conditionToReadableText(data.condition)}</p>
      <Handle id="true" type="source" position={Position.Bottom} style={{ left: "35%" }} />
      <Handle id="false" type="source" position={Position.Bottom} style={{ left: "65%" }} />
    </article>
  );
}

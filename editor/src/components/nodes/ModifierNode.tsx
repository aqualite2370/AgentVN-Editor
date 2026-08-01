import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../../types/nodes";

export function ModifierNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <article className={`vn-node modifier-node ${selected ? "is-selected" : ""}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <header><span className="node-kicker">修饰</span><strong>{data.label}</strong></header>
      <p>{data.stateUpdate ? "更新剧情状态" : data.description}</p>
      <Handle id="default" type="source" position={Position.Bottom} />
    </article>
  );
}

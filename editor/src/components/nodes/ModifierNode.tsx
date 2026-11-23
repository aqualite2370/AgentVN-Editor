import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../../types/nodes";

export function ModifierNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <article className={`vn-node modifier-node ${selected ? "is-selected" : ""}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <header><span className="node-kicker">修饰</span><strong>{data.label}</strong></header>
      {!data.stateUpdate && data.description && <p>{data.description}</p>}
      <Handle id="default" type="source" position={Position.Bottom} />
    </article>
  );
}
